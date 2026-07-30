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
import time
from functools import wraps

from django.conf import settings
from django.core.cache import DEFAULT_CACHE_ALIAS, caches
from django.http import JsonResponse

logger = logging.getLogger(__name__)

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
    """Best-effort client IP: Fly's header first, then X-Forwarded-For, then REMOTE_ADDR."""
    fly_client_ip = request.META.get('HTTP_FLY_CLIENT_IP')
    if fly_client_ip:
        return fly_client_ip
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', 'unknown')


def rate_limit(scope, limit, window_seconds):
    """Reject requests with a 429 once a client exceeds `limit` per window."""

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
            window = int(_now() / window_seconds)
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
                return JsonResponse(
                    {'error': 'Too many requests. Please try again later.'}, status=429
                )
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator
