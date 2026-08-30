"""Refresh stale and failed link previews."""

import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.blogs.link_previews import fetch_preview_for
from apps.blogs.models import LinkPreview

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    """Refresh stale ok previews and retry eligible failed previews."""

    help = 'Refresh stale link previews and retry eligible failed previews.'

    def add_arguments(self, parser):
        """Add command-line options."""
        parser.add_argument('--stale-days', type=int, default=30)
        parser.add_argument('--min-retry-age-minutes', type=int, default=60)
        parser.add_argument('--stuck-pending-minutes', type=int, default=15)
        parser.add_argument('--max-attempts', type=int, default=4)
        parser.add_argument('--limit', type=int, default=200)

    def handle(self, *args, **options):
        """Run failed-preview retries and stale-preview refreshes."""
        now = timezone.now()
        limit = options['limit']
        max_attempts = options['max_attempts']
        retry_before = now - timedelta(minutes=options['min_retry_age_minutes'])
        stuck_before = now - timedelta(minutes=options['stuck_pending_minutes'])
        stale_before = now - timedelta(days=options['stale_days'])

        # Previews stranded at 'pending' — their fetch task never ran (e.g. a
        # worker that died between sync_link_previews and fetch_link_previews) —
        # never advance on their own, so nothing renders on the post. Sweep the
        # ones past the stuck window; `created` is the enqueue time (a pending row
        # is never re-saved), so it measures how long the fetch has been missing.
        stuck_previews = list(
            LinkPreview.objects.filter(
                post__link_previews_enabled=True,
                status='pending',
                fetch_attempts__lt=max_attempts,
                created__lt=stuck_before,
            ).order_by('created')[:limit]
        )
        failed_previews = list(
            LinkPreview.objects.filter(
                post__link_previews_enabled=True,
                status='failed',
                fetch_attempts__lt=max_attempts,
                fetched_at__lt=retry_before,
            ).order_by('fetched_at')[:limit]
        )
        stale_previews = list(
            LinkPreview.objects.filter(
                post__link_previews_enabled=True,
                status='ok',
                fetched_at__lt=stale_before,
            ).order_by('fetched_at')[:limit]
        )

        recovered_ok = 0
        for preview in stuck_previews:
            if self._fetch_preview(preview):
                recovered_ok += 1

        retried_ok = 0
        for preview in failed_previews:
            if self._fetch_preview(preview):
                retried_ok += 1

        refreshed_updated = 0
        for preview in stale_previews:
            if self._fetch_preview(preview, keep_existing_on_failure=True):
                refreshed_updated += 1

        self.stdout.write(
            f'recovered {len(stuck_previews)} stuck ({recovered_ok} now ok), '
            f'retried {len(failed_previews)} ({retried_ok} now ok), '
            f'refreshed {len(stale_previews)} ({refreshed_updated} updated)'
        )

    def _fetch_preview(self, preview, *, keep_existing_on_failure=False):
        """Fetch one preview, converting unexpected exceptions into failed status.

        Returns True when fresh data was applied.
        """
        try:
            return fetch_preview_for(preview, keep_existing_on_failure=keep_existing_on_failure)
        except Exception:
            logger.exception('Error refreshing link preview %s', preview.pk)
            preview.status = 'failed'
            preview.fetched_at = timezone.now()
            preview.save(update_fields=['status', 'fetched_at', 'fetch_attempts'])
            return False
