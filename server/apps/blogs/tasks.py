"""Background tasks for the blogs app."""

import logging
import os

from django_tasks import task

from .models import Media
from .transcription import transcribe_audio
from .utils import convert_to_mp3

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
