"""OpenAI transcription helpers for local media paths."""

import logging

from django.conf import settings
from openai import OpenAI

# Configure logging
logger = logging.getLogger('server.apps.blogs')


def transcribe_audio(path: str) -> str:
    """Transcribe audio file using OpenAI's Whisper API.

    Args:
        path: Local filesystem path to the audio file.

    Returns:
        str: Transcribed text
    """
    # The module-level `openai.api_key` global was removed in openai>=2; use a
    # per-call client instead.
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    with open(path, 'rb') as audio:
        transcription = client.audio.transcriptions.create(
            model='whisper-1',
            file=audio,
        )

    logger.debug('Transcription: %s', transcription.text)
    return transcription.text
