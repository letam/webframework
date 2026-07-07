"""OpenAI transcription helpers for local media paths."""

import logging

import openai
from django.conf import settings

# Configure logging
logger = logging.getLogger('server.apps.blogs')


def transcribe_audio(path: str) -> str:
    """Transcribe audio file using OpenAI's Whisper API.

    Args:
        path: Local filesystem path to the audio file.

    Returns:
        str: Transcribed text
    """
    # Configure OpenAI client
    openai.api_key = settings.OPENAI_API_KEY

    with open(path, 'rb') as audio:
        transcription = openai.audio.transcriptions.create(
            model='whisper-1',
            file=audio,
        )

        logger.debug('Transcription: %s', transcription.text)
        return transcription.text
