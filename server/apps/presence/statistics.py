"""Transactional, privacy-safe daily statistics, independent of Redis leases."""

import hashlib
import hmac
import json
import re
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import DailyPresenceSummary, DailyVisit, Visitor

_VISITOR_KEY = re.compile(r'^[0-9a-f]{64}$')


def _validate_scope(scope: str) -> None:
    if (
        not isinstance(scope, str)
        or not 1 <= len(scope) <= 100
        or scope not in getattr(settings, 'PRESENCE_SCOPES', {})
    ):
        raise ValueError('Unknown presence scope')


def _observation_time(now: datetime | None = None) -> datetime:
    observed_at = timezone.now() if now is None else now
    if not isinstance(observed_at, datetime) or timezone.is_naive(observed_at):
        raise ValueError('Presence observations require an aware timestamp')
    return observed_at


def local_day(now: datetime | None = None) -> date:
    """Return the local statistics date used for daily Redis acknowledgements."""
    observed_at = _observation_time(now)
    return observed_at.astimezone(ZoneInfo(getattr(settings, 'PRESENCE_TIME_ZONE', 'UTC'))).date()


def hash_visitor(scope: str, visitor_id: str) -> str:
    """Derive a scoped HMAC pseudonym without retaining or logging the raw UUID."""
    _validate_scope(scope)
    try:
        visitor_uuid = UUID(visitor_id) if isinstance(visitor_id, str) else None
    except (ValueError, AttributeError, TypeError):
        raise ValueError('Invalid visitor identifier') from None
    if visitor_uuid is None or visitor_uuid.version != 4:
        raise ValueError('Invalid visitor identifier')
    secret = getattr(settings, 'PRESENCE_HASH_KEY', '')
    if not isinstance(secret, str) or not secret:
        raise ImproperlyConfigured('PRESENCE_HASH_KEY is required for visit statistics')
    message = json.dumps(
        ['presence-visitor-v1', scope, str(visitor_uuid)], separators=(',', ':')
    ).encode('utf-8')
    return hmac.new(secret.encode('utf-8'), message, hashlib.sha256).hexdigest()


def record_visit(scope: str, visitor_key: str, now: datetime | None = None) -> dict:
    """Record one daily visit and fix its classification under a visitor row lock.

    The caller passes only ``hash_visitor``'s output and may cache the returned
    local day acknowledgement. The unique daily row remains authoritative if
    that cache is missing, lost, or concurrently populated by another worker.
    """
    _validate_scope(scope)
    if not isinstance(visitor_key, str) or not _VISITOR_KEY.fullmatch(visitor_key):
        raise ValueError('Invalid visitor pseudonym')
    observed_at = _observation_time(now)
    day = local_day(observed_at)
    with transaction.atomic():
        visitor, _ = Visitor.objects.select_for_update().get_or_create(
            scope=scope,
            visitor_key=visitor_key,
            defaults={
                'first_seen': day,
                'last_seen': day,
                'created_at': observed_at,
                'updated_at': observed_at,
            },
        )
        visit, created = DailyVisit.objects.get_or_create(
            visitor=visitor,
            day=day,
            defaults={
                'scope': scope,
                'is_new': visitor.first_seen == day,
                'created_at': observed_at,
            },
        )
        if created:
            if day > visitor.last_seen:
                visitor.last_seen = day
                visitor.updated_at = observed_at
                visitor.save(update_fields=['last_seen', 'updated_at'])
            DailyPresenceSummary.objects.get_or_create(
                scope=scope, day=day, defaults={'updated_at': observed_at}
            )
            counter = 'new_visitors' if visit.is_new else 'returning_visitors'
            DailyPresenceSummary.objects.filter(scope=scope, day=day).update(
                **{counter: F(counter) + 1, 'updated_at': observed_at}
            )
        return {'day': day.isoformat(), 'is_new': visit.is_new, 'created': created}


def record_peak(scope: str, count: int, now: datetime | None = None) -> None:
    """Persist a coalesced peak observation without writing unchanged/lower counts.

    The transport coalesces observations across heartbeats before calling this
    function. A conditional database update prevents concurrent workers from
    replacing a larger peak with a smaller value.
    """
    _validate_scope(scope)
    if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 2_147_483_647:
        raise ValueError('Presence counts must be nonnegative integers')
    observed_at = _observation_time(now)
    day = local_day(observed_at)
    summary, created = DailyPresenceSummary.objects.get_or_create(
        scope=scope, day=day, defaults={'peak_active': count, 'updated_at': observed_at}
    )
    if not created:
        DailyPresenceSummary.objects.filter(pk=summary.pk, peak_active__lt=count).update(
            peak_active=count, updated_at=observed_at
        )


def get_retention_days() -> int:
    """Read and validate the independently configured statistics retention."""
    days = getattr(settings, 'PRESENCE_RETENTION_DAYS', 400)
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 400:
        raise ImproperlyConfigured('PRESENCE_RETENTION_DAYS must be an integer from 1 to 400')
    return days


def prune_statistics(now: datetime | None = None, retention_days: int | None = None) -> dict:
    """Prune daily data and inactive visitors independently of API traffic.

    Retention includes today, so a 400-day window retains today and the previous
    399 local dates. After deletion a browser may be observed as new again.
    """
    days = get_retention_days() if retention_days is None else retention_days
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 400:
        raise ValueError('Retention must be an integer from 1 to 400')
    cutoff = local_day(now) - timedelta(days=days - 1)
    with transaction.atomic():
        _, visit_counts = DailyVisit.objects.filter(day__lt=cutoff).delete()
        _, summary_counts = DailyPresenceSummary.objects.filter(day__lt=cutoff).delete()
        _, visitor_counts = Visitor.objects.filter(last_seen__lt=cutoff).delete()
    return {
        'before': cutoff.isoformat(),
        'daily_visits': visit_counts.get(DailyVisit._meta.label, 0),
        'daily_summaries': summary_counts.get(DailyPresenceSummary._meta.label, 0),
        'visitors': visitor_counts.get(Visitor._meta.label, 0),
    }
