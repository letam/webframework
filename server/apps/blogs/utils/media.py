"""Media probing helpers."""

import logging
import os
import subprocess
import tempfile
from datetime import timedelta

logger = logging.getLogger('server.apps.blogs')


class MediaProbeError(Exception):
    """Raised when ffprobe cannot run at all (missing binary, OS failure).

    Distinct from ffprobe running and rejecting the file, which is the
    caller's signal that the bytes are not valid media.
    """


def probe_media_duration(file_path: str) -> timedelta | None:
    """Return the media duration, or None when ffprobe rejects the file.

    Raises MediaProbeError when ffprobe itself cannot run, so callers can
    distinguish an invalid file from a broken environment.
    """
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
    except subprocess.CalledProcessError as e:
        logger.info(f'ffprobe rejected {file_path}: {e.stderr.strip() if e.stderr else e}')
        return None
    except OSError as e:
        raise MediaProbeError(f'ffprobe could not run: {e}') from e

    try:
        return timedelta(seconds=float(result.stdout.strip()))
    except ValueError:
        logger.info(f'ffprobe found no duration for {file_path}')
        return None


def get_media_duration(file_path: str) -> timedelta | None:
    """Returns the duration of a media file as a timedelta object using ffprobe."""
    try:
        return probe_media_duration(file_path)
    except MediaProbeError as e:
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
