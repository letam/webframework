"""Tests for the blogs app views."""

import os
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Post
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
        self.assertEqual(response.status_code, 201)

        # Verify post was created
        post = Post.objects.get(id=response.data['id'])
        self.assertEqual(post.head, 'Test Post')
        self.assertEqual(post.body, 'Test content')

        # Verify media was created
        self.assertIsNotNone(post.media)
        self.assertEqual(post.media.media_type, 'audio')
        self.assertTrue(os.path.exists(post.media.file.path))

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
        self.assertEqual(response.status_code, 201)

        # Verify post was created
        post = Post.objects.get(id=response.data['id'])
        self.assertEqual(post.head, 'Test Post Without Media')
        self.assertEqual(post.body, 'Test content without media')

        # Verify no media was created
        self.assertIsNone(post.media)

    def tearDown(self):
        # Clean up the temporary directory
        for root, dirs, files in os.walk(self.temp_dir, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(self.temp_dir)
        super().tearDown()
