"""Tests for security hardening: transcribe access control and presign validation."""

# pyright: reportAttributeAccessIssue=false, reportOptionalMemberAccess=false

import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Post
from . import ViewTestCase

User = get_user_model()


class TranscribeAccessTests(ViewTestCase):
    """The transcribe endpoint calls a paid API and must be locked down."""

    def setUp(self):
        """Create an author, another user, and a post to transcribe."""
        super().setUp()
        self.author = User.objects.create_user(username='author', password='testpass123')
        self.other = User.objects.create_user(username='other', password='testpass123')
        self.post = Post.objects.create(author=self.author, head='Test', body='Body')
        self.url = reverse('post-transcribe', args=[self.post.id])
        self.client = APIClient()

    def test_transcribe_requires_authentication(self):
        """Unauthenticated transcribe requests should return 401."""
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, 401)

    def test_transcribe_forbidden_for_non_author(self):
        """Users cannot transcribe posts they did not write."""
        self.client.force_authenticate(user=self.other)
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, 403)

    def test_transcribe_allowed_for_author(self):
        """The author passes the permission check (then 400: the post has no media)."""
        self.client.force_authenticate(user=self.author)
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, 400)

    def test_transcribe_is_rate_limited(self):
        """Transcribe requests beyond the throttle rate get a 429."""
        self.client.force_authenticate(user=self.author)
        for _ in range(10):
            self.client.post(self.url)

        response = self.client.post(self.url)
        self.assertEqual(response.status_code, 429)


class PresignUploadTests(ViewTestCase):
    """The presign endpoint must validate client input before signing keys."""

    def setUp(self):
        """Set up a client for JSON posts to the presign endpoint."""
        super().setUp()
        self.url = reverse('get_presigned_url')

    def _presign(self, payload):
        return self.client.post(self.url, json.dumps(payload), content_type='application/json')

    def test_invalid_json_body_returns_400(self):
        """A malformed body should be a 400, not a 500."""
        response = self.client.post(self.url, 'not json', content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_missing_fields_return_400(self):
        """Requests without content_type or file_name should be a 400, not a 500."""
        self.assertEqual(self._presign({}).status_code, 400)
        self.assertEqual(self._presign({'content_type': 'audio/mpeg'}).status_code, 400)
        self.assertEqual(self._presign({'file_name': 'a.mp3'}).status_code, 400)

    def test_non_media_content_type_is_rejected(self):
        """Only audio, video and image content types may be uploaded."""
        response = self._presign({'content_type': 'text/html', 'file_name': 'evil.html'})
        self.assertEqual(response.status_code, 400)

    @mock.patch('apps.uploads.views.get_s3_client')
    def test_recorded_media_content_type_is_accepted(self, mock_s3):
        """Browser-recorded types like 'audio/webm;codecs=opus' are valid."""
        mock_s3.return_value.generate_presigned_url.return_value = 'https://example.com/signed'
        response = self._presign(
            {'content_type': 'audio/webm;codecs=opus', 'file_name': 'recording.webm'}
        )
        self.assertEqual(response.status_code, 200)

    @mock.patch('apps.uploads.views.get_s3_client')
    def test_path_traversal_in_file_name_is_stripped(self, mock_s3):
        """Client-supplied directories must not leak into the S3 key."""
        mock_s3.return_value.generate_presigned_url.return_value = 'https://example.com/signed'
        response = self._presign(
            {'content_type': 'audio/mpeg', 'file_name': '../../../etc/passwd.mp3'}
        )
        self.assertEqual(response.status_code, 200)
        file_path = response.json()['file_path']
        self.assertNotIn('..', file_path)
        self.assertTrue(file_path.startswith('post/audio/'))
        self.assertTrue(file_path.endswith('/passwd.mp3'))

    def test_file_name_of_only_separators_is_rejected(self):
        """A file name that sanitizes to nothing should be a 400."""
        response = self._presign({'content_type': 'audio/mpeg', 'file_name': '../..'})
        self.assertEqual(response.status_code, 400)

    @mock.patch('apps.uploads.views.get_s3_client')
    def test_anonymous_upload_is_keyed_to_anonymous_user(self, mock_s3):
        """Unauthenticated uploads go under the dedicated anonymous user's prefix."""
        mock_s3.return_value.generate_presigned_url.return_value = 'https://example.com/signed'
        response = self._presign({'content_type': 'audio/mpeg', 'file_name': 'clip.mp3'})
        self.assertEqual(response.status_code, 200)

        anonymous = User.objects.get(username='anonymous')
        self.assertEqual(response.json()['file_path'], f'post/audio/{anonymous.id}/clip.mp3')

    @mock.patch('apps.uploads.views.get_s3_client')
    def test_presign_is_rate_limited(self, mock_s3):
        """Presign requests beyond the per-IP limit get a 429."""
        mock_s3.return_value.generate_presigned_url.return_value = 'https://example.com/signed'
        payload = {'content_type': 'audio/mpeg', 'file_name': 'clip.mp3'}
        for _ in range(30):
            self._presign(payload)

        response = self._presign(payload)
        self.assertEqual(response.status_code, 429)


class AnonymousPostAuthorTests(ViewTestCase):
    """Anonymous posts must resolve the anonymous user by name, not a hardcoded ID."""

    def test_anonymous_post_is_attributed_to_anonymous_user(self):
        """Posting while logged out attributes the post to the 'anonymous' user."""
        client = APIClient()
        response = client.post(reverse('post-list'), {'body': 'hello from nobody'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['author']['username'], 'anonymous')
