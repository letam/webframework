"""Tests for security hardening: transcribe access control and presign validation."""

# pyright: reportAttributeAccessIssue=false, reportOptionalMemberAccess=false

import json
from unittest import mock

from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.core.files.base import ContentFile
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from django.utils.module_loading import import_string
from rest_framework.test import APIClient

from apps.uploads.s3 import REQUIRED_S3_SETTINGS, generate_presigned_put_url, get_s3_client
from apps.uploads.storage import GuardedS3Boto3Storage

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
        """Requests without content_type, file_name or content_length are a 400, not a 500."""
        self.assertEqual(self._presign({}).status_code, 400)
        self.assertEqual(self._presign({'content_type': 'audio/mpeg'}).status_code, 400)
        self.assertEqual(self._presign({'file_name': 'a.mp3'}).status_code, 400)
        self.assertEqual(
            self._presign({'content_type': 'audio/mpeg', 'file_name': 'a.mp3'}).status_code,
            400,
        )

    def test_non_integer_content_length_is_rejected(self):
        """A non-integer (or boolean) size is a malformed request, not a 1-byte upload."""
        for bad in ('1024', 12.5, True, None, [1024]):
            with self.subTest(content_length=bad):
                response = self._presign(
                    {'content_type': 'audio/mpeg', 'file_name': 'clip.mp3', 'content_length': bad}
                )
                self.assertEqual(response.status_code, 400)

    def test_zero_or_oversized_content_length_is_rejected(self):
        """Sizes must be positive and within the media ceiling; the edge enforces it too."""
        for bad in (0, -1, django_settings.MAX_MEDIA_UPLOAD_BYTES + 1):
            with self.subTest(content_length=bad):
                response = self._presign(
                    {'content_type': 'audio/mpeg', 'file_name': 'clip.mp3', 'content_length': bad}
                )
                self.assertEqual(response.status_code, 400)

    @mock.patch('apps.uploads.views.generate_presigned_put_url')
    def test_content_length_at_the_ceiling_is_signed_into_the_url(self, mock_presign):
        """The exact byte count reaches the signer so R2 can enforce it at the edge."""
        mock_presign.return_value = 'https://example.com/signed'
        size = django_settings.MAX_MEDIA_UPLOAD_BYTES
        response = self._presign(
            {'content_type': 'audio/mpeg', 'file_name': 'clip.mp3', 'content_length': size}
        )
        self.assertEqual(response.status_code, 200)
        # (file_path, content_type, content_length) — the size is passed through.
        self.assertEqual(mock_presign.call_args.args[2], size)

    def test_non_media_content_type_is_rejected(self):
        """Only audio, video and image content types may be uploaded."""
        response = self._presign({'content_type': 'text/html', 'file_name': 'evil.html'})
        self.assertEqual(response.status_code, 400)

    @mock.patch('apps.uploads.views.generate_presigned_put_url')
    def test_recorded_media_content_type_is_accepted(self, mock_presign):
        """Browser-recorded types like 'audio/webm;codecs=opus' are valid."""
        mock_presign.return_value = 'https://example.com/signed'
        response = self._presign(
            {
                'content_type': 'audio/webm;codecs=opus',
                'file_name': 'recording.webm',
                'content_length': 1024,
            }
        )
        self.assertEqual(response.status_code, 200)

    @mock.patch('apps.uploads.views.generate_presigned_put_url')
    def test_path_traversal_in_file_name_is_stripped(self, mock_presign):
        """Client-supplied directories must not leak into the S3 key."""
        mock_presign.return_value = 'https://example.com/signed'
        response = self._presign(
            {
                'content_type': 'audio/mpeg',
                'file_name': '../../../etc/passwd.mp3',
                'content_length': 1024,
            }
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

    @mock.patch('apps.uploads.views.generate_presigned_put_url')
    def test_anonymous_upload_is_keyed_to_anonymous_user(self, mock_presign):
        """Unauthenticated uploads go under the dedicated anonymous user's prefix."""
        mock_presign.return_value = 'https://example.com/signed'
        response = self._presign(
            {'content_type': 'audio/mpeg', 'file_name': 'clip.mp3', 'content_length': 1024}
        )
        self.assertEqual(response.status_code, 200)

        anonymous = User.objects.get(username='anonymous')
        self.assertEqual(response.json()['file_path'], f'post/audio/{anonymous.id}/clip.mp3')

    @mock.patch('apps.uploads.views.generate_presigned_put_url')
    def test_presign_is_rate_limited(self, mock_presign):
        """Presign requests beyond the per-IP limit get a 429."""
        mock_presign.return_value = 'https://example.com/signed'
        payload = {'content_type': 'audio/mpeg', 'file_name': 'clip.mp3', 'content_length': 1024}
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


@override_settings(
    AWS_ACCESS_KEY_ID='key',
    AWS_SECRET_ACCESS_KEY='secret',
    AWS_S3_ENDPOINT_URL='https://account.r2.example.com',
    AWS_STORAGE_BUCKET_NAME='bucket',
)
class S3ConfigurationTests(SimpleTestCase):
    """Half-configured object storage must fail, not silently address AWS.

    boto3 reads ``endpoint_url=None`` as "use the real AWS endpoints" and
    ``aws_access_key_id=None`` as "use the ambient credential chain", so a
    deployment missing only R2_ACCOUNT_ID would sign perfectly valid URLs
    against ``https://<bucket>.s3.amazonaws.com`` instead of Cloudflare.
    """

    def setUp(self):
        """Drop the process-global client cache around every case."""
        get_s3_client.cache_clear()
        self.addCleanup(get_s3_client.cache_clear)

    def test_fully_configured_client_targets_the_r2_endpoint(self):
        """The happy path builds a client aimed at the configured endpoint."""
        self.assertEqual(get_s3_client().meta.endpoint_url, 'https://account.r2.example.com')

    def test_each_missing_setting_is_refused_and_named(self):
        """Any missing setting raises, and the message says which one."""
        for name in REQUIRED_S3_SETTINGS:
            with self.subTest(missing=name), override_settings(**{name: None}):
                get_s3_client.cache_clear()
                with self.assertRaises(ImproperlyConfigured) as caught:
                    get_s3_client()
                self.assertIn(name, str(caught.exception))

    def test_presigning_surfaces_the_error_rather_than_signing_for_aws(self):
        """The guard fires through the call sites, not just the constructor."""
        with override_settings(AWS_S3_ENDPOINT_URL=None):
            get_s3_client.cache_clear()
            with self.assertRaises(ImproperlyConfigured):
                generate_presigned_put_url('post/audio/1/clip.mp3', 'audio/mpeg')

    def test_django_storage_saves_reach_the_r2_endpoint(self):
        """The happy path builds a session aimed at the configured endpoint."""
        connection = GuardedS3Boto3Storage().connection
        self.assertEqual(
            connection.meta.client.meta.endpoint_url, 'https://account.r2.example.com'
        )

    def test_django_storage_saves_are_refused_when_half_configured(self):
        """Saving media through Django's storage API is guarded too.

        django-storages reads the AWS_* settings itself rather than going
        through get_s3_client, so this path needs its own check — a save is
        what avatars, post media and link-preview images all do.
        """
        for name in REQUIRED_S3_SETTINGS:
            with self.subTest(missing=name), override_settings(**{name: None}):
                storage = GuardedS3Boto3Storage()
                with self.assertRaises(ImproperlyConfigured) as caught:
                    storage.save('avatars/whoever.jpg', ContentFile(b'not really a jpeg'))
                self.assertIn(name, str(caught.exception))

    def test_settings_point_object_storage_at_the_guarded_backend(self):
        """S3 media must not be served by the unguarded upstream backend.

        Asserted against the setting rather than STORAGES['default'], which the
        test runner pins to filesystem storage for the whole suite.
        """
        backend = import_string(django_settings.S3_MEDIA_STORAGE_BACKEND)
        self.assertTrue(issubclass(backend, GuardedS3Boto3Storage))
