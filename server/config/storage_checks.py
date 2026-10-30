"""Best-effort warnings about production data on the container filesystem."""

import logging
import os
import sys
from pathlib import Path

from django.conf import settings

logger = logging.getLogger('server')


def _warn_if_on_root_filesystem(label, directory):
    """Compare devices without making a storage diagnostic a startup failure."""
    try:
        shares_root = os.stat(directory).st_dev == os.stat('/').st_dev
    except (OSError, ValueError, TypeError) as exc:
        logger.warning(
            'Could not check %s directory %s for persistent storage: %s', label, directory, exc
        )
        return

    if shares_root:
        logger.warning(
            '%s directory %s shares the root filesystem; data may be lost on container '
            'restart. Verify that this path is on persistent storage.',
            label,
            directory,
        )


def warn_about_ephemeral_storage():
    """Warn at boot for local media and SQLite, without assuming a mount path.

    Sharing a device is legitimate outside container deployments, so this is
    advisory only. Do not open the database or contact object storage here.
    """
    if settings.DEBUG or 'test' in sys.argv or 'pytest' in sys.modules:
        return

    if settings.USE_LOCAL_FILE_STORAGE:
        _warn_if_on_root_filesystem('MEDIA_ROOT', settings.MEDIA_ROOT)

    database = settings.DATABASES['default']
    if database['ENGINE'] == 'django.db.backends.sqlite3':
        name = database.get('NAME')
        if name and name != ':memory:' and not str(name).startswith('file:'):
            # Check the directory: a first boot may not have created the DB yet.
            _warn_if_on_root_filesystem('SQLite DATABASE_URL', Path(name).parent)
