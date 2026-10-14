"""Bounded Redis connection leases, distinct-user roster and shared socket limits."""

import asyncio
import hashlib
import weakref
from dataclasses import dataclass
from datetime import UTC, datetime

from django.conf import settings
from redis import Redis as SyncRedis
from redis.asyncio import BlockingConnectionPool, Redis
from redis.exceptions import RedisError

from .limits import PracticeRateLimitError, PracticeUnavailableError


class PracticeLeaseExpiredError(RuntimeError):
    """A Redis namespace or this connection's lease was lost."""


_CLIENTS = weakref.WeakKeyDictionary()

_ADMISSION_SCRIPT = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local action, cid, ip = ARGV[1], ARGV[2], ARGV[3]
local ttl, max_all, max_ip = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])
local function remove(connection)
    local old_ip = redis.call('HGET', KEYS[2], connection)
    if old_ip then
        local count = redis.call('HINCRBY', KEYS[3], old_ip, -1)
        if count <= 0 then redis.call('HDEL', KEYS[3], old_ip) end
    end
    redis.call('ZREM', KEYS[1], connection)
    redis.call('HDEL', KEYS[2], connection)
end
for _, expired in ipairs(redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)) do
    remove(expired)
end
local status = 'ok'
if action == 'admit' then
    if redis.call('ZCARD', KEYS[1]) >= max_all
       or tonumber(redis.call('HGET', KEYS[3], ip) or '0') >= max_ip then
        status = 'capacity_reached'
    else
        redis.call('ZADD', KEYS[1], now + ttl, cid)
        redis.call('HSET', KEYS[2], cid, ip)
        redis.call('HINCRBY', KEYS[3], ip, 1)
    end
elseif action == 'refresh' then
    if redis.call('ZSCORE', KEYS[1], cid) then
        redis.call('ZADD', KEYS[1], now + ttl, cid)
    else
        status = 'lease_expired'
    end
elseif action == 'check' then
    if not redis.call('ZSCORE', KEYS[1], cid) then status = 'lease_expired' end
elseif action == 'release' then
    remove(cid)
end
for i = 1, 3 do redis.call('PEXPIRE', KEYS[i], ttl * 2) end
return status
"""

_LEASE_SCRIPT = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local action, cid, uid = ARGV[1], ARGV[2], ARGV[3]
local ttl, max_room, max_user = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])
local sequence = tonumber(redis.call('HGET', KEYS[4], 'sequence') or '0')
local changed = 0
local function remove(connection)
    local user = redis.call('HGET', KEYS[2], connection)
    if user then
        local count = redis.call('HINCRBY', KEYS[3], user, -1)
        if count <= 0 then
            redis.call('HDEL', KEYS[3], user)
            changed = 1
        end
    end
    redis.call('HDEL', KEYS[2], connection)
    redis.call('ZREM', KEYS[1], connection)
end
for _, expired in ipairs(redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)) do
    remove(expired)
end
local status = 'ok'
if action == 'add' or action == 'renew' then
    local previous = redis.call('HGET', KEYS[2], cid)
    if action == 'renew' and not previous then
        status = 'lease_expired'
    elseif previous and previous ~= uid then
        status = 'invalid_message'
    elseif not previous and redis.call('ZCARD', KEYS[1]) >= max_room then
        status = 'capacity_reached'
    elseif not previous and tonumber(redis.call('HGET', KEYS[3], uid) or '0') >= max_user then
        status = 'capacity_reached'
    else
        if not previous then
            if redis.call('HINCRBY', KEYS[3], uid, 1) == 1 then changed = 1 end
            redis.call('HSET', KEYS[2], cid, uid)
        end
        redis.call('ZADD', KEYS[1], now + ttl, cid)
    end
elseif action == 'remove' then
    remove(cid)
elseif action == 'check' then
    if not redis.call('ZSCORE', KEYS[1], cid) then status = 'lease_expired' end
end
if changed == 1 then sequence = redis.call('HINCRBY', KEYS[4], 'sequence', 1) end
for i = 1, 3 do redis.call('PEXPIRE', KEYS[i], ttl * 2) end
redis.call('EXPIRE', KEYS[4], 86400)
local users = redis.call('HKEYS', KEYS[3])
return {status, sequence, changed, now, users}
"""

_RATE_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count <= tonumber(ARGV[2])
"""


@dataclass(frozen=True)
class Roster:
    """A distinct-user roster observed at Redis server time."""

    user_ids: frozenset[int]
    sequence: int
    changed: bool
    server_time: datetime


def _roster(values):
    status, sequence, changed, now, users = values
    if status == 'capacity_reached':
        raise PracticeRateLimitError()
    if status == 'lease_expired':
        raise PracticeLeaseExpiredError()
    if status != 'ok':
        raise ValueError(status)
    return Roster(
        frozenset(int(user) for user in users),
        int(sequence),
        bool(changed),
        datetime.fromtimestamp(int(now) / 1000, UTC),
    )


def room_group_name(room_id):
    """Derive a channel-layer-safe name without opening Redis."""
    namespace = hashlib.sha256(settings.REALTIME_PREFIX.encode()).hexdigest()[:24]
    prefix = f'{settings.REALTIME_PREFIX}:practice:{{{namespace}}}'
    digest = hashlib.sha256(f'{prefix}:{room_id}'.encode()).hexdigest()
    return f'practice.{digest}'


def observe_sync(room_id):
    """Read the same atomic roster for an authenticated HTTP snapshot."""
    client = SyncRedis.from_url(
        settings.REALTIME_REDIS_URL,
        socket_connect_timeout=2,
        socket_timeout=2,
        decode_responses=True,
    )
    try:
        store = PracticeLeaseStore(client=client)
        values = client.eval(
            _LEASE_SCRIPT,
            4,
            *store._keys(room_id),
            'observe',
            '',
            0,
            settings.PRACTICE_LEASE_SECONDS * 1000,
            settings.PRACTICE_MAX_ROOM_CONNECTIONS,
            settings.PRACTICE_MAX_USER_CONNECTIONS,
        )
        return _roster(values)
    except (RedisError, OSError, TimeoutError) as exc:
        raise PracticeUnavailableError() from exc
    finally:
        client.close()


def _client():
    loop = asyncio.get_running_loop()
    url = settings.REALTIME_REDIS_URL
    clients = _CLIENTS.setdefault(loop, {})
    if url not in clients:
        pool = BlockingConnectionPool.from_url(
            url,
            max_connections=128,
            timeout=2,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        clients[url] = Redis(connection_pool=pool)
    return clients[url]


async def close_practice_connections():
    """Handle close practice connections for practice rooms."""
    clients = _CLIENTS.pop(asyncio.get_running_loop(), {})
    for client in clients.values():
        await client.aclose()
        await client.connection_pool.disconnect()


class PracticeLeaseStore:
    """Manage shared ephemeral socket admissions and room presence."""

    def __init__(self, client=None):
        """Use a bounded shared Redis pool unless a test client is injected."""
        self.client = client if client is not None else _client()
        namespace = hashlib.sha256(settings.REALTIME_PREFIX.encode()).hexdigest()[:24]
        self.prefix = f'{settings.REALTIME_PREFIX}:practice:{{{namespace}}}'

    def group_name(self, room_id):
        """Return the shared Channels group for a room UUID."""
        return room_group_name(room_id)

    def _keys(self, room_id):
        room = hashlib.sha256(str(room_id).encode()).hexdigest()
        return [
            f'{self.prefix}:room:{room}:{name}'
            for name in ('leases', 'connections', 'users', 'state')
        ]

    async def admission(self, action, connection_id, ip_key=''):
        """Handle admission for practice rooms."""
        keys = [f'{self.prefix}:{name}' for name in ('open', 'ips', 'ip-counts')]
        status = await self._call(
            self.client.eval,
            _ADMISSION_SCRIPT,
            3,
            *keys,
            action,
            connection_id,
            ip_key,
            settings.PRACTICE_LEASE_SECONDS * 1000,
            settings.PRACTICE_MAX_CONNECTIONS,
            settings.PRACTICE_MAX_CONNECTIONS_PER_IP,
        )
        if status == 'capacity_reached':
            raise PracticeRateLimitError()
        if status == 'lease_expired':
            raise PracticeLeaseExpiredError()
        if status != 'ok':
            raise ValueError(status)

    async def admit(self, connection_id, ip_key):
        """Handle admit for practice rooms."""
        await self.admission('admit', connection_id, ip_key)

    async def refresh_admission(self, connection_id):
        """Handle refresh admission for practice rooms."""
        await self.admission('refresh', connection_id)

    async def check_admission(self, connection_id):
        """Handle check admission for practice rooms."""
        await self.admission('check', connection_id)

    async def release(self, connection_id):
        """Handle release for practice rooms."""
        await self.admission('release', connection_id)

    async def _call(self, function, *args):
        try:
            return await function(*args)
        except (RedisError, OSError, TimeoutError) as exc:
            raise PracticeUnavailableError() from exc

    async def lease(self, action, room_id, connection_id='', user_id=0):
        """Handle lease for practice rooms."""
        values = await self._call(
            self.client.eval,
            _LEASE_SCRIPT,
            4,
            *self._keys(room_id),
            action,
            connection_id,
            user_id,
            settings.PRACTICE_LEASE_SECONDS * 1000,
            settings.PRACTICE_MAX_ROOM_CONNECTIONS,
            settings.PRACTICE_MAX_USER_CONNECTIONS,
        )
        return _roster(values)

    async def renew(self, room_id, connection_id, user_id):
        """Handle renew for practice rooms."""
        return await self.lease('renew', room_id, connection_id, user_id)

    async def add(self, room_id, connection_id, user_id):
        """Handle add for practice rooms."""
        return await self.lease('add', room_id, connection_id, user_id)

    async def remove(self, room_id, connection_id):
        """Handle remove for practice rooms."""
        return await self.lease('remove', room_id, connection_id)

    async def observe(self, room_id):
        """Handle observe for practice rooms."""
        return await self.lease('observe', room_id)

    async def check_lease(self, room_id, connection_id, user_id):
        """Fail when a room lease expired or its Redis namespace was lost."""
        return await self.lease('check', room_id, connection_id, user_id)

    async def check_rate(self, bucket, identity, limit):
        """Handle check rate for practice rooms."""
        digest = hashlib.sha256(str(identity).encode()).hexdigest()
        window = int(datetime.now(UTC).timestamp() // settings.PRACTICE_RATE_WINDOW_SECONDS)
        key = f'{self.prefix}:rate:{bucket}:{digest}:{window}'
        allowed = await self._call(
            self.client.eval,
            _RATE_SCRIPT,
            1,
            key,
            settings.PRACTICE_RATE_WINDOW_SECONDS * 1000,
            limit,
        )
        if not allowed:
            raise PracticeRateLimitError()
