"""Tests for the blogs app views."""

import os
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Media, Post
from . import ViewTestCase

User = get_user_model()


class PostViewSetTests(ViewTestCase):
    """Tests for the PostViewSet."""

    def setUp(self):
        super().setUp()
        # Create a test user
        self.user = User.objects.create_user(username='testuser', password='testpass123')

        # Create an API client
        self.client = APIClient()

        # Create a temporary directory for test files
        self.temp_dir = tempfile.mkdtemp()

        # Create test files
        self.test_file_content = b'test file content'

        # Create test file object
        self.test_file = SimpleUploadedFile(
            'test.txt', self.test_file_content, content_type='text/plain'
        )

    def test_create_post_with_media(self):
        """Test creating a post with media."""
        # Authenticate the client
        self.client.force_authenticate(user=self.user)

        # Create post data
        data = {
            'head': 'Test Post',
            'body': 'Test content',
            'media': self.test_file,
            'media_type': 'audio',
        }

        # Make the request
        response = self.client.post(reverse('post-list'), data, format='multipart')

        # Check response
        self.assertEqual(response.status_code, 201, "Post creation should return 201 status code")

        # Verify post was created
        post = Post.objects.get(id=response.data['id'])
        self.assertEqual(post.head, 'Test Post', "Post head should match the input data")
        self.assertEqual(post.body, 'Test content', "Post body should match the input data")

        # Verify media was created
        self.assertIsNotNone(post.media, "Post should have associated media")
        self.assertEqual(post.media.media_type, 'audio', "Media type should be 'audio'")
        self.assertTrue(os.path.exists(post.media.file.path), "Media file should exist on disk")

    def test_create_post_without_media(self):
        """Test creating a post without media."""
        # Authenticate the client
        self.client.force_authenticate(user=self.user)

        # Create post data without media
        data = {
            'head': 'Test Post Without Media',
            'body': 'Test content without media',
        }

        # Make the request
        response = self.client.post(reverse('post-list'), data)

        # Check response
        self.assertEqual(response.status_code, 201, "Post creation should return 201 status code")

        # Verify post was created
        post = Post.objects.get(id=response.data['id'])
        self.assertEqual(
            post.head, 'Test Post Without Media', "Post head should match the input data"
        )
        self.assertEqual(
            post.body, 'Test content without media', "Post body should match the input data"
        )

        # Verify no media was created
        self.assertIsNone(post.media, "Post should not have associated media")

    def test_media_id_matches_post_id(self):
        """Test that media ID matches post ID when creating a post with media."""
        # Authenticate the client
        self.client.force_authenticate(user=self.user)

        # First create a post without media to take ID 1
        data_without_media = {
            'head': 'First Post',
            'body': 'First post content',
        }
        self.client.post(reverse('post-list'), data_without_media)

        # Now create a post with media
        data_with_media = {
            'head': 'Second Post',
            'body': 'Second post content',
            'media': self.test_file,
            'media_type': 'audio',
        }
        response = self.client.post(reverse('post-list'), data_with_media, format='multipart')

        # Check response
        self.assertEqual(response.status_code, 201, "Post creation should return 201 status code")

        # Verify post and media IDs match
        post = Post.objects.get(id=response.data['id'])
        self.assertIsNotNone(post.media, "Post should have associated media")
        self.assertEqual(post.id, post.media.id, "Post ID should match its media ID")

    def test_delete_post_cleans_up_media(self):
        """Test that deleting a post through the API cleans up media files."""
        # Create a post with media
        media = Media.objects.create(file=self.test_file, media_type='audio')
        post = Post.objects.create(author=self.user, head='Test Post', media=media)

        # Authenticate the client
        self.client.force_authenticate(user=self.user)

        # Get file path before deletion
        file_path = media.file.path

        # Verify file exists
        self.assertTrue(os.path.exists(file_path), "Media file should exist before deletion")

        # Delete the post
        response = self.client.delete(reverse('post-detail', args=[post.id]))

        # Check response
        self.assertEqual(response.status_code, 204, "Post deletion should return 204 status code")

        # Verify file is deleted
        self.assertFalse(os.path.exists(file_path), "Media file should be deleted from disk")

        # Verify records are deleted
        self.assertFalse(
            Post.objects.filter(id=post.id).exists(), "Post record should be deleted from database"
        )
        self.assertFalse(
            Media.objects.filter(id=media.id).exists(),
            "Media record should be deleted from database",
        )

    def tearDown(self):
        # Clean up the temporary directory
        for root, dirs, files in os.walk(self.temp_dir, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(self.temp_dir)
        super().tearDown()
