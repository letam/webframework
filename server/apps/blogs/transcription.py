import logging
import os
import tempfile

import openai
from django.conf import settings

# Configure logging
logger = logging.getLogger('server.apps.blogs')


def transcribe_audio(audio_file):
    """Transcribe audio file using OpenAI's Whisper API.

    Args:
        audio_file: Django FileField or similar file object

    Returns:
        str: Transcribed text
    """
    # Configure OpenAI client
    openai.api_key = settings.OPENAI_API_KEY

    # Create a temporary file to store the audio
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=os.path.splitext(audio_file.name)[1]
    ) as temp_file:
        # Write the uploaded file to the temporary file
        for chunk in audio_file.chunks():
            temp_file.write(chunk)
        temp_file.flush()

        # Open the temporary file for transcription
        with open(temp_file.name, 'rb') as audio:
            # Call OpenAI's Whisper API
            transcription = openai.audio.transcriptions.create(
                model='whisper-1',
                file=audio,
            )

            logger.debug('Transcription: %s', transcription.text)

            # Clean up the temporary file
            os.unlink(temp_file.name)

            return transcription.text
