"""Real Redis socket evidence for room synchronization and live access checks."""

import asyncio
import os
from contextlib import suppress
from datetime import timedelta
from time import monotonic
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from config.asgi import build_application
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core.exceptions import ImproperlyConfigured
from django.db import OperationalError
from django.test import Client, SimpleTestCase, TransactionTestCase, override_settings
from django.utils import timezone
from redis.asyncio import Redis

from apps.practice.consumers import PracticeConsumer, _parse
from apps.practice.leases import PracticeLeaseStore, close_practice_connections
from apps.practice.models import RoomCommand
from apps.practice.service import PracticeError, create_room, join_room, manage_membership

TEST_REDIS_URL = os.environ.get('TEST_REDIS_URL', '')
if os.environ.get('REQUIRE_REALTIME_TESTS') == '1' and not TEST_REDIS_URL:
    raise ImproperlyConfigured('REQUIRE_REALTIME_TESTS=1 requires TEST_REDIS_URL')


class PracticeProtocolTests(SimpleTestCase):
    """Reject malformed socket envelopes before they reach room state."""

    def test_strict_versioned_envelopes(self):
        """Duplicate keys, bad IDs, booleans and unbounded payloads are invalid."""
        valid_id = str(uuid4())
        invalid = [
            b'binary',
            '{',
            '[]',
            '{"v":1,"v":1,"type":"hello","sync_id":"' + valid_id + '"}',
            '{"v":true,"type":"hello","sync_id":"' + valid_id + '"}',
            '{"v":1,"type":"hello","sync_id":"bad"}',
            '{"v":1,"type":"heartbeat","sync_id":"' + valid_id + '","extra":1}',
            '{"v":1,"type":"timer.command","request_id":"'
            + valid_id
            + '","expected_revision":true,"action":"start"}',
            '{"v":1,"type":"timer.command","request_id":"'
            + valid_id
            + '","expected_revision":0,"action":[]}',
            'x' * (settings.PRACTICE_MESSAGE_LIMIT + 1),
            '[' * 1000 + '0' + ']' * 1000,
        ]
        for value in invalid:
            with self.subTest(value=str(value)[:60]), self.assertRaises(PracticeError):
                _parse(
                    value if isinstance(value, str) else None,
                    value if isinstance(value, bytes) else None,
                )


@skipUnless(TEST_REDIS_URL, 'Real Redis URL required')
class PracticeTransportTests(TransactionTestCase):
    """A real Channels Redis layer shares events between authenticated sockets."""

    def setUp(self):
        """Build separate host and participant sessions on a durable room."""
        user_model = get_user_model()
        self.host = user_model.objects.create_user(username='host', password='examplepass123')
        self.guest = user_model.objects.create_user(username='guest', password='examplepass123')
        snapshot, secret = create_room(self.host.id, 'Together')
        self.room_id = snapshot['room_id']
        join_room(self.room_id, self.guest.id, secret)
        self.host_client = Client()
        self.host_client.force_login(self.host)
        self.guest_client = Client()
        self.guest_client.force_login(self.guest)
        self.prefix = f'practice-test-{uuid4().hex}'
        self.settings_override = override_settings(
            REALTIME_ENABLED=True,
            PRACTICE_ENABLED=True,
            PRESENCE_ENABLED=False,
            REALTIME_REDIS_URL=TEST_REDIS_URL,
            REALTIME_PREFIX=self.prefix,
            PRACTICE_ORIGINS=['https://practice.example'],
            CHANNEL_LAYERS={
                'default': {
                    'BACKEND': 'channels_redis.core.RedisChannelLayer',
                    'CONFIG': {'hosts': [TEST_REDIS_URL], 'prefix': f'{self.prefix}:channels'},
                }
            },
        )
        self.settings_override.enable()

    def tearDown(self):
        """Restore the test instance configuration after each socket case."""
        self.settings_override.disable()

    def socket(self, client, origin='https://practice.example'):
        """Connect with a real Django session cookie and explicit origin."""
        cookie = client.cookies['sessionid'].value
        return WebsocketCommunicator(
            build_application(),
            f'/ws/practice/rooms/{self.room_id}/',
            headers=[(b'origin', origin.encode()), (b'cookie', f'sessionid={cookie}'.encode())],
        )

    async def _cleanup(self, *sockets):
        for socket in sockets:
            with suppress(Exception):
                await socket.disconnect(timeout=1)
        layer = get_channel_layer()
        if layer is not None and hasattr(layer, 'close_pools'):
            await layer.close_pools()
        await close_practice_connections()
        client = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
        try:
            keys = [key async for key in client.scan_iter(match=f'{self.prefix}:*')]
            if keys:
                await client.delete(*keys)
        finally:
            await client.aclose()

    async def test_host_command_reaches_guest_and_replay_is_stable(self):
        """Broadcasts carry fresh personalized state; retries keep one revision."""
        host, guest = self.socket(self.host_client), self.socket(self.guest_client)
        try:
            self.assertTrue((await host.connect())[0])
            self.assertEqual((await host.receive_json_from())['type'], 'room.snapshot')
            self.assertTrue((await guest.connect())[0])
            self.assertEqual((await guest.receive_json_from())['current_user_id'], self.guest.id)
            await host.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
            while (await host.receive_json_from())['type'] != 'room.snapshot':
                pass
            request_id = str(uuid4())
            command = {
                'v': 1,
                'type': 'timer.command',
                'request_id': request_id,
                'expected_revision': 0,
                'action': 'start',
            }
            await host.send_json_to(command)
            while (result := await host.receive_json_from())['type'] != 'command.result':
                pass
            self.assertTrue(result['accepted'])
            self.assertEqual(result['accepted_revision'], 1)
            await guest.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
            for _ in range(5):
                message = await guest.receive_json_from()
                if message['type'] == 'room.snapshot' and message['revision'] == 1:
                    break
            else:
                self.fail('Guest did not receive the authoritative start')
            self.assertEqual(message['current_user_id'], self.guest.id)
            await host.send_json_to(command)
            while (replay := await host.receive_json_from())['type'] != 'command.result':
                pass
            self.assertTrue(replay['replayed'])
            self.assertEqual(replay['accepted_revision'], 1)
        finally:
            await self._cleanup(host, guest)

    async def test_revoked_member_and_bad_origin_fail(self):
        """Origin and durable membership are checked beyond the handshake."""
        bad = self.socket(self.host_client, origin='https://evil.example')
        self.assertFalse((await bad.connect())[0])
        await bad.disconnect()
        cookie = self.host_client.cookies['sessionid'].value
        duplicated = WebsocketCommunicator(
            build_application(),
            f'/ws/practice/rooms/{self.room_id}/',
            headers=[
                (b'origin', b'https://practice.example'),
                (b'origin', b'https://practice.example'),
                (b'cookie', f'sessionid={cookie}'.encode()),
            ],
        )
        self.assertFalse((await duplicated.connect())[0])
        await duplicated.disconnect()
        guest = self.socket(self.guest_client)
        try:
            self.assertTrue((await guest.connect())[0])
            await guest.receive_json_from()
            await database_sync_to_async(manage_membership)(
                self.room_id, self.host.id, 'revoke', self.guest.id
            )
            await guest.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
            for _ in range(5):
                message = await guest.receive_json_from()
                if message['type'] == 'error':
                    self.assertEqual(message['code'], 'forbidden')
                    break
            else:
                self.fail('Revoked membership stayed on the socket')
        finally:
            await self._cleanup(guest)

    async def test_http_roster_and_revocation_notify_open_socket(self):
        """HTTP reads live leases and a committed host ban closes the active member."""
        host, guest = self.socket(self.host_client), self.socket(self.guest_client)
        try:
            self.assertTrue((await host.connect())[0])
            await host.receive_json_from()
            self.assertTrue((await guest.connect())[0])
            await guest.receive_json_from()
            room_url = f'/api/practice/rooms/{self.room_id}/'
            response = await database_sync_to_async(self.host_client.get)(room_url)
            self.assertEqual(response.status_code, 200)
            members = response.json()['members']
            self.assertTrue(all(member['connected'] for member in members))
            revoke = f'{room_url}members/{self.guest.id}/revoke/'
            response = await database_sync_to_async(self.host_client.post)(
                revoke, data='{}', content_type='application/json'
            )
            self.assertEqual(response.status_code, 200)
            for _ in range(6):
                message = await guest.receive_json_from()
                if message['type'] == 'error':
                    self.assertEqual(message['code'], 'forbidden')
                    break
            else:
                self.fail('Committed revocation did not invalidate the active socket')
        finally:
            await self._cleanup(host, guest)

    async def test_logout_and_redis_namespace_loss_force_reconnect(self):
        """A renewed socket checks session storage and cannot recreate lost leases."""
        host = self.socket(self.host_client)
        try:
            self.assertTrue((await host.connect())[0])
            await host.receive_json_from()
            await host.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
            while (await host.receive_json_from())['type'] != 'room.snapshot':
                pass
            store = PracticeLeaseStore()
            await store.client.delete(*store._keys(self.room_id))
            await host.send_json_to(
                {
                    'v': 1,
                    'type': 'timer.command',
                    'request_id': str(uuid4()),
                    'expected_revision': 0,
                    'action': 'start',
                }
            )
            for _ in range(4):
                message = await host.receive_json_from()
                if message['type'] == 'error':
                    self.assertEqual(message['code'], 'lease_expired')
                    break
            else:
                self.fail('Lost room lease was silently recreated')
            self.assertEqual(await database_sync_to_async(RoomCommand.objects.count)(), 0)
        finally:
            await self._cleanup(host)
        recovered = self.socket(self.host_client)
        try:
            self.assertTrue((await recovered.connect())[0])
            await recovered.receive_json_from()
            await database_sync_to_async(self.host_client.logout)()
            await recovered.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
            for _ in range(4):
                message = await recovered.receive_json_from()
                if message['type'] == 'error':
                    self.assertEqual(message['code'], 'forbidden')
                    break
            else:
                self.fail('Logged-out session remained authorized')
        finally:
            await self._cleanup(recovered)

    async def test_hello_timeout_and_malformed_flood_are_bounded(self):
        """A silent or malformed socket cannot retain capacity indefinitely."""
        with override_settings(PRACTICE_HELLO_SECONDS=0.05):
            silent = self.socket(self.host_client)
            try:
                self.assertTrue((await silent.connect())[0])
                await silent.receive_json_from()
                for _ in range(4):
                    message = await silent.receive_json_from(timeout=1)
                    if message['type'] == 'error':
                        break
                else:
                    self.fail('Silent socket missed its hello deadline')
                self.assertEqual((message['type'], message['code']), ('error', 'hello_timeout'))
                self.assertEqual((await silent.receive_output())['code'], 4408)
            finally:
                await self._cleanup(silent)
        with override_settings(PRACTICE_MESSAGE_RATE=2):
            noisy = self.socket(self.host_client)
            try:
                self.assertTrue((await noisy.connect())[0])
                await noisy.receive_json_from()
                for _ in range(2):
                    await noisy.send_to(text_data='{')
                    while (message := await noisy.receive_json_from())['type'] != 'error':
                        pass
                    self.assertEqual(message['code'], 'invalid_request')
                await noisy.send_to(text_data='{')
                while (message := await noisy.receive_json_from())['type'] != 'error':
                    pass
                self.assertEqual(message['code'], 'rate_limited')
            finally:
                await self._cleanup(noisy)

    async def test_lease_expiry_and_instance_capacity(self):
        """Silent sockets expire and a global admission cap spans room users."""
        with override_settings(PRACTICE_LEASE_SECONDS=1, PRACTICE_HEARTBEAT_SECONDS=0.1):
            silent = self.socket(self.host_client)
            try:
                self.assertTrue((await silent.connect())[0])
                await silent.receive_json_from()
                await silent.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
                while (await silent.receive_json_from())['type'] != 'room.snapshot':
                    pass
                for _ in range(12):
                    message = await silent.receive_json_from(timeout=2)
                    if message['type'] == 'error':
                        self.assertEqual(message['code'], 'lease_expired')
                        break
                else:
                    self.fail('Silent connection outlived its Redis lease')
            finally:
                await self._cleanup(silent)
        with override_settings(PRACTICE_MAX_CONNECTIONS=1):
            host, guest = self.socket(self.host_client), self.socket(self.guest_client)
            try:
                self.assertTrue((await host.connect())[0])
                await host.receive_json_from()
                accepted, code = await guest.connect()
                self.assertFalse(accepted)
                self.assertEqual(code, 4413)
            finally:
                await self._cleanup(host, guest)

    async def test_session_expiry_password_change_and_inactive_user_close(self):
        """Each renewal reloads the stored session and current user auth hash."""

        async def fail_after(change):
            await database_sync_to_async(self.host_client.force_login)(self.host)
            socket = self.socket(self.host_client)
            try:
                self.assertTrue((await socket.connect())[0])
                await socket.receive_json_from()
                await database_sync_to_async(change)()
                await socket.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
                for _ in range(4):
                    message = await socket.receive_json_from()
                    if message['type'] == 'error':
                        self.assertEqual(message['code'], 'forbidden')
                        return
                self.fail('Invalidated user session remained authorized')
            finally:
                await self._cleanup(socket)

        def expire():
            Session.objects.filter(session_key=self.host_client.cookies['sessionid'].value).update(
                expire_date=timezone.now() - timedelta(seconds=1)
            )

        def password_change():
            self.host.set_password('new-password-example')
            self.host.save(update_fields=['password'])

        def deactivate():
            self.host.is_active = False
            self.host.save(update_fields=['is_active'])

        await fail_after(expire)
        await fail_after(password_change)
        await fail_after(deactivate)

    async def test_database_failure_on_renewal_closes_safely(self):
        """An active socket does not disclose a database exception to clients."""
        socket = self.socket(self.host_client)
        try:
            self.assertTrue((await socket.connect())[0])
            await socket.receive_json_from()
            await socket.send_json_to({'v': 1, 'type': 'hello', 'sync_id': str(uuid4())})
            while (await socket.receive_json_from())['type'] != 'room.snapshot':
                pass
            with patch(
                'apps.practice.consumers.get_snapshot', side_effect=OperationalError('secret SQL')
            ):
                await socket.send_json_to({'v': 1, 'type': 'heartbeat', 'sync_id': str(uuid4())})
                for _ in range(4):
                    message = await socket.receive_json_from()
                    if message['type'] == 'error':
                        self.assertEqual(message['code'], 'service_unavailable')
                        self.assertNotIn('secret SQL', str(message))
                        break
                else:
                    self.fail('Database outage left socket active')
        finally:
            await self._cleanup(socket)

    async def test_cleanup_returns_when_presence_publish_stalls(self):
        """Disconnect exits within its budget even if group publishing never returns."""
        socket = self.socket(self.host_client)
        try:
            self.assertTrue((await socket.connect())[0])
            await socket.receive_json_from()

            async def stalled_publish(self, roster):
                await asyncio.Event().wait()

            started = monotonic()
            with patch.object(PracticeConsumer, '_publish_presence', stalled_publish):
                await socket.disconnect(timeout=4)
            self.assertLess(monotonic() - started, 3.8)
        finally:
            await self._cleanup(socket)
