"""Private aggregate reporting authenticated only by a dedicated bearer token."""

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import DatabaseError
from django.http import Http404, HttpResponseNotAllowed, JsonResponse
from django.views.decorators.cache import never_cache

from .models import DailyPresenceSummary
from .statistics import get_retention_days, local_day


@never_cache
def stats(request):
    """Return bounded, zero-filled daily aggregates without pseudonymous rows."""
    if not getattr(settings, 'PRESENCE_ENABLED', False):
        raise Http404
    expected = getattr(settings, 'PRESENCE_STATS_TOKEN', '')
    parts = request.headers.get('Authorization', '').split()
    candidate = parts[1] if len(parts) == 2 and parts[0].lower() == 'bearer' else ''
    authenticated = secrets.compare_digest(candidate.encode('utf-8'), expected.encode('utf-8'))
    if not expected or not authenticated:
        response = JsonResponse({'error': 'unauthorized'}, status=401)
        response['WWW-Authenticate'] = 'Bearer'
        return response
    if request.method != 'GET':
        return HttpResponseNotAllowed(['GET'])
    supplied_days = request.GET.getlist('days')
    value = supplied_days[0] if supplied_days else '30'
    if len(supplied_days) > 1 or not value.isascii() or not value.isdecimal():
        return JsonResponse({'error': 'days must be an integer from 1 to 400'}, status=400)
    # Bound the length before int() so oversized inputs cannot trigger its digit limit.
    if len(value) > 3 or not 1 <= int(value) <= 400:
        return JsonResponse({'error': 'days must be an integer from 1 to 400'}, status=400)
    days = int(value)
    today = local_day()
    first_day = today - timedelta(days=days - 1)
    scopes = getattr(settings, 'PRESENCE_SCOPES', {})
    try:
        summaries = {
            (row.scope, row.day): row
            for row in DailyPresenceSummary.objects.filter(
                scope__in=scopes, day__gte=first_day, day__lte=today
            )
        }
    except DatabaseError:
        return JsonResponse({'error': 'statistics_unavailable'}, status=503)
    results = {}
    for scope in sorted(scopes):
        daily = []
        for offset in range(days):
            day = first_day + timedelta(days=offset)
            row = summaries.get((scope, day))
            new = row.new_visitors if row else 0
            returning = row.returning_visitors if row else 0
            daily.append(
                {
                    'day': day.isoformat(),
                    'visitors': new + returning,
                    'new_visitors': new,
                    'returning_visitors': returning,
                    'peak_active': row.peak_active if row else 0,
                }
            )
        results[scope] = {
            'daily_visits': sum(row['visitors'] for row in daily),
            'new_visitors': sum(row['new_visitors'] for row in daily),
            'returning_visits': sum(row['returning_visitors'] for row in daily),
            'peak_active': max(row['peak_active'] for row in daily),
            'daily': daily,
        }
    return JsonResponse(
        {
            'days': days,
            'from': first_day.isoformat(),
            'to': today.isoformat(),
            'timezone': getattr(settings, 'PRESENCE_TIME_ZONE', 'UTC'),
            'retention_days': get_retention_days(),
            'scopes': results,
        }
    )
