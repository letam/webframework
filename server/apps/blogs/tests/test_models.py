"""Tests for the blogs app models."""

import os
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

from ..models import Media, Post
from . import BaseTestCase

User = get_user_model()


class MediaModelTests(BaseTestCase):
    """Tests for the Media model."""

    def setUp(self):
        super().setUp()

    def tearDown(self):
        super().tearDown()


class PostModelTests(BaseTestCase):
    """Tests for the Post model."""

    def setUp(self):
        super().setUp()
        # Create a test user
        self.user = User.objects.create_user(username='testuser', password='testpass123')

        # Create a temporary directory for test files
        self.temp_dir = tempfile.mkdtemp()

        # Create test files
        self.test_file_content = b'test file content'
        self.test_mp3_content = b'test mp3 content'

        # Create test file objects
        self.test_file = SimpleUploadedFile(
            'test.txt', self.test_file_content, content_type='text/plain'
        )
        self.test_mp3 = SimpleUploadedFile(
            'test.mp3', self.test_mp3_content, content_type='audio/mpeg'
        )

    def test_create_post(self):
        """Test creating a basic post."""
        post = Post.objects.create(
            head="Test Post",
            body="Test content",
            author=self.user,
        )
        self.assertEqual(post.head, "Test Post")
        self.assertEqual(post.body, "Test content")
        self.assertEqual(post.author, self.user)
        self.assertIsNotNone(post.created)
        self.assertIsNotNone(post.modified)

    def test_create_post_with_media(self):
        """Test creating a post with associated media."""
        post = Post.objects.create(author=self.user)
        media = Media.objects.create(
            id=post.id,
            file=self.test_mp3,
            media_type='audio',
        )
        post.media = media
        post.save()
        self.assertEqual(post.media, media)
        self.assertEqual(post.id, media.id)
        self.assertEqual(post.media.id, media.id)

    def tearDown(self):
        # Clean up the temporary directory
        for root, dirs, files in os.walk(self.temp_dir, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(self.temp_dir)
        super().tearDown()
