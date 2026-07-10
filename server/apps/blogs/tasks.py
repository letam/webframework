"""Background tasks for the blogs app."""

import logging
import os

from django.utils import timezone
from django_tasks import task

from .link_previews import fetch_preview_for
from .models import Media, Post
from .transcription import transcribe_audio
from .utils import (
    convert_to_mp3,
    generate_audio_waveform,
    generate_image_rendition,
    generate_video_poster,
    save_media_thumbnail,
)

logger = logging.getLogger('server.apps.blogs')

# Formats the Whisper API accepts directly; anything else is converted to mp3 first.
WHISPER_FORMATS = {
    '.flac',
    '.m4a',
    '.mp3',
    '.mp4',
    '.mpeg',
    '.mpga',
    '.oga',
    '.ogg',
    '.wav',
    '.webm',
}


@task()
def transcribe_post_media(media_id: int) -> None:
    """Transcribe a media file's audio and store the result on the Media row."""
    media = Media.objects.filter(pk=media_id).first()
    if media is None:
        logger.warning('Media %s deleted before transcription ran', media_id)
        return

    try:
        converted_path = None
        with media.local_copy() as path:
            transcription_path = path
            if os.path.splitext(path)[1].lower() not in WHISPER_FORMATS:
                converted_path = convert_to_mp3(path)
                transcription_path = converted_path

            try:
                transcript = transcribe_audio(transcription_path)
            finally:
                if converted_path:
                    try:
                        os.unlink(converted_path)
                    except FileNotFoundError:
                        pass
    except Exception:
        # Leave a visible failure marker for the author, then let the task
        # framework record the exception.
        Media.objects.filter(pk=media_id).update(transcript_status='error')
        raise

    media.transcript = transcript
    media.transcript_status = 'done'
    media.save(update_fields=['transcript', 'transcript_status'])


@task()
def process_post_media(media_id: int) -> None:
    """Generate derived media assets without failing the source media row."""
    media = Media.objects.filter(pk=media_id).first()
    if media is None:
        logger.warning('Media %s deleted before media processing ran', media_id)
        return

    processor = MEDIA_PROCESSORS.get(media.media_type)
    if processor is None:
        logger.warning('Media %s has unsupported media_type %s', media_id, media.media_type)
        return

    try:
        processor(media)
    except Exception:
        logger.exception('Error processing %s media %s', media.media_type, media_id)


@task()
def fetch_link_previews(post_id: int) -> None:
    """Fetch pending link previews for a post."""
    post = Post.objects.filter(pk=post_id).first()
    if post is None:
        return

    for preview in post.link_previews.filter(status='pending'):
        try:
            fetch_preview_for(preview)
        except Exception:
            logger.exception('Error fetching link preview %s for post %s', preview.pk, post_id)
            preview.status = 'failed'
            preview.fetched_at = timezone.now()
            preview.save(update_fields=['status', 'fetched_at', 'fetch_attempts'])


def _process_video_media(media: Media) -> None:
    with media.local_copy() as path:
        poster = generate_video_poster(path)

    if poster is not None:
        save_media_thumbnail(media, poster, 'poster.jpg')


def _process_audio_media(media: Media) -> None:
    with media.local_copy() as path:
        waveform = generate_audio_waveform(path)

    if waveform is not None:
        media.waveform = waveform
        media.save(update_fields=['waveform'])


def _process_image_media(media: Media) -> None:
    with media.local_copy() as path:
        rendition = generate_image_rendition(path)

    if rendition is not None:
        save_media_thumbnail(media, rendition, 'rendition.jpg')


MEDIA_PROCESSORS = {
    'video': _process_video_media,
    'audio': _process_audio_media,
    'image': _process_image_media,
}
