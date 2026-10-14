"""Strict protocol and WebSocket recovery tested with a real Redis channel layer."""

import asyncio
import json
from contextlib import AsyncExitStack, suppress
from datetime import timedelta
from time import monotonic
from unittest import skipUnless
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.security.websocket import OriginValidator
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.db import OperationalError
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.urls import path
from redis.exceptions import ConnectionError as RedisConnectionError

from apps.presence.consumers import PresenceConsumer, client_address
from apps.presence.leases import PresenceSnapshot
from apps.presence.models import DailyPresenceSummary, DailyVisit, Visitor
from apps.presence.protocol import Hello, ProtocolError, parse_message
from apps.presence.statistics import hash_visitor, local_day, record_peak, record_visit

from .test_leases import TEST_REDIS_URL, real_redis, redis_case_settings


def hello(*, visitor_id=None, analytics=True, visible=True, scope='default'):
    """Build a valid hello without inventing a persistent ID for privacy mode."""
    message = {'v': 1, 'type': 'hello', 'scope': scope, 'analytics': analytics, 'visible': visible}
    if analytics:
        message['visitor_id'] = visitor_id or str(uuid4())
    return message


class ProtocolTests(SimpleTestCase):
    """Exercise validation independently of optional Redis infrastructure."""

    def test_exact_message_schema_and_uuid_validation(self):
        """Types, version, duplicate keys and extra fields are rejected strictly."""
        valid = hello()
        self.assertIsInstance(parse_message(json.dumps(valid), limit=2048), Hello)
        malformed = [
            'null',
            '[]',
            '{}',
            '{',
            '{"v":1,"v":1,"type":"heartbeat"}',
            json.dumps({'v': True, 'type': 'heartbeat'}),
            json.dumps({'v': 2, 'type': 'heartbeat'}),
            json.dumps({'v': 1, 'type': 'heartbeat', 'scope': 'default'}),
            json.dumps({**valid, 'analytics': 1}),
            json.dumps({**valid, 'visible': 'true'}),
            json.dumps({**valid, 'visitor_id': 'not-a-uuid'}),
            json.dumps({**valid, 'visitor_id': str(uuid4()).upper()}),
            json.dumps({**valid, 'analytics': False}),
            json.dumps({key: value for key, value in valid.items() if key != 'visible'}),
            '"' + 'x' * 2048 + '"',
        ]
        for message in malformed:
            with self.subTest(message=message[:80]), self.assertRaises(ProtocolError):
                parse_message(message, limit=2048)
        self.assertEqual(parse_message('{"v":1,"type":"heartbeat"}', limit=2048), 'heartbeat')
        self.assertIsNone(parse_message(json.dumps(hello(analytics=False)), limit=2048).visitor_id)

    def test_analytics_hello_requires_a_non_null_uuid(self):
        """Analytics consent requires an identifier before any lease or hashing work."""
        for visitor_id in (None, False, 0, [], {}):
            with self.subTest(visitor_id=visitor_id):
                with self.assertRaises(ProtocolError) as error:
                    parse_message(json.dumps({**hello(), 'visitor_id': visitor_id}), limit=2048)
                self.assertEqual(error.exception.code, 'invalid_message')

    @override_settings(
        PRESENCE_TRUSTED_PROXY_NETWORKS=['10.0.0.0/8'], PRESENCE_PROXY_IP_HEADER='fly-client-ip'
    )
    def test_forwarded_address_requires_a_trusted_peer_and_one_valid_ip(self):
        """Spoofed, duplicate and chained proxy headers never bypass peer limits."""
        header = (b'fly-client-ip', b'192.0.2.25')
        self.assertEqual(
            client_address({'client': ('10.0.0.2', 1), 'headers': [header]}), '192.0.2.25'
        )
        self.assertEqual(
            client_address({'client': ('198.51.100.1', 1), 'headers': [header]}), '198.51.100.1'
        )
        for headers in (
            [header, header],
            [(b'fly-client-ip', b'192.0.2.25, 192.0.2.26')],
            [(b'fly-client-ip', b'invalid')],
            [(b'fly-client-ip', b'\xff')],
        ):
            self.assertEqual(
                client_address({'client': ('10.0.0.2', 1), 'headers': headers}), '10.0.0.2'
            )
        self.assertEqual(client_address({'headers': [header]}), 'unknown')


class ObservedPresenceConsumer(PresenceConsumer):
    """Expose server connection instances for controlled lease/failure probes."""

    instances = []

    async def connect(self):
        """Track the actual consumer while preserving its real Redis behavior."""
        self.instances.append(self)
        await super().connect()


@skipUnless(TEST_REDIS_URL, 'Set TEST_REDIS_URL to run real Redis WebSocket tests')
class RedisConsumerTests(TransactionTestCase):
    """Exercise real sockets, Redis broadcasts and transactional visit recording."""

    def setUp(self):
        """Use a fresh Redis namespace and inspectable actual consumer instances."""
        self.settings_override = redis_case_settings()
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        ObservedPresenceConsumer.instances = []

    def _socket(self, *, origin='https://reading.example', headers=(), ip='192.0.2.1'):
        origins = [
            origin for item in settings.PRESENCE_SCOPES.values() for origin in item['origins']
        ]
        application = OriginValidator(
            URLRouter([path('ws/presence/', ObservedPresenceConsumer.as_asgi())]), origins
        )
        request_headers = list(headers)
        if origin is not None:
            request_headers.append((b'origin', origin.encode()))
        socket = WebsocketCommunicator(application, '/ws/presence/', headers=request_headers)
        socket.scope['client'] = (ip, 1234)
        return socket

    async def _count(self, socket, count, *, timeout=2):
        deadline = monotonic() + timeout
        while monotonic() < deadline:
            message = await socket.receive_json_from(timeout=max(0.01, deadline - monotonic()))
            if message['type'] == 'presence.snapshot' and message['count'] == count:
                return message
            if message['type'] == 'error':
                self.fail(f'Unexpected presence error: {message["code"]}')
        self.fail(f'Expected count {count}')

    async def _error(self, socket, code):
        for _ in range(20):
            message = await socket.receive_json_from(timeout=2)
            if message['type'] == 'error':
                self.assertEqual(message['code'], code)
                self.assertNotIn('count', message)
                return
        self.fail(f'Expected error {code}')

    async def test_tabs_daily_ack_and_heartbeats_do_not_repeat_sql(self):
        """Tabs share daily acks, while inactivity removes exactly one live tab."""
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(real_redis())
            visits = stack.enter_context(
                patch('apps.presence.consumers.record_visit', wraps=record_visit)
            )
            peaks = stack.enter_context(
                patch('apps.presence.consumers.record_peak', wraps=record_peak)
            )
            first, second = self._socket(), self._socket()
            try:
                self.assertTrue((await first.connect())[0])
                self.assertTrue((await second.connect())[0])
                identifier = str(uuid4())
                await first.send_json_to(hello(visitor_id=identifier))
                snapshot = await self._count(first, 1)
                self.assertEqual(snapshot['lease_seconds'], 60)
                self.assertEqual(snapshot['heartbeat_seconds'], 20)
                await second.send_json_to(hello(visitor_id=identifier))
                await self._count(second, 1)
                for _ in range(3):
                    await first.send_json_to({'v': 1, 'type': 'heartbeat'})
                    await self._count(first, 1)
                self.assertEqual(visits.call_count, 1)
                self.assertEqual(peaks.call_count, 1)
                await first.send_json_to({'v': 1, 'type': 'inactive'})
                await self._count(first, 1)
                await second.disconnect()
                await self._count(first, 0)
                self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 1)
                keys = await database_sync_to_async(
                    lambda: list(Visitor.objects.values_list('visitor_key', flat=True))
                )()
                self.assertEqual(keys, [hash_visitor('default', identifier)])
            finally:
                await first.disconnect()
                await second.disconnect()
            self.assertTrue(
                all(item._observer_task is None for item in ObservedPresenceConsumer.instances)
            )

    async def test_privacy_mode_uses_ephemeral_page_keys_and_no_visit_rows(self):
        """Ephemeral pages count independently and have no persistent visitor rows."""
        async with real_redis() as client:
            sockets = [self._socket(), self._socket()]
            try:
                for index, socket in enumerate(sockets):
                    self.assertTrue((await socket.connect())[0])
                    await socket.send_json_to(hello(analytics=False))
                    await self._count(socket, index + 1)
                self.assertEqual(await database_sync_to_async(Visitor.objects.count)(), 0)
                self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 0)
                instances = ObservedPresenceConsumer.instances
                self.assertNotEqual(instances[0]._visitor_key, instances[1]._visitor_key)
                refs = await client.hkeys(
                    f'{instances[0].leases.scope_prefix("default")}:visitors'
                )
                self.assertEqual(set(refs), {item._visitor_key for item in instances})
            finally:
                for socket in sockets:
                    await socket.disconnect()

    async def test_dnt_and_gpc_headers_override_client_analytics_and_identifier(self):
        """Privacy headers force new functional keys even when hello submits an ID."""
        async with real_redis():
            identifier = str(uuid4())
            sockets = [self._socket(headers=[(header, b'1')]) for header in (b'dnt', b'sec-gpc')]
            try:
                for index, socket in enumerate(sockets):
                    self.assertTrue((await socket.connect())[0])
                    await socket.send_json_to(hello(visitor_id=identifier))
                    await self._count(socket, index + 1)
                self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 0)
                expected = hash_visitor('default', identifier)
                for instance in ObservedPresenceConsumer.instances:
                    self.assertFalse(instance._analytics)
                    self.assertNotEqual(instance._visitor_key, expected)
            finally:
                for socket in sockets:
                    await socket.disconnect()

    async def test_initial_hidden_page_records_visit_only_after_visible_heartbeat(self):
        """Opening a hidden page alone creates neither activity nor a visit."""
        async with real_redis():
            socket = self._socket()
            try:
                await socket.connect()
                await socket.send_json_to(hello(visible=False))
                await self._count(socket, 0)
                self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 0)
                await socket.send_json_to({'v': 1, 'type': 'heartbeat'})
                await self._count(socket, 1)
                self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 1)
                await socket.send_json_to({'v': 1, 'type': 'inactive'})
                await self._count(socket, 0)
            finally:
                await socket.disconnect()

    async def test_heartbeat_after_local_midnight_records_next_day_without_reconnect(self):
        """The next day gets exactly one durable visit on a still-open connection."""
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(real_redis())
            visits = stack.enter_context(
                patch('apps.presence.consumers.record_visit', wraps=record_visit)
            )
            socket = self._socket()
            try:
                await socket.connect()
                await socket.send_json_to(hello())
                await self._count(socket, 1)
                instance = ObservedPresenceConsumer.instances[0]
                before = await instance.leases.observe('default')
                following = PresenceSnapshot(
                    1, before.sequence, False, before.server_time + timedelta(days=1)
                )
                with patch.object(instance.leases, 'renew', AsyncMock(return_value=following)):
                    for _ in range(2):
                        await socket.send_json_to({'v': 1, 'type': 'heartbeat'})
                        await self._count(socket, 1)
                self.assertEqual(visits.call_count, 2)
                self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 2)
                classification = await database_sync_to_async(
                    lambda: list(
                        DailyVisit.objects.order_by('day').values_list('is_new', flat=True)
                    )
                )()
                self.assertEqual(classification, [True, False])
            finally:
                await socket.disconnect()

    async def test_missing_wrong_and_wrong_scope_origins_fail_closed(self):
        """Handshake and per-scope validation both enforce explicit origin lists."""
        async with real_redis():
            for origin in (None, 'https://evil.example'):
                socket = self._socket(origin=origin)
                self.assertFalse((await socket.connect())[0])
                await socket.disconnect()
            socket = self._socket(origin='https://other.example')
            try:
                self.assertTrue((await socket.connect())[0])
                await socket.send_json_to(hello(scope='default'))
                await self._error(socket, 'origin_forbidden')
            finally:
                await socket.disconnect()
            self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 0)

    async def test_invalid_protocol_before_hello_closes_with_bounded_stable_errors(self):
        """Malformed/binary/oversized messages do not create a visible lease."""
        async with real_redis():
            cases = [
                ({'v': 1, 'type': 'heartbeat'}, 'hello_required'),
                ({'v': 1, 'type': 'inactive'}, 'hello_required'),
                ({'v': 7, 'type': 'heartbeat'}, 'unsupported_version'),
                (hello(scope='unknown'), 'unknown_scope'),
                ({**hello(), 'visitor_id': None}, 'invalid_message'),
                ('{', 'invalid_message'),
                ('x' * 2049, 'invalid_message'),
                (b'binary', 'invalid_message'),
            ]
            for message, code in cases:
                socket = self._socket()
                try:
                    await socket.connect()
                    if isinstance(message, dict):
                        await socket.send_json_to(message)
                    elif isinstance(message, bytes):
                        await socket.send_to(bytes_data=message)
                    else:
                        await socket.send_to(text_data=message)
                    await self._error(socket, code)
                    self.assertEqual((await socket.receive_output())['code'], 4408)
                finally:
                    await socket.disconnect()
            self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 0)

    async def test_expiry_broadcast_without_join_after_a_worker_stops_observing(self):
        """A live observer prunes another worker's abandoned lease within seconds."""
        with override_settings(PRESENCE_LEASE_SECONDS=1, PRESENCE_OBSERVATION_SECONDS=0.03):
            async with real_redis():
                abandoned, live = self._socket(), self._socket()
                try:
                    await abandoned.connect()
                    await live.connect()
                    await abandoned.send_json_to(hello(analytics=False))
                    await self._count(abandoned, 1)
                    await live.send_json_to(hello(analytics=False))
                    await self._count(live, 2)
                    observer = ObservedPresenceConsumer.instances[0]._observer_task
                    observer.cancel()
                    with suppress(asyncio.CancelledError):
                        await observer
                    started = monotonic()
                    while monotonic() - started < 2:
                        await asyncio.sleep(0.2)
                        await live.send_json_to({'v': 1, 'type': 'heartbeat'})
                        message = await live.receive_json_from(timeout=1)
                        if message['type'] == 'presence.snapshot' and message['count'] == 1:
                            break
                    else:
                        self.fail('The abandoned lease was not pruned by the live observer')
                    self.assertLess(monotonic() - started, 1.7)
                finally:
                    await abandoned.disconnect()
                    await live.disconnect()

    async def test_hello_timeout_closes_and_releases_socket_capacity(self):
        """A socket that never sends hello cannot retain an admission slot."""
        with override_settings(PRESENCE_HELLO_SECONDS=0.03, PRESENCE_OBSERVATION_SECONDS=0.02):
            async with real_redis() as client:
                socket = self._socket()
                try:
                    await socket.connect()
                    instance = ObservedPresenceConsumer.instances[0]
                    observer = instance._observer_task
                    await self._error(socket, 'hello_timeout')
                    await socket.receive_output()
                    await socket.disconnect()
                    self.assertTrue(observer.done())
                    self.assertTrue(instance._cleanup_task.done())
                    self.assertEqual(await client.zcard(f'{instance.leases.prefix}:open'), 0)
                finally:
                    await socket.disconnect()

    async def test_disabled_consumer_rejects_handshake_with_feature_disabled_code(self):
        """A directly mounted disabled consumer uses the same code as ASGI routing."""
        with override_settings(PRESENCE_ENABLED=False):
            async with real_redis():
                socket = WebsocketCommunicator(ObservedPresenceConsumer.as_asgi(), '/ws/presence/')
                try:
                    accepted, close_code = await socket.connect()
                    self.assertFalse(accepted)
                    self.assertEqual(close_code, 4404)
                    self.assertFalse(ObservedPresenceConsumer.instances[0]._admitted)
                finally:
                    await socket.disconnect()

    async def test_message_and_socket_limits_return_retryable_errors(self):
        """Shared limits are applied in the public WebSocket path."""
        with override_settings(PRESENCE_MESSAGE_RATE=2, PRESENCE_MAX_CONNECTIONS_PER_IP=1):
            async with real_redis():
                first, second = self._socket(), self._socket()
                try:
                    await first.connect()
                    await first.send_json_to(hello(analytics=False))
                    await self._count(first, 1)
                    await second.connect()
                    await self._error(second, 'capacity_reached')
                    self.assertEqual((await second.receive_output())['code'], 4413)
                    await first.send_json_to({'v': 1, 'type': 'heartbeat'})
                    await self._count(first, 1)
                    await first.send_json_to({'v': 1, 'type': 'heartbeat'})
                    await self._error(first, 'rate_limited')
                    self.assertEqual((await first.receive_output())['code'], 4413)
                finally:
                    await first.disconnect()
                    await second.disconnect()

    async def test_redis_failure_closes_and_new_hello_repopulates_lost_namespace(self):
        """Recovery uses a new handshake/group subscription and durable visit dedup."""
        async with real_redis() as client:
            failed = self._socket()
            identifier = str(uuid4())
            try:
                await failed.connect()
                await failed.send_json_to(hello(visitor_id=identifier))
                await self._count(failed, 1)
                instance = ObservedPresenceConsumer.instances[0]
                with patch.object(
                    instance.leases.client,
                    'eval',
                    AsyncMock(side_effect=RedisConnectionError('Redis unavailable')),
                ):
                    await failed.send_json_to({'v': 1, 'type': 'heartbeat'})
                    await self._error(failed, 'service_unavailable')
                    self.assertEqual((await failed.receive_output())['code'], 4413)
                await failed.disconnect()
                keys = [key async for key in client.scan_iter(match=f'{instance.leases.prefix}:*')]
                if keys:
                    await client.delete(*keys)
                recovered, other = self._socket(), self._socket()
                try:
                    await recovered.connect()
                    await recovered.send_json_to(hello(visitor_id=identifier))
                    await self._count(recovered, 1)
                    await other.connect()
                    await other.send_json_to(hello(analytics=False))
                    await self._count(other, 2)
                    await self._count(recovered, 2)
                    self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 1)
                finally:
                    await recovered.disconnect()
                    await other.disconnect()
            finally:
                await failed.disconnect()

    async def test_channel_group_failure_closes_and_does_not_send_a_fake_snapshot(self):
        """A failed broadcast is a delivery outage requiring controlled recovery."""
        async with real_redis():
            socket = self._socket()
            try:
                await socket.connect()
                instance = ObservedPresenceConsumer.instances[0]
                with patch.object(
                    instance.channel_layer,
                    'group_add',
                    AsyncMock(side_effect=RedisConnectionError('Layer unavailable')),
                ):
                    await socket.send_json_to(hello(analytics=False))
                    await self._error(socket, 'service_unavailable')
                    self.assertEqual((await socket.receive_output())['code'], 4413)
            finally:
                await socket.disconnect()

    async def test_error_closes_before_blocked_cleanup_and_consumer_exits_within_budget(self):
        """Namespace loss closes immediately even if Redis cleanup never finishes."""
        with patch.object(ObservedPresenceConsumer, 'cleanup_timeout', 0.15):
            async with real_redis() as client:
                socket = self._socket()
                cleanup_entered = asyncio.Event()
                cleanup_cancelled = asyncio.Event()

                async def stalled_remove(*args):
                    cleanup_entered.set()
                    try:
                        await asyncio.Event().wait()
                    finally:
                        cleanup_cancelled.set()

                try:
                    await socket.connect()
                    await socket.send_json_to(hello(analytics=False))
                    await self._count(socket, 1)
                    instance = ObservedPresenceConsumer.instances[0]
                    observer = instance._observer_task
                    keys = [
                        key async for key in client.scan_iter(match=f'{instance.leases.prefix}:*')
                    ]
                    await client.delete(*keys)
                    with patch.object(instance.leases, 'remove', side_effect=stalled_remove):
                        await socket.send_json_to({'v': 1, 'type': 'heartbeat'})
                        await self._error(socket, 'lease_expired')
                        closing = await socket.receive_output(timeout=0.05)
                        self.assertEqual(closing, {'type': 'websocket.close', 'code': 4408})
                        await asyncio.wait_for(cleanup_entered.wait(), timeout=0.1)
                        self.assertFalse(cleanup_cancelled.is_set())
                        self.assertTrue(observer.done())
                        await socket.disconnect(timeout=1)
                        self.assertTrue(cleanup_cancelled.is_set())
                        self.assertTrue(socket.future.done())
                        self.assertIsNone(instance._observer_task)
                finally:
                    await socket.disconnect(timeout=1)

    async def test_cleanup_does_not_wait_forever_for_observer_cancellation(self):
        """Cancellation waiting on the receive lock cannot prevent consumer exit."""
        with patch.object(ObservedPresenceConsumer, 'observer_cancel_timeout', 0.03):
            async with real_redis():
                socket = self._socket()
                cancellation_entered = asyncio.Event()
                waiting = asyncio.Event()
                try:
                    await socket.connect()
                    await socket.send_json_to(hello(analytics=False))
                    await self._count(socket, 1)
                    instance = ObservedPresenceConsumer.instances[0]
                    observer = instance._observer_task
                    observer.cancel()
                    with suppress(asyncio.CancelledError):
                        await observer

                    async def lock_waiting_observer():
                        waiting.set()
                        try:
                            await asyncio.Event().wait()
                        finally:
                            cancellation_entered.set()
                            async with instance._operation_lock:
                                pass

                    observer = asyncio.create_task(lock_waiting_observer())
                    instance._observer_task = observer
                    await waiting.wait()
                    await socket.send_json_to(hello(analytics=False))
                    await self._error(socket, 'already_initialized')
                    self.assertEqual((await socket.receive_output(timeout=0.05))['code'], 4408)
                    await asyncio.wait_for(cancellation_entered.wait(), timeout=0.1)
                    await socket.disconnect(timeout=1)
                    with suppress(asyncio.CancelledError):
                        await asyncio.wait_for(observer, timeout=0.1)
                    self.assertTrue(observer.done())
                    self.assertTrue(socket.future.done())
                finally:
                    await socket.disconnect(timeout=1)

    async def test_database_outage_preserves_count_and_does_not_cache_failed_visit(self):
        """Statistics retry later while functional presence remains live."""
        async with real_redis():
            socket = self._socket()
            try:
                await socket.connect()
                with patch(
                    'apps.presence.consumers.record_visit',
                    side_effect=OperationalError('Database unavailable'),
                ):
                    await socket.send_json_to(hello())
                    snapshot = await self._count(socket, 1)
                self.assertFalse(snapshot['analytics_available'])
                instance = ObservedPresenceConsumer.instances[0]
                day = local_day().isoformat()
                self.assertFalse(
                    await instance.leases.visit_acknowledged('default', instance._visitor_key, day)
                )
                await socket.send_json_to({'v': 1, 'type': 'heartbeat'})
                snapshot = await self._count(socket, 1)
                self.assertTrue(snapshot['analytics_available'])
                self.assertEqual(await database_sync_to_async(DailyVisit.objects.count)(), 1)
            finally:
                await socket.disconnect()

    async def test_peak_writer_flushes_higher_peak_observed_while_sql_is_running(self):
        """The SQL claim owner flushes a transient rise before releasing the path."""
        async with real_redis():
            socket = self._socket()
            try:
                await socket.connect()
                instance = ObservedPresenceConsumer.instances[0]
                original = record_peak
                calls = []

                async def observed_write(scope, count, now=None):
                    calls.append(count)
                    if count == 1:
                        other_connection = str(uuid4())
                        await instance.leases.renew('default', other_connection, 'b' * 64)
                        await instance.leases.remove('default', other_connection)
                    return await database_sync_to_async(original)(scope, count, now=now)

                def wrap(function):
                    if function is record_visit:
                        return database_sync_to_async(function)
                    return observed_write

                with patch('apps.presence.consumers.database_sync_to_async', side_effect=wrap):
                    await socket.send_json_to(hello(analytics=False))
                    await self._count(socket, 1)
                self.assertEqual(calls, [1, 2])
                summary = await database_sync_to_async(DailyPresenceSummary.objects.get)(
                    scope='default', day=local_day()
                )
                self.assertEqual(summary.peak_active, 2)
            finally:
                await socket.disconnect()
