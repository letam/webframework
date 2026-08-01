"""OpenAI transcription helpers for local media paths."""

import logging
from functools import lru_cache

from django.conf import settings
from openai import OpenAI

# Configure logging
logger = logging.getLogger('server.apps.blogs')


@lru_cache(maxsize=1)
def get_openai_client() -> OpenAI:
    """Return a cached OpenAI client, mirroring apps.uploads.s3.get_s3_client.

    Built lazily rather than at import: `OpenAI()` raises when no API key is set,
    and that must surface as a failed transcription task, not as an ImportError
    that takes down every deployment without a key. lru_cache does not cache
    exceptions, so an unconfigured process keeps re-raising rather than latching.
    """
    return OpenAI(api_key=settings.OPENAI_API_KEY)


def transcribe_audio(path: str) -> str:
    """Transcribe audio file using OpenAI's Whisper API.

    Args:
        path: Local filesystem path to the audio file.

    Returns:
        str: Transcribed text
    """
    # The module-level `openai.api_key` global was removed in openai>=2; use a
    # client instead.
    client = get_openai_client()

    with open(path, 'rb') as audio:
        transcription = client.audio.transcriptions.create(
            model='whisper-1',
            file=audio,
        )

    logger.debug('Transcription: %s', transcription.text)
    return transcription.text
