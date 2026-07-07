"""Test suite for the blogs app."""

import os
import tempfile

from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, override_settings


# Tests must run tasks inline regardless of the env's TASKS_IMMEDIATE.
@override_settings(
    TASKS={'default': {'BACKEND': 'django_tasks.backends.immediate.ImmediateBackend'}}
)
class BaseTestCase(TestCase):
    """Base test case for all tests."""

    def setUp(self):
        """Reset shared state between tests."""
        super().setUp()
        # Rate-limit counters live in the shared cache; clear it so requests
        # made by earlier tests don't trip throttles in later ones.
        cache.clear()


class ViewTestCase(BaseTestCase):
    """Base test case for view tests that handles static directory setup and cleanup."""

    def setUp(self):
        """Create a temporary static directory for view tests."""
        super().setUp()
        # Create a temporary static directory
        self.static_dir = tempfile.mkdtemp()
        # Store original static root
        self.original_static_root = settings.STATIC_ROOT
        # Set static root to our temporary directory
        settings.STATIC_ROOT = self.static_dir

    def tearDown(self):
        """Restore static settings and remove the temporary static directory."""
        # Restore original static root
        settings.STATIC_ROOT = self.original_static_root
        # Remove temporary static directory
        for root, dirs, files in os.walk(self.static_dir, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(self.static_dir)
        super().tearDown()
