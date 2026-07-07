"""Media probing helpers."""

import logging
import os
import subprocess
import tempfile
from datetime import timedelta

logger = logging.getLogger('server.apps.blogs')


def get_media_duration(file_path: str) -> timedelta | None:
    """Returns the duration of a media file as a timedelta object using ffprobe."""
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v',
                'error',
                '-show_entries',
                'format=duration',
                '-of',
                'default=noprint_wrappers=1:nokey=1',
                file_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        seconds = float(result.stdout.strip())
        return timedelta(seconds=seconds)
    except Exception as e:
        logger.error(f'Error getting duration for {file_path}: {str(e)}')
        return None


def get_field_file_duration(field_file) -> timedelta | None:
    """Return media duration for a Django FieldFile without assuming local storage."""
    try:
        return get_media_duration(field_file.path)
    except (NotImplementedError, ValueError):
        pass
    except Exception:
        logger.exception("Error opening local media path for %s", field_file.name)
        return None

    temp_path = None
    suffix = os.path.splitext(field_file.name)[1]
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            field_file.open('rb')
            try:
                while chunk := field_file.read(64 * 1024):
                    temp_file.write(chunk)
            finally:
                field_file.close()

        return get_media_duration(temp_path)
    except Exception:
        logger.exception("Error getting duration for %s", field_file.name)
        return None
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
