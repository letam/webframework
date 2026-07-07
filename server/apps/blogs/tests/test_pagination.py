"""Tests for post cursor pagination and feed filters."""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Like, Post
from . import ViewTestCase

User = get_user_model()


class PostPaginationTests(ViewTestCase):
    """Tests for paginated post list responses."""

    def setUp(self):
        """Create users and an API client."""
        super().setUp()
        self.client = APIClient()
        self.user = User.objects.create_user(username='author', password='testpass123')
        self.other_user = User.objects.create_user(username='other_author', password='testpass123')

    def _create_posts(self, count, author=None):
        author = author or self.user
        return [
            Post.objects.create(author=author, head=f'Post {index}', body=f'Body {index}')
            for index in range(count)
        ]

    def test_default_cursor_pagination_returns_twenty_then_remaining_five(self):
        """The default page size should return 20 posts then the remaining 5."""
        self._create_posts(25)

        response = self.client.get(reverse('post-list'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 20)
        self.assertIsNotNone(response.data['next'])

        expected_ids = list(Post.objects.order_by('-created', '-id').values_list('id', flat=True))
        page_one_ids = [post['id'] for post in response.data['results']]
        self.assertEqual(page_one_ids, expected_ids[:20])

        response = self.client.get(response.data['next'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 5)
        self.assertIsNone(response.data['next'])
        self.assertEqual([post['id'] for post in response.data['results']], expected_ids[20:])

    def test_page_size_is_respected_and_capped(self):
        """The page_size query param should work up to the configured cap."""
        self._create_posts(60)

        response = self.client.get(reverse('post-list'), {'page_size': 5})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 5)

        response = self.client.get(reverse('post-list'), {'page_size': 500})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 50)

    def test_author_filter_rejects_non_integer_values(self):
        """A malformed author filter should 400 rather than serve the whole feed."""
        self._create_posts(2)

        response = self.client.get(reverse('post-list'), {'author': 'abc'})
        self.assertEqual(response.status_code, 400)

    def test_author_filter_returns_only_that_authors_posts(self):
        """The author query param should restrict the feed by author id."""
        self._create_posts(3, author=self.user)
        self._create_posts(2, author=self.other_user)

        response = self.client.get(reverse('post-list'), {'author': self.other_user.id})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 2)
        self.assertEqual(
            {post['author']['id'] for post in response.data['results']}, {self.other_user.id}
        )

    def test_liked_filter_returns_liked_posts_for_authenticated_user(self):
        """Authenticated liked=true requests should return posts liked by that user."""
        posts = self._create_posts(3, author=self.other_user)
        Like.objects.create(user=self.user, post=posts[0])
        Like.objects.create(user=self.user, post=posts[2])
        self.client.force_authenticate(user=self.user)

        response = self.client.get(reverse('post-list'), {'liked': 'true'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {post['id'] for post in response.data['results']}, {posts[0].id, posts[2].id}
        )

    def test_cursor_pagination_is_stable_when_created_timestamps_collide(self):
        """Posts sharing a created timestamp must not be skipped or duplicated.

        The -id secondary ordering is what keeps cursors stable for
        bulk-inserted rows; without it this walk drops or repeats posts.
        """
        posts = self._create_posts(25)
        shared_created = posts[0].created
        Post.objects.update(created=shared_created)

        seen_ids = []
        url = reverse('post-list')
        while url:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            seen_ids.extend(post['id'] for post in response.data['results'])
            url = response.data['next']

        expected_ids = sorted((post.id for post in posts), reverse=True)
        self.assertEqual(seen_ids, expected_ids)

    def test_liked_filter_returns_empty_results_for_anonymous_user(self):
        """Anonymous liked=true requests should return an empty page."""
        posts = self._create_posts(1, author=self.other_user)
        Like.objects.create(user=self.user, post=posts[0])

        response = self.client.get(reverse('post-list'), {'liked': 'true'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'], [])
