"""Tests for server-side post view counting."""

# pyright: reportAttributeAccessIssue=false

from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import VISIBILITY_PRIVATE, VISIBILITY_UNLISTED, Post, PostView
from . import ViewTestCase

User = get_user_model()


class PostViewCountTests(ViewTestCase):
    """End-to-end coverage for unique post view counts."""

    def setUp(self):
        """Create users, clients, and posts for view-count tests."""
        super().setUp()
        self.author = User.objects.create_user(username='author', password='testpass123')
        self.viewer = User.objects.create_user(username='viewer', password='testpass123')
        self.other_viewer = User.objects.create_user(username='other', password='testpass123')

        self.public = Post.objects.create(author=self.author, head='Public')
        self.unlisted = Post.objects.create(
            author=self.author,
            head='Unlisted',
            visibility=VISIBILITY_UNLISTED,
        )
        self.private = Post.objects.create(
            author=self.author,
            head='Private',
            visibility=VISIBILITY_PRIVATE,
        )
        self.draft = Post.objects.create(author=self.author, head='Draft', is_draft=True)

        self.view_url = reverse('post-views')
        self.anon_client = APIClient()
        self.author_client = APIClient()
        self.author_client.force_authenticate(user=self.author)
        self.viewer_client = APIClient()
        self.viewer_client.force_authenticate(user=self.viewer)
        self.other_client = APIClient()
        self.other_client.force_authenticate(user=self.other_viewer)

    def _record_views(self, client, post_ids):
        response = client.post(self.view_url, {'post_ids': post_ids}, format='json')
        self.assertEqual(response.status_code, 204)
        return response

    def test_same_authenticated_viewer_counts_once(self):
        """Repeated views from the same user dedupe through the unique constraint."""
        self._record_views(self.viewer_client, [self.public.id])
        self._record_views(self.viewer_client, [self.public.id])

        self.assertEqual(PostView.objects.filter(post=self.public).count(), 1)
        self.assertEqual(
            PostView.objects.get(post=self.public).viewer_key,
            f'u:{self.viewer.id}',
        )

    def test_separate_viewers_accumulate(self):
        """Different viewer identities each add one view."""
        self._record_views(self.viewer_client, [self.public.id])
        self._record_views(self.other_client, [self.public.id])

        self.assertEqual(PostView.objects.filter(post=self.public).count(), 2)

    def test_author_views_are_ignored(self):
        """Authors never count as viewers of their own posts."""
        self._record_views(self.author_client, [self.public.id])

        self.assertEqual(PostView.objects.count(), 0)

    def test_anonymous_session_viewer_counts_once_and_is_hashed(self):
        """Anonymous views dedupe by a SECRET_KEY-hashed session key."""
        self._record_views(self.anon_client, [self.public.id])
        self._record_views(self.anon_client, [self.public.id])

        view = PostView.objects.get(post=self.public)
        session_key = self.anon_client.cookies[settings.SESSION_COOKIE_NAME].value
        self.assertEqual(PostView.objects.filter(post=self.public).count(), 1)
        self.assertTrue(view.viewer_key.startswith('s:'))
        self.assertEqual(len(view.viewer_key), 42)
        self.assertNotIn(session_key, view.viewer_key)

    def test_invisible_and_draft_ids_are_silently_skipped(self):
        """The endpoint records only published posts visible to the requester."""
        self._record_views(self.viewer_client, [self.unlisted.id, self.private.id, self.draft.id])

        self.assertEqual(PostView.objects.count(), 0)

    def test_payload_validation_rejects_too_many_or_malformed_ids(self):
        """The views endpoint accepts only up to 50 integer post ids."""
        too_many_response = self.viewer_client.post(
            self.view_url,
            {'post_ids': list(range(51))},
            format='json',
        )
        self.assertEqual(too_many_response.status_code, 400)

        invalid_payloads = (
            {},
            {'post_ids': '1'},
            {'post_ids': [self.public.id, '2']},
            {'post_ids': [True]},
        )
        for payload in invalid_payloads:
            response = self.viewer_client.post(self.view_url, payload, format='json')
            self.assertEqual(response.status_code, 400)

    def test_view_count_is_serialized_in_feed_and_detail(self):
        """Feed and detail serializers expose annotated view counts."""
        PostView.objects.create(post=self.public, viewer_key='u:100')
        PostView.objects.create(post=self.public, viewer_key='u:101')

        feed_response = self.anon_client.get(reverse('post-list'))
        detail_response = self.anon_client.get(reverse('post-detail', args=[self.public.id]))

        self.assertEqual(feed_response.status_code, 200)
        feed_post = next(
            post for post in feed_response.data['results'] if post['id'] == self.public.id
        )
        self.assertEqual(feed_post['view_count'], 2)
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.data['view_count'], 2)

    def test_detail_html_records_non_author_view(self):
        """Rendering the share HTML page records a non-author view once."""
        response = self.viewer_client.get(reverse('post_detail', args=[self.public.id]))
        second_response = self.viewer_client.get(reverse('post_detail', args=[self.public.id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(PostView.objects.filter(post=self.public).count(), 1)
        self.assertContains(response, '<strong>1</strong> view')
