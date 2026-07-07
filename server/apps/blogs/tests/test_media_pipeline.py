"""Tests for media upload validation, S3-backed media, and signed URLs."""

import tempfile
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Media, Post
from ..serializers import PostSerializer
from . import ViewTestCase

User = get_user_model()


class MediaPipelineTests(ViewTestCase):
    """Tests for direct and presigned media handling."""

    def setUp(self):
        """Create users and authenticate the API client."""
        super().setUp()
        self.client = APIClient()
        self.user = User.objects.create_user(username='media_author', password='testpass123')
        self.other_user = User.objects.create_user(
            username='other_media_author', password='testpass123'
        )
        self.client.force_authenticate(user=self.user)
        self.key = f'post/audio/{self.user.id}/clip.mp3'

    def _audio_file(self, name='clip.mp3', content_type='audio/mpeg', content=b'not real audio'):
        return SimpleUploadedFile(name, content, content_type=content_type)

    def _post_with_s3_key(self, key=None, media_type='audio'):
        return self.client.post(
            reverse('post-list'),
            {
                'head': 'S3 media',
                'body': 'Body',
                's3_file_key': key or self.key,
                'media_type': media_type,
            },
        )

    def test_presigned_post_consumes_s3_key_and_returns_signed_url(self):
        """Creating a post with an uploaded S3 key should attach a Media row."""
        expected_duration = timedelta(seconds=12)
        head = {'ContentLength': 512, 'ContentType': 'audio/mpeg'}

        with (
            mock.patch('apps.blogs.views.head_object', return_value=head),
            mock.patch('apps.blogs.views.download_to_file'),
            mock.patch('apps.blogs.views.get_media_duration', return_value=expected_duration),
            mock.patch(
                'apps.blogs.serializers.generate_presigned_get_url',
                return_value='https://example.com/signed-get',
            ),
        ):
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 201)
        post = Post.objects.get(id=response.data['id'])
        self.assertIsNotNone(post.media)
        self.assertEqual(post.media.s3_file_key, self.key)
        self.assertEqual(post.media.duration, expected_duration)
        self.assertEqual(response.data['media']['signed_url'], 'https://example.com/signed-get')

    def test_media_and_s3_file_key_are_mutually_exclusive(self):
        """A create request cannot include both upload styles."""
        response = self.client.post(
            reverse('post-list'),
            {
                'head': 'Bad',
                'media': self._audio_file(),
                's3_file_key': self.key,
                'media_type': 'audio',
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)

    def test_media_type_is_required_and_must_be_valid_when_media_is_present(self):
        """Media uploads require an allowed media_type."""
        for media_type in (None, 'document'):
            data = {'head': 'Bad', 'media': self._audio_file()}
            if media_type is not None:
                data['media_type'] = media_type

            response = self.client.post(reverse('post-list'), data, format='multipart')
            self.assertEqual(response.status_code, 400)

        self.assertEqual(Post.objects.count(), 0)

    def test_s3_key_must_belong_to_request_user(self):
        """Users cannot claim another user's upload prefix."""
        key = f'post/audio/{self.other_user.id}/clip.mp3'
        with mock.patch('apps.blogs.views.head_object') as mock_head:
            response = self._post_with_s3_key(key=key)

        self.assertEqual(response.status_code, 400)
        mock_head.assert_not_called()

    def test_s3_key_cannot_already_be_referenced(self):
        """A presigned object key cannot be reused by another Media row."""
        Media.objects.create(s3_file_key=self.key, media_type='audio')

        with mock.patch('apps.blogs.views.head_object') as mock_head:
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 400)
        mock_head.assert_not_called()

    def test_head_must_find_uploaded_object(self):
        """Post creation should fail when the object is missing from storage."""
        with mock.patch('apps.blogs.views.head_object', return_value=None):
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Post.objects.count(), 0)

    def test_head_content_length_must_not_exceed_upload_cap(self):
        """Post creation should reject oversized uploaded objects."""
        head = {'ContentLength': settings.MAX_MEDIA_UPLOAD_BYTES + 1, 'ContentType': 'audio/mpeg'}

        with mock.patch('apps.blogs.views.head_object', return_value=head):
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Post.objects.count(), 0)

    def test_head_content_type_must_be_allowed(self):
        """Post creation should reject non-media object content types."""
        head = {'ContentLength': 512, 'ContentType': 'text/plain'}

        with mock.patch('apps.blogs.views.head_object', return_value=head):
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Post.objects.count(), 0)

    def test_ffprobe_failure_deletes_s3_object_and_returns_400(self):
        """Invalid uploaded audio/video bytes should be rejected and deleted."""
        head = {'ContentLength': 512, 'ContentType': 'audio/mpeg'}

        with (
            mock.patch('apps.blogs.views.head_object', return_value=head),
            mock.patch('apps.blogs.views.download_to_file'),
            mock.patch('apps.blogs.views.get_media_duration', return_value=None),
            mock.patch('apps.blogs.views.delete_object') as mock_delete,
        ):
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 400)
        mock_delete.assert_called_once_with(self.key)
        self.assertEqual(Post.objects.count(), 0)

    def test_direct_upload_rejects_plain_text_content_type(self):
        """Direct uploads should reject non-media content types."""
        response = self.client.post(
            reverse('post-list'),
            {
                'head': 'Bad upload',
                'media': self._audio_file(name='clip.txt', content_type='text/plain'),
                'media_type': 'audio',
            },
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Post.objects.count(), 0)

    def test_deleting_post_with_s3_media_deletes_s3_object(self):
        """Deleting an S3-backed media post should delete the object key."""
        media = Media.objects.create(s3_file_key=self.key, media_type='audio')
        post = Post.objects.create(author=self.user, head='Delete me', media=media)

        with mock.patch('apps.blogs.models.delete_object') as mock_delete:
            post.delete()

        mock_delete.assert_called_once_with(self.key)

    def test_stream_post_media_returns_404_without_media(self):
        """The media streaming endpoint should 404 for posts without media."""
        post = Post.objects.create(author=self.user, head='No media')

        response = self.client.get(reverse('stream_post_media', args=[post.id]))

        self.assertEqual(response.status_code, 404)

    def test_stream_post_media_redirects_for_s3_only_media(self):
        """The media streaming endpoint should redirect for S3-only media."""
        media = Media.objects.create(s3_file_key=self.key, media_type='audio')
        post = Post.objects.create(author=self.user, head='Stream me', media=media)

        with mock.patch(
            'apps.blogs.views.generate_presigned_get_url',
            return_value='https://example.com/signed-stream',
        ):
            response = self.client.get(reverse('stream_post_media', args=[post.id]))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], 'https://example.com/signed-stream')

    def test_local_file_media_serializer_signed_url_is_none(self):
        """Local-file media should not include a signed URL."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(file=self._audio_file(), media_type='audio')
                post = Post.objects.create(author=self.user, head='Local media', media=media)
                data = PostSerializer(post).data

        self.assertIsNone(data['media']['signed_url'])
