"""Shared Redis fixed-window budgets for practice HTTP and socket requests."""

import hashlib
import time

from django.conf import settings
from redis import Redis
from redis.exceptions import RedisError

_RATE_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count <= tonumber(ARGV[2])
"""


class PracticeUnavailableError(RuntimeError):
    """Redis was required but failed."""


class PracticeRateLimitError(RuntimeError):
    """A shared request budget was exhausted."""


def _key(bucket, identity):
    namespace = hashlib.sha256(settings.REALTIME_PREFIX.encode()).hexdigest()[:24]
    digest = hashlib.sha256(str(identity).encode()).hexdigest()
    window = int(time.time() // settings.PRACTICE_RATE_WINDOW_SECONDS)
    return f'{settings.REALTIME_PREFIX}:practice:{{{namespace}}}:rate:{bucket}:{digest}:{window}'


def check_rate(bucket, identity, limit):
    """Fail closed on Redis loss; counters are shared across Django workers."""
    client = Redis.from_url(
        settings.REALTIME_REDIS_URL, socket_connect_timeout=2, socket_timeout=2
    )
    try:
        allowed = client.eval(
            _RATE_SCRIPT,
            1,
            _key(bucket, identity),
            settings.PRACTICE_RATE_WINDOW_SECONDS * 1000,
            limit,
        )
    except (RedisError, OSError, TimeoutError) as exc:
        raise PracticeUnavailableError() from exc
    finally:
        client.close()
    if not allowed:
        raise PracticeRateLimitError()
