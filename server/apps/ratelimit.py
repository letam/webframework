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

import time
from functools import wraps

from django.core.cache import caches
from django.http import JsonResponse

RATE_LIMIT_CACHE_ALIAS = 'ratelimit'


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
            # tests override CACHES.
            cache = caches[RATE_LIMIT_CACHE_ALIAS]
            window = int(time.time() / window_seconds)
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
