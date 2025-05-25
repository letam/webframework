import logging
import subprocess

logger = logging.getLogger('server.apps.blogs')


def get_file_mime_type(file_path):
    try:
        result = subprocess.run(
            [
                'file',
                '-b',
                '--mime-type',
                file_path,
            ],
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except Exception as e:
        logger.error(f'Error getting mime type for {file_path}: {str(e)}')
        return 'unknown'
