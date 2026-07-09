"""User utility helpers."""

import logging

logger = logging.getLogger(__name__)


def get_avatar_url(user):
    """Return a storage-backed avatar URL for a user, or None."""
    avatar = getattr(user, 'avatar', None)
    if not avatar:
        return None

    try:
        return avatar.storage.url(avatar.name)
    except Exception:
        logger.exception('Failed to build avatar URL for user %s', getattr(user, 'pk', None))
        return None
