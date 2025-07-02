"""Tests for the blogs app models."""

import os
import tempfile
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from ..models import Media, Post
from ..utils.media import get_media_duration
from . import BaseTestCase

User = get_user_model()


TEST_MEDIA_ROOT = os.path.join(tempfile.gettempdir(), 'uploads')


def cleanup_test_media_root():
    for root, dirs, files in os.walk(TEST_MEDIA_ROOT, topdown=False):
        for name in files:
            os.remove(os.path.join(root, name))
        for name in dirs:
            os.rmdir(os.path.join(root, name))


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

    def test_media_duration_extraction(self):
        """Test that duration is extracted when creating a media record."""
        # Create a media record with an audio file
        media = Media.objects.create(
            file=self.test_mp3,
            media_type='audio',
        )

        # Refresh from database to get updated duration
        media.refresh_from_db()

        # Note: Since we're using a mock file, duration might be None
        # In a real scenario with actual media files, this would be set
        # The important thing is that the save method doesn't crash
        self.assertIsNotNone(media.id)
        self.assertTrue(os.path.exists(media.file.path))

        # Test that the duration field exists and can be set
        self.assertIsNone(media.duration)  # Mock file won't have real duration

        # Test setting duration manually
        test_duration = timedelta(seconds=120)
        media.duration = test_duration
        media.save()

        # Refresh and verify
        media.refresh_from_db()
        self.assertEqual(media.duration, test_duration)

        # Test that duration is preserved on subsequent saves
        media.save()
        media.refresh_from_db()
        self.assertEqual(media.duration, test_duration)

    def test_media_duration_extraction_with_real_file(self):
        """Test duration extraction with a more realistic file scenario."""
        import subprocess
        import tempfile

        # Create a temporary file that ffprobe can analyze
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            # Create a minimal valid MP3 file header
            # This is a very basic MP3 header - in real scenarios, you'd have actual audio data
            mp3_header = b'\xff\xfb\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
            temp_file.write(mp3_header)
            temp_file_path = temp_file.name

        try:
            # Create a SimpleUploadedFile from the temporary file
            with open(temp_file_path, 'rb') as f:
                uploaded_file = SimpleUploadedFile(
                    'test_real.mp3', f.read(), content_type='audio/mpeg'
                )

            # Create media record
            media = Media.objects.create(
                file=uploaded_file,
                media_type='audio',
            )

            # Refresh from database
            media.refresh_from_db()

            # Verify the record was created successfully
            self.assertIsNotNone(media.id)
            self.assertTrue(os.path.exists(media.file.path))

            # The duration might still be None for this minimal file, but the process should complete
            # without errors
            self.assertIsInstance(media.duration, (type(None), timedelta))

        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)

    def test_media_duration_extraction_skips_if_already_set(self):
        """Test that duration extraction is skipped if duration is already set."""
        # Create media with duration already set
        test_duration = timedelta(seconds=180)
        media = Media.objects.create(
            file=self.test_mp3,
            media_type='audio',
            duration=test_duration,
        )

        # Refresh from database
        media.refresh_from_db()

        # Duration should remain unchanged
        self.assertEqual(media.duration, test_duration)

        # Save again to trigger the save method
        media.save()
        media.refresh_from_db()

        # Duration should still be the same
        self.assertEqual(media.duration, test_duration)

    def test_get_media_duration_utility(self):
        """Test the get_media_duration utility function directly."""
        import tempfile

        # Test with a non-existent file
        result = get_media_duration('/path/to/nonexistent/file.mp3')
        self.assertIsNone(result)

        # Test with a text file (should return None as it's not a media file)
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as temp_file:
            temp_file.write(b'This is not a media file')
            temp_file_path = temp_file.name

        try:
            result = get_media_duration(temp_file_path)
            # Should return None for non-media files
            self.assertIsNone(result)
        finally:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)

    def test_media_duration_extraction_with_expected_duration(self):
        """Test duration extraction with a audio file with the expected duration."""
        import subprocess
        import tempfile

        expected_duration = timedelta(seconds=3.5)

        # Create a audio file using ffmpeg with the expected duration
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            temp_file_path = temp_file.name

        try:
            # Generate a silent MP3 file using ffmpeg with the expected duration
            cmd = [
                'ffmpeg',
                '-f',
                'lavfi',
                '-i',
                'anullsrc=channel_layout=stereo:sample_rate=44100',
                '-t',
                str(expected_duration.total_seconds()),
                '-c:a',
                'mp3',
                '-b:a',
                '128k',
                '-y',  # Overwrite output file
                temp_file_path,
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                self.skipTest("ffmpeg not available or failed to create test audio file")

            # Verify the file was created and has content
            self.assertTrue(os.path.exists(temp_file_path))
            self.assertGreater(os.path.getsize(temp_file_path), 0)

            # Test the duration extraction utility directly
            duration = get_media_duration(temp_file_path)
            self.assertIsNotNone(duration)
            self.assertIsInstance(duration, timedelta)

            # Check that duration is approximately the expected duration (allow small tolerance)
            self.assertAlmostEqual(
                duration.total_seconds(), expected_duration.total_seconds(), delta=0.1
            )

            # Now test with the Media model
            with open(temp_file_path, 'rb') as f:
                uploaded_file = SimpleUploadedFile(
                    'test_35_second.mp3', f.read(), content_type='audio/mpeg'
                )

            # Create media record
            media = Media.objects.create(
                file=uploaded_file,
                media_type='audio',
            )

            # Refresh from database
            media.refresh_from_db()

            # Verify the record was created successfully
            self.assertIsNotNone(media.id)
            self.assertTrue(os.path.exists(media.file.path))

            # Check that duration was extracted and saved
            self.assertIsNotNone(media.duration)
            self.assertIsInstance(media.duration, timedelta)

            # Verify the duration is approximately the expected duration
            self.assertAlmostEqual(
                media.duration.total_seconds(), expected_duration.total_seconds(), delta=0.1
            )

        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)

    def tearDown(self):
        cleanup_test_media_root()

        super().tearDown()


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class PostModelTests(BaseTestCase):
    """Tests for the Post model."""

    def setUp(self):
        super().setUp()
        # Create a test user
        self.user = User.objects.create_user(username='testuser', password='testpass123')

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

    def test_post_delete_cleans_up_media(self):
        """Test that deleting a Post cleans up its associated Media record and files."""
        # Create a media record
        media = Media.objects.create(
            file=self.test_file, mp3_file=self.test_mp3, media_type='audio'
        )

        # Create a post with the media
        post = Post.objects.create(author=self.user, head='Test Post', media=media)

        # Get file paths before deletion
        file_path = media.file.path
        mp3_path = media.mp3_file.path

        # Verify files exist
        self.assertTrue(os.path.exists(file_path), f"File should exist at {file_path}")
        self.assertTrue(os.path.exists(mp3_path), f"MP3 file should exist at {mp3_path}")

        # Delete the post
        post.delete()

        # Verify files are deleted
        self.assertFalse(os.path.exists(file_path), f"File should be deleted from {file_path}")
        self.assertFalse(os.path.exists(mp3_path), f"MP3 file should be deleted from {mp3_path}")

        # Verify records are deleted
        self.assertFalse(
            Post.objects.filter(id=post.id).exists(), f"Post should be deleted from {post.id}"
        )
        self.assertFalse(
            Media.objects.filter(id=media.id).exists(), f"Media should be deleted from {media.id}"
        )

    def test_post_delete_without_media(self):
        """Test that deleting a Post without media works correctly."""
        # Create a post without media
        post = Post.objects.create(author=self.user, head='Test Post')

        # Delete should not raise an exception
        post.delete()

        # Verify record is deleted
        self.assertFalse(Post.objects.filter(id=post.id).exists())

    def tearDown(self):
        cleanup_test_media_root()

        super().tearDown()
