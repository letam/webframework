"""Tests for post privacy, share links, and drafts."""

# pyright: reportAttributeAccessIssue=false, reportOptionalMemberAccess=false

import tempfile
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from ..models import VISIBILITY_PRIVATE, VISIBILITY_UNLISTED, Comment, Like, Media, Post
from . import ViewTestCase

User = get_user_model()


class PostPrivacyTests(ViewTestCase):
    """End-to-end coverage for post privacy and drafts."""

    def setUp(self):
        """Create users, clients, and representative posts."""
        super().setUp()
        self.author = User.objects.create_user(username='author', password='testpass123')
        self.other = User.objects.create_user(username='other', password='testpass123')
        self.superuser = User.objects.create_superuser(
            username='super', password='testpass123', email='super@example.com'
        )

        self.public = Post.objects.create(author=self.author, head='Public')
        self.unlisted = Post.objects.create(
            author=self.author, head='Unlisted', visibility=VISIBILITY_UNLISTED
        )
        self.private = Post.objects.create(
            author=self.author, head='Private', visibility=VISIBILITY_PRIVATE
        )
        self.draft = Post.objects.create(author=self.author, head='Draft', is_draft=True)

        self.anon_client = APIClient()
        self.author_client = APIClient()
        self.author_client.force_authenticate(user=self.author)
        self.other_client = APIClient()
        self.other_client.force_authenticate(user=self.other)
        self.super_client = APIClient()
        self.super_client.force_authenticate(user=self.superuser)

    def _feed_ids(self, client, params=None):
        response = client.get(reverse('post-list'), params or {})
        self.assertEqual(response.status_code, 200)
        return {post['id'] for post in response.data['results']}

    def _detail(self, client, post, token=None):
        params = {'token': token} if token is not None else None
        return client.get(reverse('post-detail', args=[post.id]), params)

    def test_feed_visibility_matrix(self):
        """Feeds show public plus own published posts, never drafts."""
        self.assertEqual(self._feed_ids(self.anon_client), {self.public.id})
        self.assertEqual(self._feed_ids(self.other_client), {self.public.id})
        self.assertEqual(
            self._feed_ids(self.author_client),
            {self.public.id, self.unlisted.id, self.private.id},
        )
        self.assertEqual(self._feed_ids(self.super_client), {self.public.id})

        self.assertEqual(self._feed_ids(self.anon_client, {'drafts': 'true'}), set())
        self.assertEqual(self._feed_ids(self.author_client, {'drafts': 'true'}), {self.draft.id})
        self.assertEqual(self._feed_ids(self.super_client, {'drafts': 'true'}), set())

    def test_detail_token_visibility(self):
        """Detail routes require valid tokens for unlisted posts and never expose drafts."""
        self.assertEqual(self._detail(self.other_client, self.public).status_code, 200)
        self.assertEqual(self._detail(self.other_client, self.unlisted).status_code, 404)
        self.assertEqual(
            self._detail(self.other_client, self.unlisted, token='wrong').status_code, 404
        )
        self.assertEqual(
            self._detail(
                self.other_client, self.unlisted, token=self.unlisted.share_token
            ).status_code,
            200,
        )
        self.assertEqual(
            self._detail(self.other_client, self.draft, token=self.draft.share_token).status_code,
            404,
        )
        self.assertEqual(self._detail(self.super_client, self.private).status_code, 200)
        self.assertEqual(self._detail(self.super_client, self.draft).status_code, 200)

    def test_media_stream_and_mime_type_are_gated(self):
        """Media endpoints use the same token visibility check as detail routes."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=SimpleUploadedFile('clip.txt', b'hello media', content_type='text/plain'),
                    media_type='audio',
                )
                post = Post.objects.create(
                    author=self.author,
                    head='Media',
                    media=media,
                    visibility=VISIBILITY_UNLISTED,
                )

                stream_url = reverse('stream_post_media', args=[post.id])
                mime_url = reverse('get_post_media_mime_type', args=[post.id])

                self.assertEqual(self.other_client.get(stream_url).status_code, 404)
                self.assertEqual(self.other_client.get(mime_url).status_code, 404)

                stream_response = self.other_client.get(stream_url, {'token': post.share_token})
                mime_response = self.other_client.get(mime_url, {'token': post.share_token})
                stream_content = b''.join(stream_response.streaming_content)

        self.assertEqual(stream_response.status_code, 200)
        self.assertEqual(stream_content, b'hello media')
        self.assertEqual(mime_response.status_code, 200)
        self.assertTrue(mime_response.content)

    def test_plain_post_detail_gating_json_and_noindex(self):
        """The plain post page and JSON branch hide invisible posts and noindex non-public ones."""
        url = reverse('post_detail', args=[self.unlisted.id])

        self.assertEqual(self.other_client.get(url).status_code, 404)
        self.assertEqual(
            self.other_client.get(url, HTTP_ACCEPT='application/json').status_code,
            404,
        )

        html_response = self.other_client.get(url, {'token': self.unlisted.share_token})
        json_response = self.other_client.get(
            url,
            {'token': self.unlisted.share_token},
            HTTP_ACCEPT='application/json',
        )

        self.assertEqual(html_response.status_code, 200)
        self.assertContains(html_response, '<meta name="robots" content="noindex">')
        self.assertEqual(json_response.status_code, 200)
        self.assertEqual(json_response.json()['id'], self.unlisted.id)

        public_response = self.anon_client.get(reverse('post_detail', args=[self.public.id]))
        self.assertEqual(public_response.status_code, 200)
        self.assertNotContains(public_response, 'name="robots" content="noindex"')

    def test_stats_are_scoped_to_visible_published_posts(self):
        """Profile stats count only posts visible to the requester."""
        for post in (self.public, self.unlisted, self.private, self.draft):
            Like.objects.create(user=self.other, post=post)

        anon_response = self.anon_client.get(reverse('post-stats'), {'author': self.author.id})
        author_response = self.author_client.get(reverse('post-stats'), {'author': self.author.id})
        super_response = self.super_client.get(reverse('post-stats'), {'author': self.author.id})

        self.assertEqual(anon_response.data, {'post_count': 1, 'likes_received': 1})
        self.assertEqual(author_response.data, {'post_count': 3, 'likes_received': 3})
        self.assertEqual(super_response.data, {'post_count': 1, 'likes_received': 1})

    def test_share_token_serialization_is_author_only(self):
        """Authors and superusers see share tokens; other visible readers get null."""
        author_response = self._detail(self.author_client, self.unlisted)
        other_response = self._detail(
            self.other_client, self.unlisted, token=self.unlisted.share_token
        )
        super_response = self._detail(self.super_client, self.unlisted)

        self.assertEqual(author_response.data['share_token'], self.unlisted.share_token)
        self.assertIsNone(other_response.data['share_token'])
        self.assertEqual(super_response.data['share_token'], self.unlisted.share_token)

    def test_anonymous_create_restrictions(self):
        """Anonymous users can create only public published posts."""
        public_response = self.anon_client.post(reverse('post-list'), {'body': 'public'})
        private_response = self.anon_client.post(
            reverse('post-list'), {'body': 'private', 'visibility': VISIBILITY_PRIVATE}
        )
        draft_response = self.anon_client.post(
            reverse('post-list'), {'body': 'draft', 'is_draft': 'true'}
        )

        self.assertEqual(public_response.status_code, 201)
        self.assertEqual(private_response.status_code, 401)
        self.assertEqual(draft_response.status_code, 401)

    def test_publish_flips_state_bumps_created_and_is_idempotent(self):
        """Publishing drafts moves them into published feeds and can be repeated."""
        old_created = timezone.now() - timedelta(days=2)
        Post.objects.filter(id=self.draft.id).update(created=old_created)
        self.draft.refresh_from_db()

        response = self.author_client.post(reverse('post-publish', args=[self.draft.id]))
        self.assertEqual(response.status_code, 200)
        self.draft.refresh_from_db()
        self.assertFalse(self.draft.is_draft)
        self.assertGreater(self.draft.created, old_created)
        self.assertEqual(response.data['is_draft'], False)

        created_after_publish = self.draft.created
        second_response = self.author_client.post(reverse('post-publish', args=[self.draft.id]))
        self.draft.refresh_from_db()
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(self.draft.created, created_after_publish)

        public_other_response = self.other_client.post(
            reverse('post-publish', args=[self.public.id])
        )
        self.assertEqual(public_other_response.status_code, 403)

        hidden_draft = Post.objects.create(author=self.author, head='Hidden draft', is_draft=True)
        self.assertEqual(
            self.other_client.post(reverse('post-publish', args=[hidden_draft.id])).status_code,
            404,
        )

    def test_share_token_regeneration_rotates_and_invalidates_old_links(self):
        """Rotating a token returns the new token and makes the old link fail."""
        old_token = self.unlisted.share_token

        response = self.author_client.post(
            reverse('post-regenerate-share-token', args=[self.unlisted.id])
        )
        self.assertEqual(response.status_code, 200)
        self.unlisted.refresh_from_db()
        self.assertNotEqual(self.unlisted.share_token, old_token)
        self.assertEqual(response.data['share_token'], self.unlisted.share_token)

        self.assertEqual(
            self._detail(self.other_client, self.unlisted, token=old_token).status_code,
            404,
        )
        self.assertEqual(
            self._detail(
                self.other_client, self.unlisted, token=self.unlisted.share_token
            ).status_code,
            200,
        )

        self.assertEqual(
            self.other_client.post(
                reverse('post-regenerate-share-token', args=[self.unlisted.id]),
                {'token': self.unlisted.share_token},
            ).status_code,
            404,
        )
        self.assertEqual(
            self.other_client.post(
                f"{reverse('post-regenerate-share-token', args=[self.unlisted.id])}"
                f"?token={self.unlisted.share_token}"
            ).status_code,
            403,
        )

    def test_patch_visibility(self):
        """Authors can change visibility via PATCH and the new scope is enforced."""
        response = self.author_client.patch(
            reverse('post-detail', args=[self.public.id]),
            {'visibility': VISIBILITY_PRIVATE},
        )
        self.assertEqual(response.status_code, 200)
        self.public.refresh_from_db()
        self.assertEqual(self.public.visibility, VISIBILITY_PRIVATE)
        self.assertEqual(self._detail(self.other_client, self.public).status_code, 404)

    def test_liked_feed_and_comments_compose_with_visibility(self):
        """Liked filters and comment routes keep applying post visibility."""
        Like.objects.create(user=self.other, post=self.public)
        Like.objects.create(user=self.other, post=self.unlisted)
        Like.objects.create(user=self.other, post=self.private)

        self.assertEqual(
            self._feed_ids(self.other_client, {'liked': 'true'}),
            {self.public.id},
        )

        self.assertEqual(
            self.other_client.get(reverse('post-comments', args=[self.unlisted.id])).status_code,
            404,
        )
        token_response = self.other_client.post(
            f"{reverse('post-comments', args=[self.unlisted.id])}"
            f"?token={self.unlisted.share_token}",
            {'body': 'I have the link'},
        )
        self.assertEqual(token_response.status_code, 201)
        self.assertEqual(
            self.other_client.get(
                f"{reverse('post-comments', args=[self.unlisted.id])}"
                f"?token={self.unlisted.share_token}"
            ).status_code,
            200,
        )
        self.assertEqual(
            self.other_client.get(reverse('post-comments', args=[self.private.id])).status_code,
            404,
        )

    def test_post_set_contains_only_visible_child_ids(self):
        """Serialized child ids do not leak private or draft descendants."""
        visible_child = Post.objects.create(author=self.author, head='Child', parent=self.public)
        Post.objects.create(
            author=self.author,
            head='Private child',
            parent=self.public,
            visibility=VISIBILITY_PRIVATE,
        )
        Post.objects.create(
            author=self.author, head='Draft child', parent=self.public, is_draft=True
        )
        Comment.objects.create(author=self.other, post=visible_child, body='Visible comment')

        response = self.anon_client.get(reverse('post-detail', args=[self.public.id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['post_set'], [visible_child.id])
