"""Test suite for the blogs app."""

import os
import tempfile
from django.test import TestCase
from django.conf import settings


class BaseTestCase(TestCase):
    """Base test case for all tests."""

    pass


class ViewTestCase(BaseTestCase):
    """Base test case for view tests that handles static directory setup and cleanup."""

    def setUp(self):
        super().setUp()
        # Create a temporary static directory
        self.static_dir = tempfile.mkdtemp()
        # Store original static root
        self.original_static_root = settings.STATIC_ROOT
        # Set static root to our temporary directory
        settings.STATIC_ROOT = self.static_dir

    def tearDown(self):
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
