"""Dependency readiness, separate from the existing platform health endpoint."""

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from redis import Redis
from redis.exceptions import RedisError


@require_GET
def readiness(request):
    """Report dependency availability without exposing configuration or identifiers."""
    status = {'database': 'ok'}
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
    except Exception:
        status['database'] = 'unavailable'
    if settings.REALTIME_ENABLED:
        try:
            with Redis.from_url(
                settings.REALTIME_REDIS_URL, socket_timeout=2, socket_connect_timeout=2
            ) as redis:
                redis.ping()
            status['redis'] = 'ok'
        except (RedisError, OSError):
            status['redis'] = 'unavailable'
    ready = all(value == 'ok' for value in status.values())
    return JsonResponse(
        {'status': 'ok' if ready else 'unavailable', **status}, status=200 if ready else 503
    )
