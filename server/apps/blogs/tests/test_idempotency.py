"""Tests for idempotent post creation with client UUIDs."""

from datetime import timedelta
from unittest import mock
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Post
from . import ViewTestCase

User = get_user_model()


class PostCreateIdempotencyTests(ViewTestCase):
    """Post creates dedupe only when author and client UUID both match."""

    def setUp(self):
        """Create two authenticated clients and one anonymous client."""
        super().setUp()
        self.user = User.objects.create_user(username='uuid_author', password='testpass123')
        self.other_user = User.objects.create_user(
            username='other_uuid_author', password='testpass123'
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.other_client = APIClient()
        self.other_client.force_authenticate(user=self.other_user)
        self.anon_client = APIClient()

    def test_create_with_client_uuid_stores_private_metadata(self):
        """A fresh UUID create stores the UUID and returns 201 without exposing it."""
        client_uuid = uuid4()

        response = self.client.post(
            reverse('post-list'),
            {'body': 'First try', 'client_uuid': str(client_uuid)},
        )

        self.assertEqual(response.status_code, 201)
        post = Post.objects.get(id=response.data['id'])
        self.assertEqual(post.client_uuid, client_uuid)
        self.assertNotIn('client_uuid', response.data)

    def test_replay_returns_existing_post(self):
        """The same author and UUID return the original post without a second row."""
        client_uuid = str(uuid4())

        first = self.client.post(
            reverse('post-list'), {'body': 'Original', 'client_uuid': client_uuid}
        )
        replay = self.client.post(
            reverse('post-list'), {'body': 'Changed retry body', 'client_uuid': client_uuid}
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data['id'], first.data['id'])
        self.assertEqual(Post.objects.filter(author=self.user).count(), 1)
        self.assertEqual(Post.objects.get(id=first.data['id']).body, 'Original')

    def test_idempotency_check_returns_existing_post_for_same_author(self):
        """Direct-upload clients can dedupe before requesting a presigned URL."""
        client_uuid = uuid4()
        post = Post.objects.create(
            author=self.user, body='Already created', client_uuid=client_uuid
        )

        response = self.client.post(
            reverse('post-idempotency-check'), {'client_uuid': str(client_uuid)}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['id'], post.id)
        self.assertNotIn('client_uuid', response.data)

    def test_idempotency_check_is_scoped_to_current_author(self):
        """A UUID match owned by someone else is indistinguishable from no match."""
        client_uuid = uuid4()
        Post.objects.create(author=self.user, body='Private key', client_uuid=client_uuid)

        response = self.other_client.post(
            reverse('post-idempotency-check'), {'client_uuid': str(client_uuid)}
        )

        self.assertEqual(response.status_code, 204)

    def test_idempotency_check_rejects_invalid_uuid(self):
        """The preflight endpoint rejects malformed lookup keys."""
        response = self.client.post(
            reverse('post-idempotency-check'), {'client_uuid': 'not-a-uuid'}
        )

        self.assertEqual(response.status_code, 400)

    def test_s3_replay_dedupes_before_media_validation(self):
        """A replay wins before an attached S3 key can be rejected as reused."""
        client_uuid = str(uuid4())
        key = f'post/audio/{self.user.id}/queued.mp3'
        payload = {
            'body': 'With media',
            'client_uuid': client_uuid,
            's3_file_key': key,
            'media_type': 'audio',
        }

        with (
            mock.patch(
                'apps.blogs.views.head_object',
                return_value={'ContentLength': 512, 'ContentType': 'audio/mpeg'},
            ) as mock_head,
            mock.patch('apps.blogs.views.download_to_file'),
            mock.patch('apps.blogs.views.probe_media_duration', return_value=timedelta(seconds=5)),
            mock.patch(
                'apps.blogs.serializers.generate_presigned_get_url',
                return_value='https://media.example/queued.mp3',
            ),
        ):
            first = self.client.post(reverse('post-list'), payload)
            replay = self.client.post(reverse('post-list'), payload)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data['id'], first.data['id'])
        self.assertEqual(Post.objects.filter(author=self.user).count(), 1)
        mock_head.assert_called_once_with(key)

    def test_same_uuid_is_scoped_per_author(self):
        """Two authors may use the same UUID without colliding."""
        client_uuid = str(uuid4())

        first = self.client.post(
            reverse('post-list'), {'body': 'First author', 'client_uuid': client_uuid}
        )
        second = self.other_client.post(
            reverse('post-list'), {'body': 'Second author', 'client_uuid': client_uuid}
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.data['id'], second.data['id'])
        self.assertEqual(Post.objects.filter(client_uuid=client_uuid).count(), 2)

    def test_anonymous_replay_dedupes(self):
        """Anonymous retries share the dedicated anonymous author row."""
        client_uuid = str(uuid4())
        payload = {'body': 'Anonymous queue', 'client_uuid': client_uuid}

        first = self.anon_client.post(reverse('post-list'), payload)
        replay = self.anon_client.post(reverse('post-list'), payload)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data['id'], first.data['id'])
        self.assertEqual(Post.objects.filter(client_uuid=client_uuid).count(), 1)

    def test_invalid_client_uuid_is_rejected(self):
        """Malformed UUID strings are rejected by the create serializer."""
        response = self.client.post(
            reverse('post-list'), {'body': 'Invalid', 'client_uuid': 'not-a-uuid'}
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Post.objects.filter(author=self.user).count(), 0)

    def test_missing_client_uuid_does_not_dedupe(self):
        """Ordinary identical creates retain their existing non-idempotent behavior."""
        payload = {'body': 'Same words'}

        first = self.client.post(reverse('post-list'), payload)
        second = self.client.post(reverse('post-list'), payload)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.data['id'], second.data['id'])
        self.assertEqual(Post.objects.filter(author=self.user).count(), 2)
