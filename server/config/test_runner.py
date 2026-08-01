"""Test runner that pins the environment-dependent settings the suite relies on."""

import tempfile

from django.conf import settings
from django.test.runner import DiscoverRunner
from django.test.utils import override_settings

FILE_SYSTEM_STORAGE = 'django.core.files.storage.FileSystemStorage'


class LocalStorageTestRunner(DiscoverRunner):
    """Run tests against filesystem media storage and a throwaway MEDIA_ROOT.

    No test intends to talk to S3/R2: the media tests write real files and read
    them back. Which storage backend they get is otherwise decided by whatever
    ``USE_LOCAL_FILE_STORAGE`` happens to be in the developer's ``server/.env``,
    so a checkout configured for R2 fails ~36 tests at boto3 client creation
    while CI — whose auto-generated .env sets local storage — stays green.
    Pinning it here makes the suite say the same thing everywhere.

    ``override_settings(USE_LOCAL_FILE_STORAGE=True)`` inside a test is not
    enough on its own: ``STORAGES`` is derived from that flag once at import,
    so the backend has to be replaced too.
    """

    def setup_test_environment(self, **kwargs):
        """Force filesystem storage and point MEDIA_ROOT at a temp directory."""
        super().setup_test_environment(**kwargs)
        self._media_root = tempfile.TemporaryDirectory(prefix='webframework-test-media-')
        self._storage_override = override_settings(
            USE_LOCAL_FILE_STORAGE=True,
            STORAGES={
                **settings.STORAGES,
                'default': {'BACKEND': FILE_SYSTEM_STORAGE},
            },
            MEDIA_ROOT=self._media_root.name,
        )
        self._storage_override.enable()

    def teardown_test_environment(self, **kwargs):
        """Restore the real storage settings and delete the temp MEDIA_ROOT."""
        self._storage_override.disable()
        self._media_root.cleanup()
        super().teardown_test_environment(**kwargs)
