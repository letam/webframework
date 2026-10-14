"""Real Redis evidence for atomic leases and shared capacity/rate limits."""

import asyncio
import hashlib
import os
from contextlib import asynccontextmanager
from unittest import skipUnless
from uuid import uuid4

from channels.layers import get_channel_layer
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings
from redis.asyncio import Redis

from apps.presence.leases import (
    PresenceLeaseStore,
    PresenceLimitError,
    PresenceUnavailableError,
    close_presence_connections,
    hash_ip,
)
from apps.presence.statistics import local_day

TEST_REDIS_URL = os.environ.get('TEST_REDIS_URL', '')
if os.environ.get('REQUIRE_REALTIME_TESTS') == '1' and not TEST_REDIS_URL:
    raise ImproperlyConfigured('REQUIRE_REALTIME_TESTS=1 requires TEST_REDIS_URL')


def redis_case_settings(**overrides):
    """Give each test a distinct instance namespace on the supplied real Redis."""
    prefix = f'presence-test-{uuid4().hex}'
    values = {
        'REALTIME_ENABLED': True,
        'PRESENCE_ENABLED': True,
        'REALTIME_REDIS_URL': TEST_REDIS_URL,
        'REALTIME_PREFIX': prefix,
        'PRESENCE_HASH_KEY': 'test-presence-secret-key-that-is-never-a-production-secret',
        'PRESENCE_TIME_ZONE': 'America/Toronto',
        'PRESENCE_SCOPES': {
            'default': {'origins': ['https://reading.example']},
            'other': {'origins': ['https://other.example']},
        },
        'PRESENCE_LEASE_SECONDS': 60,
        'PRESENCE_HEARTBEAT_SECONDS': 20,
        'PRESENCE_MAX_CONNECTIONS': 10000,
        'PRESENCE_MAX_SCOPE_CONNECTIONS': 10000,
        'PRESENCE_MAX_CONNECTIONS_PER_IP': 50,
        'PRESENCE_MESSAGE_LIMIT': 2048,
        'PRESENCE_OBSERVATION_SECONDS': 3,
        'PRESENCE_HELLO_SECONDS': 10,
        'PRESENCE_MESSAGE_RATE': 12,
        'PRESENCE_IP_MESSAGE_RATE': 600,
        'PRESENCE_CONNECT_RATE': 120,
        'PRESENCE_RATE_WINDOW_SECONDS': 60,
        'PRESENCE_TRUSTED_PROXY_NETWORKS': [],
        'PRESENCE_PROXY_IP_HEADER': 'fly-client-ip',
        'CHANNEL_LAYERS': {
            'default': {
                'BACKEND': 'channels_redis.core.RedisChannelLayer',
                'CONFIG': {
                    'hosts': [TEST_REDIS_URL],
                    'prefix': f'{prefix}:channels',
                    'group_expiry': 120,
                    'capacity': 100,
                },
            },
        },
    }
    values.update(overrides)
    return override_settings(**values)


@asynccontextmanager
async def real_redis():
    """Clean only this random test namespace, never a shared database or FLUSHDB."""
    client = Redis.from_url(
        TEST_REDIS_URL, decode_responses=True, socket_connect_timeout=2, socket_timeout=2
    )
    try:
        await client.ping()
        yield client
    finally:
        layer = get_channel_layer()
        if layer is not None and hasattr(layer, 'close_pools'):
            await layer.close_pools()
        await close_presence_connections()
        keys = [key async for key in client.scan_iter(match=f'{settings.REALTIME_PREFIX}:*')]
        if keys:
            await client.delete(*keys)
        await client.aclose()


def visitor_key(value):
    """Return a realistic pseudonym for lease-only fixtures."""
    return hashlib.sha256(value.encode()).hexdigest()


@skipUnless(TEST_REDIS_URL, 'Set TEST_REDIS_URL to run real Redis lease tests')
class RedisLeaseTests(SimpleTestCase):
    """Exercise Lua atomicity and cardinality using actual shared Redis state."""

    def setUp(self):
        """Isolate all Redis and channel-layer keys for each test."""
        self.settings_override = redis_case_settings()
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)

    async def test_tabs_are_deduplicated_and_one_tab_cannot_remove_another(self):
        """Disconnect and inactivity remove only the matching connection UUID."""
        async with real_redis() as client:
            store = PresenceLeaseStore(client)
            first, second, third = [str(uuid4()) for _ in range(3)]
            shared, distinct = visitor_key('shared'), visitor_key('distinct')
            self.assertEqual((await store.renew('default', first, shared)).count, 1)
            self.assertEqual((await store.renew('default', second, shared)).count, 1)
            snapshot = await store.renew('default', third, distinct)
            self.assertEqual(snapshot.count, 2)
            self.assertEqual((await store.remove('default', first)).count, 2)
            self.assertEqual((await store.remove('default', first)).count, 2)
            self.assertEqual((await store.remove('default', second)).count, 1)
            self.assertEqual((await store.remove('default', third)).count, 0)
            self.assertEqual(await client.hlen(f'{store.scope_prefix("default")}:connections'), 0)

    async def test_concurrent_workers_atomically_keep_visitor_reference_counts(self):
        """Concurrent stores share the same visitor refcounts and current count."""
        async with real_redis() as client:
            second_client = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
            try:
                stores = [PresenceLeaseStore(client), PresenceLeaseStore(second_client)]
                connection_ids = [str(uuid4()) for _ in range(100)]
                await asyncio.gather(
                    *(
                        stores[index % 2].renew(
                            'default', connection, visitor_key(str(index % 10))
                        )
                        for index, connection in enumerate(connection_ids)
                    )
                )
                self.assertEqual((await stores[0].observe('default')).count, 10)
                refs = await client.hgetall(f'{stores[0].scope_prefix("default")}:visitors')
                self.assertEqual(sorted(map(int, refs.values())), [10] * 10)
                await asyncio.gather(
                    *(
                        stores[index % 2].remove('default', connection)
                        for index, connection in enumerate(connection_ids)
                    )
                )
                self.assertEqual((await stores[1].observe('default')).count, 0)
            finally:
                await second_client.aclose()

    async def test_expiry_prunes_metadata_and_preserves_an_unexpired_sibling_tab(self):
        """A stale tab cannot delete a visitor whose other tab is still live."""
        async with real_redis() as client:
            store = PresenceLeaseStore(client)
            first, second = str(uuid4()), str(uuid4())
            shared = visitor_key('shared')
            await store.renew('default', first, shared)
            await store.renew('default', second, shared)
            prefix = store.scope_prefix('default')
            await client.zadd(f'{prefix}:leases', {first: 1})
            snapshot = await store.observe('default')
            self.assertEqual(snapshot.count, 1)
            self.assertFalse(snapshot.changed)
            self.assertIsNone(await client.hget(f'{prefix}:connections', first))
            self.assertEqual(await client.hget(f'{prefix}:visitors', shared), '1')
            await client.zadd(f'{prefix}:leases', {second: 1})
            snapshot = await store.observe('default')
            self.assertEqual(snapshot.count, 0)
            self.assertTrue(snapshot.changed)
            self.assertEqual(await client.hlen(f'{prefix}:connections'), 0)
            self.assertEqual(await client.hlen(f'{prefix}:visitors'), 0)

    async def test_real_lease_expiry_uses_redis_time_and_observe_without_a_join(self):
        """An actual short lease expires without renewal or a new connection."""
        with override_settings(PRESENCE_LEASE_SECONDS=1):
            async with real_redis() as client:
                store = PresenceLeaseStore(client)
                first = await store.renew('default', str(uuid4()), visitor_key('reader'))
                seconds, microseconds = await client.time()
                self.assertLess(
                    abs(first.server_time.timestamp() - seconds - microseconds / 1e6), 1
                )
                await asyncio.sleep(1.1)
                expired = await store.observe('default')
                self.assertEqual(expired.count, 0)
                self.assertGreater(expired.sequence, first.sequence)

    async def test_shared_admission_limits_include_hidden_sockets_and_prune_slots(self):
        """Global, peer and scope capacity apply across independent store instances."""
        with override_settings(
            PRESENCE_MAX_CONNECTIONS=3,
            PRESENCE_MAX_CONNECTIONS_PER_IP=2,
            PRESENCE_MAX_SCOPE_CONNECTIONS=1,
        ):
            async with real_redis() as client:
                first, second = PresenceLeaseStore(client), PresenceLeaseStore(client)
                connections = [str(uuid4()) for _ in range(4)]
                await first.admit(connections[0], hash_ip('192.0.2.1'))
                await second.admit(connections[1], hash_ip('192.0.2.1'))
                with self.assertRaises(PresenceLimitError) as caught:
                    await first.admit(connections[2], hash_ip('192.0.2.1'))
                self.assertEqual(caught.exception.code, 'capacity_reached')
                await first.admit(connections[2], hash_ip('192.0.2.2'))
                with self.assertRaises(PresenceLimitError):
                    await second.admit(connections[3], hash_ip('192.0.2.3'))
                await first.bind_scope(connections[0], 'default')
                with self.assertRaises(PresenceLimitError):
                    await second.bind_scope(connections[1], 'default')
                await first.release(connections[0])
                await first.release(connections[0])
                await second.bind_scope(connections[1], 'default')
                await client.zadd(
                    f'{first.prefix}:open',
                    {
                        connections[1]: 1,
                        connections[2]: 1,
                    },
                )
                await second.admit(connections[3], hash_ip('192.0.2.3'))
                self.assertEqual(await client.zcard(f'{first.prefix}:open'), 1)
                self.assertEqual(await client.hlen(f'{first.prefix}:ips'), 1)
                self.assertEqual(await client.hlen(f'{first.prefix}:ip-counts'), 1)
                self.assertEqual(await client.hlen(f'{first.prefix}:scope-counts'), 0)

    async def test_shared_message_limits_cover_connections_and_peer_aggregate(self):
        """A second worker cannot bypass connection or peer message budgets."""
        with override_settings(PRESENCE_MESSAGE_RATE=2, PRESENCE_IP_MESSAGE_RATE=3):
            async with real_redis() as client:
                first, second = PresenceLeaseStore(client), PresenceLeaseStore(client)
                ip = hash_ip('192.0.2.1')
                await first.check_message_rate('connection-a', ip)
                await second.check_message_rate('connection-a', ip)
                await first.check_message_rate('connection-b', ip)
                with self.assertRaises(PresenceLimitError) as caught:
                    await second.check_message_rate('connection-b', ip)
                self.assertEqual(caught.exception.code, 'rate_limited')
                with self.assertRaises(PresenceLimitError):
                    await second.check_message_rate('connection-a', hash_ip('192.0.2.2'))

    async def test_connect_rate_survives_disconnect_and_is_shared(self):
        """Socket churn cannot reset the shared per-peer connection attempt budget."""
        with override_settings(PRESENCE_CONNECT_RATE=2):
            async with real_redis() as client:
                stores = [PresenceLeaseStore(client), PresenceLeaseStore(client)]
                ip = hash_ip('192.0.2.1')
                for index in range(2):
                    connection = str(uuid4())
                    await stores[index].admit(connection, ip)
                    await stores[index].release(connection)
                with self.assertRaises(PresenceLimitError) as caught:
                    await stores[0].admit(str(uuid4()), ip)
                self.assertEqual(caught.exception.code, 'rate_limited')

    async def test_visit_cache_requires_ack_and_separates_local_days(self):
        """Only explicit successful recording acknowledgements populate the cache."""
        async with real_redis() as client:
            store = PresenceLeaseStore(client)
            visitor = visitor_key('reader')
            self.assertFalse(await store.visit_acknowledged('default', visitor, '2026-10-12'))
            await store.acknowledge_visit('default', visitor, '2026-10-12')
            self.assertTrue(await store.visit_acknowledged('default', visitor, '2026-10-12'))
            self.assertFalse(await store.visit_acknowledged('default', visitor, '2026-10-13'))
            self.assertLessEqual(
                await client.ttl(store._visit_key('default', visitor, '2026-10-12')), 120
            )

    async def test_peak_claim_does_not_lose_a_brief_higher_count_during_write(self):
        """Lease mutation retains a transient peak even while SQL's claim is held."""
        async with real_redis() as client:
            first, second = PresenceLeaseStore(client), PresenceLeaseStore(client)
            one, two = str(uuid4()), str(uuid4())
            initial = await first.renew('default', one, visitor_key('one'))
            day = local_day(initial.server_time).isoformat()
            claim = await first.claim_peak('default', 1, day)
            self.assertEqual(claim.count, 1)
            await second.renew('default', two, visitor_key('two'))
            self.assertIsNone(await second.claim_peak('default', 2, day))
            self.assertEqual((await second.remove('default', two)).count, 1)
            pending = await first.acknowledge_peak('default', claim.count, day, claim.token)
            self.assertTrue(pending)
            next_claim = await first.claim_peak('default', 0, day)
            self.assertEqual(next_claim.count, 2)
            self.assertFalse(
                await first.acknowledge_peak('default', next_claim.count, day, next_claim.token)
            )
            self.assertIsNone(await second.claim_peak('default', 1, day))

    async def test_redis_failure_raises_unavailable_instead_of_fabricating_zero(self):
        """An actual refused Redis connection cannot masquerade as an empty scope."""
        client = Redis.from_url(
            'redis://127.0.0.1:1/0',
            decode_responses=True,
            socket_connect_timeout=0.1,
            socket_timeout=0.1,
        )
        try:
            with self.assertRaises(PresenceUnavailableError):
                await PresenceLeaseStore(client).observe('default')
        finally:
            await client.aclose()
