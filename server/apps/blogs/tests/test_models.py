"""Tests for the blogs app models."""

import os
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from ..models import Media, Post
from . import BaseTestCase

User = get_user_model()


TEST_MEDIA_ROOT = os.path.join(tempfile.gettempdir(), 'uploads')


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class MediaModelTests(BaseTestCase):
    """Tests for the Media model."""

    def setUp(self):
        super().setUp()
        # Create a test user
        self.user = User.objects.create_user(username='testuser', password='testpass123')

        # Create test files
        self.test_file_content = b'test file content'
        self.test_mp3_content = b'test mp3 content'
        self.test_thumbnail_content = b'test thumbnail content'

        # Create test file objects
        self.test_file = SimpleUploadedFile(
            'test.txt', self.test_file_content, content_type='text/plain'
        )
        self.test_mp3 = SimpleUploadedFile(
            'test.mp3', self.test_mp3_content, content_type='audio/mpeg'
        )

    def test_media_delete_cleans_up_files(self):
        """Test that Media.delete() removes all associated files and directory."""
        # Create a media record with all file types
        media = Media.objects.create(
            file=self.test_file,
            media_type='audio',
        )

        # Get file paths before deletion
        file_path = media.file.path
        media_dir = os.path.dirname(file_path)

        # Verify files and directory exist
        self.assertTrue(os.path.exists(file_path), f"Main file should exist at {file_path}")
        self.assertTrue(os.path.exists(media_dir), f"Media directory should exist at {media_dir}")

        # Delete the media record
        media.delete()

        # Verify files are deleted
        self.assertFalse(
            os.path.exists(file_path), f"Main file should be deleted from {file_path}"
        )
        self.assertFalse(
            os.path.exists(media_dir), f"Media directory should be deleted from {media_dir}"
        )

        # Verify record is deleted
        self.assertFalse(Media.objects.filter(id=media.id).exists())

    def test_media_delete_handles_missing_files(self):
        """Test that Media.delete() handles missing files gracefully."""
        # Create a media record
        media = Media.objects.create(file=self.test_file, media_type='audio')

        # Manually delete the file
        os.remove(media.file.path)

        # Delete should not raise an exception
        media.delete()

        # Verify record is deleted
        self.assertFalse(Media.objects.filter(id=media.id).exists())

    def tearDown(self):
        # Clean up any remaining test files
        if os.path.exists(TEST_MEDIA_ROOT):
            for root, dirs, files in os.walk(TEST_MEDIA_ROOT, topdown=False):
                for name in files:
                    os.remove(os.path.join(root, name))
                for name in dirs:
                    os.rmdir(os.path.join(root, name))
            os.rmdir(TEST_MEDIA_ROOT)

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
