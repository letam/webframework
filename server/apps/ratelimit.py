"""Minimal fixed-window, per-client rate limiting for plain Django views.

DRF views get throttling from the REST_FRAMEWORK settings; this module covers
the plain Django views (auth, uploads) that DRF throttles don't reach.

Counters live in the dedicated ``ratelimit`` cache, not ``default``: a
LocMemCache culls a third of its keys once it exceeds MAX_ENTRIES, so sharing a
cache with general-purpose data means unrelated writes can evict a counter
mid-window and silently disable throttling. With the local-memory backend each
process still keeps its own window. That is good enough to stop credential
stuffing and bulk abuse, but it is not a hard global guarantee.
"""

import logging
import math
import time
from functools import wraps

from django.conf import settings
from django.core.cache import DEFAULT_CACHE_ALIAS, caches
from django.http import JsonResponse

# Not __name__ ('apps.ratelimit'): LOGGING configures the 'server.apps' tree, so a
# __name__ logger here has no handler and the warning below falls through to
# logging.lastResort — unformatted, and the one message that most needs to be seen.
logger = logging.getLogger('server.apps.ratelimit')

RATE_LIMIT_CACHE_ALIAS = 'ratelimit'

# A deployment that replaces CACHES (say, moving to Redis) without carrying the
# alias over would otherwise turn every login, signup and presign into a 500 on
# the first request. Degrade to `default` instead — throttling still works, just
# without its own eviction budget — and say so once per process at import, since
# gunicorn never runs the system checks that would be the other place to catch it.
if RATE_LIMIT_CACHE_ALIAS not in settings.CACHES:
    logger.warning(
        "CACHES has no '%s' alias; rate-limit counters will share the '%s' cache, "
        'where unrelated writes can evict them mid-window.',
        RATE_LIMIT_CACHE_ALIAS,
        DEFAULT_CACHE_ALIAS,
    )


def _now():
    """Seam for tests: patch this, not the stdlib.

    ``apps.ratelimit.time`` *is* the ``time`` module, so patching
    ``apps.ratelimit.time.time`` freezes the clock for the whole process —
    session expiry, cache TTLs and everything else included.
    """
    return time.time()


def get_client_ip(request):
    """Client IP for rate limiting: Fly's proxy header, else REMOTE_ADDR.

    ``Fly-Client-IP`` is set by Fly's edge proxy and cannot be forged by the
    client. ``X-Forwarded-For`` deliberately is *not* consulted: the client
    controls its left-hand entries, so keying a limiter on it lets an attacker
    mint a fresh bucket per request and slip every fixed-window cap. Off Fly
    (local dev, tests) there is no proxy header and ``REMOTE_ADDR`` is the real
    peer.
    """
    fly_client_ip = request.META.get('HTTP_FLY_CLIENT_IP')
    if fly_client_ip:
        return fly_client_ip
    return request.META.get('REMOTE_ADDR', 'unknown')


RATE_LIMITED_MESSAGE = 'Too many requests. Please try again later.'


def json_rate_limited_response(request):
    """The default 429 body: JSON, which is what every fetch()-called view wants."""
    return JsonResponse({'error': RATE_LIMITED_MESSAGE}, status=429)


def _seconds_until_window_ends(now, window_seconds):
    """How long the caller must wait for a fresh allowance, rounded up.

    Windows are fixed, not sliding: every counter in a window expires together
    at the next multiple of ``window_seconds``, so the wait is exact rather than
    a guess. Never returns 0 — a Retry-After of 0 invites an immediate retry
    that would just be rejected again.
    """
    return max(1, math.ceil(window_seconds - (now % window_seconds)))


def rate_limit(scope, limit, window_seconds, limited_response=json_rate_limited_response):
    """Reject requests with a 429 once a client exceeds `limit` per window.

    ``limited_response`` builds the rejection. It defaults to JSON, correct for
    the auth and upload endpoints the frontend calls with fetch(). A view that
    renders HTML must pass one that matches: served the default, a reader who
    reloads a share page too quickly gets a raw JSON blob in their browser
    window, which reads as a broken site rather than as "wait a moment".

    Every rejection carries ``Retry-After``. Without it a well-behaved client or
    crawler has nothing to back off on and keeps retrying at its own cadence,
    which is the load the limiter is trying to shed.
    """

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            # Resolve per call, not at import: `caches` is a lazy handler, and
            # settings can be overridden (in tests) after this module loads.
            alias = (
                RATE_LIMIT_CACHE_ALIAS
                if RATE_LIMIT_CACHE_ALIAS in settings.CACHES
                else DEFAULT_CACHE_ALIAS
            )
            cache = caches[alias]
            now = _now()
            window = int(now / window_seconds)
            key = f'rate-limit:{scope}:{get_client_ip(request)}:{window}'
            if cache.add(key, 1, timeout=window_seconds):
                count = 1
            else:
                try:
                    count = cache.incr(key)
                except ValueError:
                    # The key expired between add() and incr(); start a new window.
                    count = 1
                    cache.add(key, 1, timeout=window_seconds)
            if count > limit:
                response = limited_response(request)
                response['Retry-After'] = str(_seconds_until_window_ends(now, window_seconds))
                return response
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator
