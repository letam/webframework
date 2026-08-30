"""Re-enqueue media processing for rows missing their derived assets."""

import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.blogs.models import Media
from apps.blogs.tasks import process_post_media

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    """Re-enqueue ``process_post_media`` for media missing their derived assets.

    ``process_post_media`` writes no status, so a worker that dropped the enqueue
    (or died mid-run) leaves audio without a waveform and video/image without a
    thumbnail with nothing to move it — the create path enqueues once and never
    sweeps. This is the manual recovery tool for that.

    Run it deliberately, not on a tight cron: media whose asset genuinely cannot
    be produced (silent audio, a still that renders no rendition) has no attempt
    counter, so it is re-selected every run and would be reprocessed forever.
    """

    help = 'Re-enqueue media processing for rows missing their waveform/thumbnail.'

    def add_arguments(self, parser):
        """Add command-line options."""
        parser.add_argument('--min-age-minutes', type=int, default=15)
        parser.add_argument('--limit', type=int, default=200)

    def handle(self, *args, **options):
        """Enqueue processing for settled media that lacks its derived asset."""
        settled_before = timezone.now() - timedelta(minutes=options['min_age_minutes'])

        # The asset process_post_media produces for each type: audio → waveform,
        # video/image → thumbnail. `modified` is not a progress signal, so do not
        # read the age gate as one: processing writes nothing until it succeeds,
        # and the write it makes then names only the asset field
        # (`update_fields=['waveform']` / `['thumbnail']`). Django runs a field's
        # pre_save — where auto_now stamps — only for fields update_fields names,
        # so `modified` sits untouched through a run either way. The gate is
        # therefore a plain grace period measured from the row's last write, its
        # upload usually, sized so the create path's own enqueue has had a chance
        # to land. A job still running when the window passes gets enqueued again;
        # the work is idempotent, so that costs duplicated effort, not a bad row.
        missing_asset = (
            Q(media_type='audio', waveform__isnull=True)
            | Q(media_type='video', thumbnail='')
            | Q(media_type='image', thumbnail='')
        )
        media_ids = list(
            Media.objects.filter(missing_asset, modified__lt=settled_before)
            .order_by('modified')
            .values_list('pk', flat=True)[: options['limit']]
        )

        for media_id in media_ids:
            process_post_media.enqueue(media_id)

        self.stdout.write(f'reprocessing {len(media_ids)} media')
