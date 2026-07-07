"""Tests for likes and comments on posts."""
# pyright: reportAttributeAccessIssue=false, reportOptionalMemberAccess=false

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Comment, Like, Post
from . import ViewTestCase

User = get_user_model()


class LikeTests(ViewTestCase):
    """Tests for the post like/unlike endpoint."""

    def setUp(self):
        """Create two users and a post to like."""
        super().setUp()
        self.user = User.objects.create_user(username='liker', password='testpass123')
        self.other_user = User.objects.create_user(username='other', password='testpass123')
        self.post = Post.objects.create(author=self.other_user, head='Test', body='Body')
        self.client = APIClient()

    def test_like_requires_authentication(self):
        """Unauthenticated like requests should return 401."""
        response = self.client.post(reverse('post-like', args=[self.post.id]))
        self.assertEqual(response.status_code, 401, "Anonymous like should be rejected")
        self.assertEqual(Like.objects.count(), 0, "No like should be created")

    def test_like_and_unlike_post(self):
        """Authenticated users can like and unlike a post."""
        self.client.force_authenticate(user=self.user)

        response = self.client.post(reverse('post-like', args=[self.post.id]))
        self.assertEqual(response.status_code, 200, "Like should succeed")
        self.assertTrue(response.data['liked'], "Response should report liked=True")
        self.assertEqual(response.data['like_count'], 1, "Like count should be 1")

        response = self.client.delete(reverse('post-like', args=[self.post.id]))
        self.assertEqual(response.status_code, 200, "Unlike should succeed")
        self.assertFalse(response.data['liked'], "Response should report liked=False")
        self.assertEqual(response.data['like_count'], 0, "Like count should be 0")

    def test_like_is_idempotent(self):
        """Liking the same post twice should not create duplicate likes."""
        self.client.force_authenticate(user=self.user)
        self.client.post(reverse('post-like', args=[self.post.id]))
        response = self.client.post(reverse('post-like', args=[self.post.id]))
        self.assertEqual(response.status_code, 200, "Second like should not error")
        self.assertEqual(response.data['like_count'], 1, "Like count should stay at 1")
        self.assertEqual(Like.objects.count(), 1, "Only one Like row should exist")

    def test_post_list_includes_like_fields(self):
        """The post list should include like_count, comment_count and liked."""
        Like.objects.create(user=self.user, post=self.post)
        self.client.force_authenticate(user=self.user)

        response = self.client.get(reverse('post-list'))
        self.assertEqual(response.status_code, 200)
        post_data = next(p for p in response.data['results'] if p['id'] == self.post.id)
        self.assertEqual(post_data['like_count'], 1, "like_count should reflect existing likes")
        self.assertTrue(post_data['liked'], "liked should be True for the liking user")
        self.assertEqual(post_data['comment_count'], 0, "comment_count should default to 0")

    def test_post_list_liked_false_for_other_users(self):
        """Liked should be False for users who have not liked the post."""
        Like.objects.create(user=self.user, post=self.post)

        response = self.client.get(reverse('post-list'))  # anonymous
        post_data = next(p for p in response.data['results'] if p['id'] == self.post.id)
        self.assertEqual(post_data['like_count'], 1)
        self.assertFalse(post_data['liked'], "liked should be False for anonymous users")


class CommentTests(ViewTestCase):
    """Tests for the post comments endpoints."""

    def setUp(self):
        """Create users of each role and a post to comment on."""
        super().setUp()
        self.user = User.objects.create_user(username='commenter', password='testpass123')
        self.other_user = User.objects.create_user(username='author', password='testpass123')
        self.superuser = User.objects.create_superuser(
            username='super', password='testpass123', email='super@example.com'
        )
        self.post = Post.objects.create(author=self.other_user, head='Test', body='Body')
        self.client = APIClient()

    def test_list_comments_is_public(self):
        """Anyone can list comments for a post."""
        Comment.objects.create(author=self.user, post=self.post, body='Nice post!')

        response = self.client.get(reverse('post-comments', args=[self.post.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1, "Comment list should have one comment")
        self.assertEqual(response.data[0]['body'], 'Nice post!')
        self.assertEqual(response.data[0]['author']['username'], 'commenter')

    def test_create_comment_requires_authentication(self):
        """Unauthenticated comment creation should return 401."""
        response = self.client.post(reverse('post-comments', args=[self.post.id]), {'body': 'Hi'})
        self.assertEqual(response.status_code, 401, "Anonymous comment should be rejected")
        self.assertEqual(Comment.objects.count(), 0)

    def test_create_comment(self):
        """Authenticated users can comment on a post."""
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse('post-comments', args=[self.post.id]), {'body': 'Great point'}
        )
        self.assertEqual(response.status_code, 201, "Comment creation should return 201")
        self.assertEqual(response.data['body'], 'Great point')
        self.assertEqual(response.data['author']['id'], self.user.id)

        comment = Comment.objects.get(id=response.data['id'])
        self.assertEqual(comment.post_id, self.post.id, "Comment should belong to the post")

    def test_create_comment_rejects_empty_body(self):
        """Comments with an empty body should be rejected."""
        self.client.force_authenticate(user=self.user)
        response = self.client.post(reverse('post-comments', args=[self.post.id]), {'body': ''})
        self.assertEqual(response.status_code, 400, "Empty comment should return 400")

    def test_delete_own_comment(self):
        """A comment author can delete their own comment."""
        comment = Comment.objects.create(author=self.user, post=self.post, body='Mine')
        self.client.force_authenticate(user=self.user)

        response = self.client.delete(
            reverse('post-delete-comment', args=[self.post.id, comment.id])
        )
        self.assertEqual(response.status_code, 204, "Author should be able to delete comment")
        self.assertEqual(Comment.objects.count(), 0)

    def test_delete_other_users_comment_forbidden(self):
        """Users cannot delete comments they did not write."""
        comment = Comment.objects.create(author=self.user, post=self.post, body='Mine')
        self.client.force_authenticate(user=self.other_user)

        response = self.client.delete(
            reverse('post-delete-comment', args=[self.post.id, comment.id])
        )
        self.assertEqual(response.status_code, 403, "Non-author should be forbidden")
        self.assertEqual(Comment.objects.count(), 1, "Comment should not be deleted")

    def test_superuser_can_delete_any_comment(self):
        """Admins can delete any comment."""
        comment = Comment.objects.create(author=self.user, post=self.post, body='Mine')
        self.client.force_authenticate(user=self.superuser)

        response = self.client.delete(
            reverse('post-delete-comment', args=[self.post.id, comment.id])
        )
        self.assertEqual(response.status_code, 204, "Superuser should be able to delete")

    def test_comment_count_in_post_list(self):
        """comment_count should reflect the number of comments."""
        Comment.objects.create(author=self.user, post=self.post, body='One')
        Comment.objects.create(author=self.other_user, post=self.post, body='Two')

        response = self.client.get(reverse('post-list'))
        post_data = next(p for p in response.data['results'] if p['id'] == self.post.id)
        self.assertEqual(post_data['comment_count'], 2)
