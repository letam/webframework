"""Atomic Redis leases, admission limits and successful statistics acknowledgements.

Redis contains keyed visitor/IP hashes and server connection UUIDs only. Every
multi-key operation uses one Lua script and one instance hash tag. The active
visitor refcounts and their expired connection metadata are pruned together.
"""

import asyncio
import hashlib
import hmac
import weakref
from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from django.conf import settings
from redis.asyncio import BlockingConnectionPool, Redis
from redis.exceptions import RedisError

# Cardinality is bounded by configured simultaneous connection limits. Scopes
# themselves come from settings, never from arbitrary submitted names.
_ADMISSION_SCRIPT = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local action, cid, ip = ARGV[1], ARGV[2], ARGV[3]
local ttl, maximum, ip_maximum = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])
local function decrement(key, field)
    local n = redis.call('HINCRBY', key, field, -1)
    if n <= 0 then redis.call('HDEL', key, field) end
end
local function remove(connection)
    local old_ip = redis.call('HGET', KEYS[2], connection)
    if old_ip then decrement(KEYS[3], old_ip) end
    local old_scope = redis.call('HGET', KEYS[4], connection)
    if old_scope then decrement(KEYS[5], old_scope) end
    redis.call('ZREM', KEYS[1], connection)
    redis.call('HDEL', KEYS[2], connection)
    redis.call('HDEL', KEYS[4], connection)
end
for _, connection in ipairs(redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)) do
    remove(connection)
end
local status = 'ok'
if action == 'admit' then
    local attempts = redis.call('INCR', KEYS[6])
    if attempts == 1 then redis.call('PEXPIRE', KEYS[6], tonumber(ARGV[8])) end
    if attempts > tonumber(ARGV[7]) then
        status = 'rate_limited'
    elseif redis.call('ZCARD', KEYS[1]) >= maximum
        or tonumber(redis.call('HGET', KEYS[3], ip) or '0') >= ip_maximum then
        status = 'capacity_reached'
    else
        redis.call('ZADD', KEYS[1], now + ttl, cid)
        redis.call('HSET', KEYS[2], cid, ip)
        redis.call('HINCRBY', KEYS[3], ip, 1)
    end
elseif action == 'bind' then
    if not redis.call('ZSCORE', KEYS[1], cid) then
        status = 'lease_expired'
    elseif not redis.call('HGET', KEYS[4], cid) then
        if tonumber(redis.call('HGET', KEYS[5], ARGV[9]) or '0') >= tonumber(ARGV[10]) then
            status = 'capacity_reached'
        else
            redis.call('HSET', KEYS[4], cid, ARGV[9])
            redis.call('HINCRBY', KEYS[5], ARGV[9], 1)
        end
    end
elseif action == 'refresh' then
    if redis.call('ZSCORE', KEYS[1], cid) then
        redis.call('ZADD', KEYS[1], now + ttl, cid)
    else
        status = 'lease_expired'
    end
elseif action == 'release' then
    if redis.call('ZSCORE', KEYS[1], cid) then remove(cid) end
end
for i = 1, 5 do redis.call('PEXPIRE', KEYS[i], ttl * 2) end
return status
"""

_LEASE_SCRIPT = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local action, cid, visitor = ARGV[1], ARGV[2], ARGV[3]
local ttl, maximum = tonumber(ARGV[4]), tonumber(ARGV[5])
local previous = tonumber(redis.call('HGET', KEYS[4], 'count') or '0')
local function remove(connection)
    local old = redis.call('HGET', KEYS[2], connection)
    if old then
        local n = redis.call('HINCRBY', KEYS[3], old, -1)
        if n <= 0 then redis.call('HDEL', KEYS[3], old) end
    end
    redis.call('ZREM', KEYS[1], connection)
    redis.call('HDEL', KEYS[2], connection)
end
for _, connection in ipairs(redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)) do
    remove(connection)
end
local status = 'ok'
if action == 'renew' then
    local old = redis.call('HGET', KEYS[2], cid)
    if old and old ~= visitor then
        status = 'invalid_message'
    elseif not old and redis.call('ZCARD', KEYS[1]) >= maximum then
        status = 'capacity_reached'
    else
        if not old then
            redis.call('HSET', KEYS[2], cid, visitor)
            redis.call('HINCRBY', KEYS[3], visitor, 1)
        end
        redis.call('ZADD', KEYS[1], now + ttl, cid)
    end
elseif action == 'remove' then
    remove(cid)
end
local count = redis.call('HLEN', KEYS[3])
local day = math.floor((now / 1000 + tonumber(ARGV[6])) / 86400)
local high_water = tonumber(redis.call('HGET', KEYS[5], day) or '0')
if count > high_water then redis.call('HSET', KEYS[5], day, count) end
for _, old_day in ipairs(redis.call('HKEYS', KEYS[5])) do
    if tonumber(old_day) < day - 1 then redis.call('HDEL', KEYS[5], old_day) end
end
redis.call('EXPIRE', KEYS[5], 172800)
local sequence = tonumber(redis.call('HGET', KEYS[4], 'sequence') or '0')
local changed = 0
if count ~= previous then
    sequence = redis.call('HINCRBY', KEYS[4], 'sequence', 1)
    changed = 1
end
redis.call('HSET', KEYS[4], 'count', count)
-- Keep sequence for the finite configured scopes even after the last lease.
-- Expiring it would let late group events outrank a subsequent fresh snapshot.
for i = 1, 3 do redis.call('PEXPIRE', KEYS[i], ttl * 2) end
return {status, count, sequence, changed, now}
"""

_RATE_SCRIPT = """
local connection = redis.call('INCR', KEYS[1])
local ip = redis.call('INCR', KEYS[2])
if connection == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
if ip == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
if connection > tonumber(ARGV[1]) or ip > tonumber(ARGV[2]) then return 0 end
return 1
"""

_PEAK_CLAIM_SCRIPT = """
local high_water = tonumber(redis.call('HGET', KEYS[3], ARGV[3]) or '0')
local candidate = math.max(high_water, tonumber(ARGV[1]))
if candidate > high_water then
    redis.call('HSET', KEYS[3], ARGV[3], candidate)
    redis.call('EXPIRE', KEYS[3], 172800)
end
if tonumber(redis.call('GET', KEYS[1]) or '0') >= candidate then return {0, candidate} end
if redis.call('SET', KEYS[2], ARGV[2], 'NX', 'PX', 20000) then return {1, candidate} end
return {0, candidate}
"""

_PEAK_ACK_SCRIPT = """
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if tonumber(redis.call('GET', KEYS[1]) or '0') < tonumber(ARGV[1]) then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', 172800)
end
redis.call('DEL', KEYS[2])
local pending = tonumber(redis.call('HGET', KEYS[3], ARGV[3]) or '0')
if pending > tonumber(redis.call('GET', KEYS[1]) or '0') then return 1 end
return 0
"""

_PEAK_RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1
"""

_CLIENTS = weakref.WeakKeyDictionary()


class PresenceUnavailableError(RuntimeError):
    """Represent failed shared state without substituting an invented count."""


class PresenceLimitError(RuntimeError):
    """Expose a stable code for admission, lease and message limit failures."""

    def __init__(self, code):
        """Store a public code without visitor information."""
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class PresenceSnapshot:
    """A count observed atomically at Redis's authoritative server time."""

    count: int
    sequence: int
    changed: bool
    server_time: datetime

    def message(self):
        """Return a public snapshot without identities or a member roster."""
        return {
            'v': 1,
            'type': 'presence.snapshot',
            'count': self.count,
            'sequence': self.sequence,
            'server_time': self.server_time.isoformat().replace('+00:00', 'Z'),
            'lease_seconds': settings.PRESENCE_LEASE_SECONDS,
            'heartbeat_seconds': settings.PRESENCE_HEARTBEAT_SECONDS,
        }


@dataclass(frozen=True)
class PeakClaim:
    """A bounded write claim for the independently retained daily high-water."""

    token: str
    count: int


def _redis_client():
    """Share a bounded Redis connection pool within each ASGI event loop."""
    loop = asyncio.get_running_loop()
    url = settings.REALTIME_REDIS_URL
    clients = _CLIENTS.setdefault(loop, {})
    if url not in clients:
        pool = BlockingConnectionPool.from_url(
            url,
            max_connections=getattr(settings, 'PRESENCE_REDIS_MAX_CONNECTIONS', 128),
            timeout=2,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        clients[url] = Redis(connection_pool=pool)
    return clients[url]


async def close_presence_connections():
    """Close this loop's shared pools on shutdown or between isolated async tests."""
    clients = _CLIENTS.pop(asyncio.get_running_loop(), {})
    for client in clients.values():
        await client.aclose()
        await client.connection_pool.disconnect()


def hash_ip(ip):
    """Hash the actual transport peer address solely for temporary shared limits."""
    return hmac.new(
        settings.PRESENCE_HASH_KEY.encode(),
        b'presence-ip\0' + ip.encode(),
        hashlib.sha256,
    ).hexdigest()


class PresenceLeaseStore:
    """Manage shared presence using Redis only, never process-local correctness."""

    def __init__(self, client=None):
        """Use an injected real Redis client or the bounded ASGI loop pool."""
        self.client = client if client is not None else _redis_client()
        instance = hashlib.sha256(settings.REALTIME_PREFIX.encode()).hexdigest()[:24]
        self.prefix = f'{settings.REALTIME_PREFIX}:presence:{{{instance}}}'
        self.lease_ms = settings.PRESENCE_LEASE_SECONDS * 1000

    async def _call(self, operation, *args, **kwargs):
        """Convert only operational Redis failures to a safe service error."""
        try:
            return await operation(*args, **kwargs)
        except (RedisError, OSError, TimeoutError) as exc:
            raise PresenceUnavailableError() from exc

    def scope_prefix(self, scope):
        """Resolve a configured scope to a bounded key namespace."""
        if scope not in settings.PRESENCE_SCOPES:
            raise PresenceLimitError('unknown_scope')
        digest = hashlib.sha256(scope.encode()).hexdigest()[:32]
        return f'{self.prefix}:scope:{digest}'

    def group_name(self, scope):
        """Return a channel-layer-safe, instance-specific group name."""
        digest = hashlib.sha256(f'{self.prefix}:{scope}'.encode()).hexdigest()
        return f'presence.{digest}'

    async def _admission(self, action, connection_id, ip_key='', scope=''):
        keys = [
            f'{self.prefix}:{name}'
            for name in ('open', 'ips', 'ip-counts', 'scopes', 'scope-counts')
        ]
        keys.append(f'{self.prefix}:connect-rate:{ip_key}')
        result = await self._call(
            self.client.eval,
            _ADMISSION_SCRIPT,
            len(keys),
            *keys,
            action,
            connection_id,
            ip_key,
            self.lease_ms,
            settings.PRESENCE_MAX_CONNECTIONS,
            settings.PRESENCE_MAX_CONNECTIONS_PER_IP,
            getattr(settings, 'PRESENCE_CONNECT_RATE', 120),
            getattr(settings, 'PRESENCE_RATE_WINDOW_SECONDS', 60) * 1000,
            scope,
            getattr(settings, 'PRESENCE_MAX_SCOPE_CONNECTIONS', settings.PRESENCE_MAX_CONNECTIONS),
        )
        if result != 'ok':
            raise PresenceLimitError(result)

    async def admit(self, connection_id, ip_key):
        """Atomically reserve one socket against global, peer and connect limits."""
        await self._admission('admit', connection_id, ip_key)

    async def bind_scope(self, connection_id, scope):
        """Bound all sockets assigned to a scope, including inactive pages."""
        self.scope_prefix(scope)
        await self._admission('bind', connection_id, scope=scope)

    async def refresh_admission(self, connection_id):
        """Extend a live socket's capacity lease on a validated client message."""
        await self._admission('refresh', connection_id)

    async def release(self, connection_id):
        """Release exactly one socket and its peer/scope capacity slots."""
        await self._admission('release', connection_id)

    async def check_message_rate(self, connection_id, ip_key):
        """Enforce shared per-connection and NAT-friendly per-peer message budgets."""
        allowed = await self._call(
            self.client.eval,
            _RATE_SCRIPT,
            2,
            f'{self.prefix}:message-rate:{connection_id}',
            f'{self.prefix}:ip-message-rate:{ip_key}',
            getattr(settings, 'PRESENCE_MESSAGE_RATE', 12),
            getattr(settings, 'PRESENCE_IP_MESSAGE_RATE', 600),
            getattr(settings, 'PRESENCE_RATE_WINDOW_SECONDS', 60) * 1000,
        )
        if not allowed:
            raise PresenceLimitError('rate_limited')

    async def _lease(self, action, scope, connection_id='', visitor_key=''):
        prefix = self.scope_prefix(scope)
        keys = [
            f'{prefix}:{name}'
            for name in ('leases', 'connections', 'visitors', 'state', 'high-water')
        ]
        offset = datetime.now(UTC).astimezone(ZoneInfo(settings.PRESENCE_TIME_ZONE)).utcoffset()
        result = await self._call(
            self.client.eval,
            _LEASE_SCRIPT,
            len(keys),
            *keys,
            action,
            connection_id,
            visitor_key,
            self.lease_ms,
            getattr(settings, 'PRESENCE_MAX_SCOPE_CONNECTIONS', settings.PRESENCE_MAX_CONNECTIONS),
            int(offset.total_seconds()),
        )
        status, count, sequence, changed, server_ms = result
        if status != 'ok':
            raise PresenceLimitError(status)
        return PresenceSnapshot(
            int(count), int(sequence), bool(changed), datetime.fromtimestamp(server_ms / 1000, UTC)
        )

    async def renew(self, scope, connection_id, visitor_key):
        """Prune then renew one connection and count distinct live visitor hashes."""
        return await self._lease('renew', scope, connection_id, visitor_key)

    async def remove(self, scope, connection_id):
        """Remove one connection without deleting another tab's visitor lease."""
        return await self._lease('remove', scope, connection_id)

    async def observe(self, scope):
        """Prune expired connections and return an authoritative current count."""
        return await self._lease('observe', scope)

    def _visit_key(self, scope, visitor_key, day):
        return f'{self.scope_prefix(scope)}:visit:{day}:{visitor_key}'

    async def visit_acknowledged(self, scope, visitor_key, day):
        """Read the short-lived cache of a successfully recorded local-day visit."""
        return bool(await self._call(self.client.get, self._visit_key(scope, visitor_key, day)))

    async def acknowledge_visit(self, scope, visitor_key, day):
        """Cache a visit only after its database transaction has succeeded."""
        await self._call(
            self.client.set, self._visit_key(scope, visitor_key, day), '1', ex=self.lease_ms // 500
        )

    def _peak_keys(self, scope, day):
        prefix = self.scope_prefix(scope)
        return (f'{prefix}:peak:{day}', f'{prefix}:peak-lock:{day}', f'{prefix}:high-water')

    def _day_number(self, day):
        return (date.fromisoformat(day) - date(1970, 1, 1)).days

    async def claim_peak(self, scope, count, day):
        """Coalesce SQL peak updates behind an expiring shared claim."""
        token = str(uuid4())
        claimed, candidate = await self._call(
            self.client.eval,
            _PEAK_CLAIM_SCRIPT,
            3,
            *self._peak_keys(scope, day),
            count,
            token,
            self._day_number(day),
        )
        return PeakClaim(token, int(candidate)) if claimed else None

    async def acknowledge_peak(self, scope, count, day, token):
        """Advance the cached peak only after the durable update succeeds."""
        return bool(
            await self._call(
                self.client.eval,
                _PEAK_ACK_SCRIPT,
                3,
                *self._peak_keys(scope, day),
                count,
                token,
                self._day_number(day),
            )
        )

    async def release_peak(self, scope, day, token):
        """Allow retry after a failed peak write without deleting another claim."""
        await self._call(
            self.client.eval, _PEAK_RELEASE_SCRIPT, 1, self._peak_keys(scope, day)[1], token
        )
