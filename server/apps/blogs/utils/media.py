import logging
import subprocess
from datetime import timedelta

logger = logging.getLogger('server.apps.blogs')


def get_media_duration(file_path: str) -> timedelta:
    """
    Returns the duration of a media file as a timedelta object using ffprobe.
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
        seconds = float(result.stdout.strip())
        return timedelta(seconds=seconds)
    except Exception as e:
        logger.error(f'Error getting duration for {file_path}: {str(e)}')
        return None
