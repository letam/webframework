"""Tests for post link preview extraction, fetching, API serialization, and images."""

import gzip
import os
import socket
import tempfile
from io import BytesIO
from unittest import mock

import httpx
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from ..link_previews import _safe_get, detect_kind, extract_urls, fetch_preview_for
from ..models import VISIBILITY_PRIVATE, LinkPreview, Post
from ..tasks import fetch_link_previews
from . import BaseTestCase, ViewTestCase

User = get_user_model()


class LinkPreviewExtractionTests(BaseTestCase):
    """Tests for URL extraction and provider detection."""

    def test_extract_urls_dedupes_orders_caps_strips_and_normalizes(self):
        """URL extraction should match URLs from head/body text in first-seen order."""
        text = (
            'Head https://one.example/a.\n'
            'Body www.two.example/path), https://one.example/a '
            'https://three.example/c; https://four.example/d'
        )

        self.assertEqual(
            extract_urls(text),
            [
                'https://one.example/a',
                'https://www.two.example/path',
                'https://three.example/c',
            ],
        )

    def test_detect_kind_identifies_youtube_twitter_and_generic_urls(self):
        """Provider detection should return the kind and provider identifier."""
        youtube_cases = [
            ('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1', 'dQw4w9WgXcQ'),
            ('https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'),
            ('https://youtube.com/shorts/abcDEF_1234', 'abcDEF_1234'),
            ('https://m.youtube.com/live/abcDEF_1234', 'abcDEF_1234'),
            ('https://music.youtube.com/embed/abcDEF_1234', 'abcDEF_1234'),
        ]
        for url, video_id in youtube_cases:
            with self.subTest(url=url):
                self.assertEqual(detect_kind(url), ('youtube', video_id))

        self.assertEqual(
            detect_kind('https://x.com/somebody/status/12345'),
            ('twitter', 'somebody'),
        )
        self.assertEqual(
            detect_kind('https://twitter.com/another/status/67890'),
            ('twitter', 'another'),
        )
        self.assertEqual(detect_kind('https://example.com/story'), ('generic', ''))


class LinkPreviewSsrfTests(BaseTestCase):
    """Tests for the SSRF guard around outbound fetches."""

    class FakeStream:
        """Context manager returning a tiny successful HTTPX response."""

        def __init__(self, url):
            """Store a canned response for the URL."""
            self.response = httpx.Response(
                200,
                headers={'content-type': 'text/html'},
                content=b'ok',
                request=httpx.Request('GET', url),
            )

        def __enter__(self):
            """Enter the fake context."""
            return self.response

        def __exit__(self, exc_type, exc, traceback):
            """Exit without suppressing exceptions."""
            return False

    class FakeClient:
        """Minimal stand-in for httpx.Client."""

        def __init__(self):
            """Initialize call tracking."""
            self.stream_calls = []

        def __enter__(self):
            """Enter the fake context."""
            return self

        def __exit__(self, exc_type, exc, traceback):
            """Exit without suppressing exceptions."""
            return False

        def stream(self, method, url):
            """Record the call and return a fake stream."""
            self.stream_calls.append((method, url))
            return LinkPreviewSsrfTests.FakeStream(url)

    def test_safe_get_refuses_local_and_invalid_targets(self):
        """Unsafe schemes, literals, and local hostnames should never be requested."""
        for url in [
            'http://localhost/metadata',
            'http://127.0.0.1/metadata',
            'http://169.254.169.254/latest',
            'ftp://example.com/file',
        ]:
            with self.subTest(url=url):
                self.assertIsNone(_safe_get(url, max_bytes=16))

    def test_safe_get_refuses_hostname_resolving_to_private_address(self):
        """Any private resolved address should stop the fetch."""
        fake_client = self.FakeClient()
        with (
            mock.patch(
                'apps.blogs.link_previews.socket.getaddrinfo',
                return_value=[
                    (
                        socket.AF_INET,
                        socket.SOCK_STREAM,
                        6,
                        '',
                        ('10.0.0.5', 443),
                    )
                ],
            ),
            mock.patch('apps.blogs.link_previews.httpx.Client', return_value=fake_client),
        ):
            self.assertIsNone(_safe_get('https://example.com/', max_bytes=16))

        self.assertEqual(fake_client.stream_calls, [])

    def test_safe_get_allows_public_resolution_and_reads_response(self):
        """A public resolved address should pass the gate and call the HTTP client."""
        fake_client = self.FakeClient()
        with (
            mock.patch(
                'apps.blogs.link_previews.socket.getaddrinfo',
                return_value=[
                    (
                        socket.AF_INET,
                        socket.SOCK_STREAM,
                        6,
                        '',
                        ('93.184.216.34', 443),
                    )
                ],
            ),
            mock.patch('apps.blogs.link_previews.httpx.Client', return_value=fake_client),
        ):
            response = _safe_get('https://example.com/', max_bytes=16)

        self.assertIsNotNone(response)
        self.assertEqual(response.content, b'ok')
        self.assertEqual(fake_client.stream_calls, [('GET', 'https://example.com/')])

    def test_safe_get_does_not_double_decode_gzip_responses(self):
        """Streamed bodies are already decompressed; rebuilding must not decode again."""

        class GzipStream:
            """Context manager returning a gzip-encoded streaming response."""

            def __enter__(self):
                """Enter the fake context."""
                return httpx.Response(
                    200,
                    headers={'content-type': 'text/html', 'content-encoding': 'gzip'},
                    stream=httpx.ByteStream(gzip.compress(b'<html>ok</html>')),
                    request=httpx.Request('GET', 'https://example.com/'),
                )

            def __exit__(self, exc_type, exc, traceback):
                """Exit without suppressing exceptions."""
                return False

        fake_client = self.FakeClient()
        fake_client.stream = lambda method, url: GzipStream()
        with (
            mock.patch(
                'apps.blogs.link_previews.socket.getaddrinfo',
                return_value=[
                    (
                        socket.AF_INET,
                        socket.SOCK_STREAM,
                        6,
                        '',
                        ('93.184.216.34', 443),
                    )
                ],
            ),
            mock.patch('apps.blogs.link_previews.httpx.Client', return_value=fake_client),
        ):
            response = _safe_get('https://example.com/', max_bytes=1024)

        self.assertIsNotNone(response)
        self.assertEqual(response.content, b'<html>ok</html>')
        self.assertNotIn('content-encoding', response.headers)


class LinkPreviewFetchTests(BaseTestCase):
    """Tests for preview fetch orchestration and task error handling."""

    def setUp(self):
        """Create a user and post for preview rows."""
        super().setUp()
        self.user = User.objects.create_user(username='preview_author', password='testpass123')
        self.post = Post.objects.create(author=self.user, body='https://example.com/story')

    def test_fetch_preview_for_populates_ok_metadata(self):
        """A successful fetcher response should populate fields and mark the row ok."""
        preview = LinkPreview.objects.create(
            post=self.post,
            url='https://example.com/story',
            kind='generic',
        )

        with mock.patch(
            'apps.blogs.link_previews.fetch_generic',
            return_value={
                'title': 'Linked story',
                'description': 'Story description',
                'site_name': 'Example',
                'author_name': '',
                'author_handle': '',
                'embed_id': '',
            },
        ):
            fetch_preview_for(preview)

        preview.refresh_from_db()
        self.assertEqual(preview.status, 'ok')
        self.assertEqual(preview.title, 'Linked story')
        self.assertEqual(preview.description, 'Story description')
        self.assertEqual(preview.site_name, 'Example')
        self.assertIsNotNone(preview.fetched_at)

    def test_fetch_preview_for_marks_failed_when_fetcher_returns_none(self):
        """A fetcher returning None should mark the preview failed."""
        preview = LinkPreview.objects.create(
            post=self.post,
            url='https://example.com/story',
            kind='generic',
        )

        with mock.patch('apps.blogs.link_previews.fetch_generic', return_value=None):
            fetch_preview_for(preview)

        preview.refresh_from_db()
        self.assertEqual(preview.status, 'failed')
        self.assertIsNotNone(preview.fetched_at)

    def test_task_wrapper_marks_failed_when_fetcher_raises(self):
        """The task should catch unexpected fetch errors and mark the row failed."""
        preview = LinkPreview.objects.create(
            post=self.post,
            url='https://example.com/story',
            kind='generic',
        )

        with mock.patch('apps.blogs.tasks.fetch_preview_for', side_effect=RuntimeError('boom')):
            fetch_link_previews.call(self.post.pk)

        preview.refresh_from_db()
        self.assertEqual(preview.status, 'failed')
        self.assertIsNotNone(preview.fetched_at)


class LinkPreviewApiTests(ViewTestCase):
    """Tests for API creation, update, and serialization behavior."""

    def setUp(self):
        """Create an authenticated client."""
        super().setUp()
        self.client = APIClient()
        self.user = User.objects.create_user(username='api_preview_author', password='testpass123')
        self.client.force_authenticate(user=self.user)

    def test_create_post_with_youtube_url_creates_and_serializes_preview(self):
        """Creating a post with a YouTube URL should fetch and serialize the preview."""
        with mock.patch(
            'apps.blogs.link_previews.fetch_youtube',
            return_value={
                'title': 'Video title',
                'description': 'Video description',
                'site_name': 'YouTube',
                'author_name': 'Channel Name',
                'author_handle': 'channel',
                'embed_id': 'dQw4w9WgXcQ',
            },
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse('post-list'),
                    {'body': 'Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ'},
                )

        self.assertEqual(response.status_code, 201)
        post = Post.objects.get(id=response.data['id'])
        preview = post.link_previews.get()
        self.assertEqual(preview.kind, 'youtube')
        self.assertEqual(preview.status, 'ok')

        detail_response = self.client.get(reverse('post-detail', args=[post.id]))
        self.assertEqual(detail_response.data['link_previews'][0]['title'], 'Video title')
        self.assertEqual(detail_response.data['link_previews'][0]['embed_id'], 'dQw4w9WgXcQ')

    def test_create_post_with_no_urls_returns_empty_previews(self):
        """Posts without URLs should serialize an empty preview array."""
        response = self.client.post(reverse('post-list'), {'body': 'No links here'})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['link_previews'], [])
        self.assertEqual(LinkPreview.objects.count(), 0)

    def test_pending_and_failed_previews_are_omitted_from_payload(self):
        """Only ok previews should appear in serialized post payloads."""
        post = Post.objects.create(author=self.user, body='Links')
        LinkPreview.objects.create(
            post=post,
            url='https://ok.example.com',
            status='ok',
            title='OK',
        )
        LinkPreview.objects.create(
            post=post,
            url='https://pending.example.com',
            status='pending',
            title='Pending',
        )
        LinkPreview.objects.create(
            post=post,
            url='https://failed.example.com',
            status='failed',
            title='Failed',
        )

        response = self.client.get(reverse('post-detail', args=[post.id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual([preview['title'] for preview in response.data['link_previews']], ['OK'])

    def test_update_removes_deleted_urls_and_fetches_new_urls(self):
        """Updating post text should delete stale rows and fetch newly added URLs."""
        post = Post.objects.create(author=self.user, body='Old https://old.example.com')
        old_preview = LinkPreview.objects.create(
            post=post,
            url='https://old.example.com',
            status='ok',
            title='Old',
        )

        remove_response = self.client.patch(
            reverse('post-detail', args=[post.id]),
            {'body': 'No links now'},
        )

        self.assertEqual(remove_response.status_code, 200)
        self.assertFalse(LinkPreview.objects.filter(pk=old_preview.pk).exists())
        # The response must reflect the sync, not the stale prefetch cache.
        self.assertEqual(remove_response.data['link_previews'], [])

        with mock.patch(
            'apps.blogs.link_previews.fetch_generic',
            return_value={
                'title': 'New',
                'description': 'New description',
                'site_name': 'New Site',
                'author_name': '',
                'author_handle': '',
                'embed_id': '',
            },
        ):
            with self.captureOnCommitCallbacks(execute=True):
                add_response = self.client.patch(
                    reverse('post-detail', args=[post.id]),
                    {'body': 'New https://new.example.com'},
                )

        self.assertEqual(add_response.status_code, 200)
        new_preview = post.link_previews.get()
        self.assertEqual(new_preview.url, 'https://new.example.com')
        self.assertEqual(new_preview.status, 'ok')

        detail_response = self.client.get(reverse('post-detail', args=[post.id]))
        self.assertEqual(detail_response.data['link_previews'][0]['title'], 'New')


class LinkPreviewImageEndpointTests(ViewTestCase):
    """Tests for protected preview image serving."""

    def setUp(self):
        """Create public/private posts and clients."""
        super().setUp()
        self.user = User.objects.create_user(
            username='image_preview_author',
            password='testpass123',
        )
        self.anon_client = APIClient()

    def _jpeg_bytes(self):
        buffer = BytesIO()
        Image.new('RGB', (1, 1), color='red').save(buffer, format='JPEG')
        return buffer.getvalue()

    def test_image_endpoint_404s_for_missing_or_empty_images(self):
        """Missing rows and rows without images should return 404."""
        post = Post.objects.create(author=self.user, body='Link')
        empty = LinkPreview.objects.create(post=post, url='https://example.com', status='ok')

        self.assertEqual(
            self.anon_client.get(reverse('link-preview-image', args=[9999])).status_code,
            404,
        )
        self.assertEqual(
            self.anon_client.get(reverse('link-preview-image', args=[empty.id])).status_code,
            404,
        )

    def test_image_endpoint_checks_visibility_and_serves_public_bytes(self):
        """Preview images should be gated by post visibility."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                public_post = Post.objects.create(author=self.user, body='Public')
                public_preview = LinkPreview.objects.create(
                    post=public_post,
                    url='https://public.example.com',
                    status='ok',
                )
                public_preview.image.save(
                    'public.jpg',
                    ContentFile(self._jpeg_bytes()),
                    save=True,
                )

                private_post = Post.objects.create(
                    author=self.user,
                    body='Private',
                    visibility=VISIBILITY_PRIVATE,
                )
                private_preview = LinkPreview.objects.create(
                    post=private_post,
                    url='https://private.example.com',
                    status='ok',
                )
                private_preview.image.save(
                    'private.jpg',
                    ContentFile(self._jpeg_bytes()),
                    save=True,
                )

                private_response = self.anon_client.get(
                    reverse('link-preview-image', args=[private_preview.id])
                )
                public_response = self.anon_client.get(
                    reverse('link-preview-image', args=[public_preview.id])
                )
                public_content = b''.join(public_response.streaming_content)

        self.assertEqual(private_response.status_code, 404)
        self.assertEqual(public_response.status_code, 200)
        self.assertEqual(public_response['Cache-Control'], 'private, max-age=86400')
        self.assertGreater(len(public_content), 0)


class LinkPreviewDeletionTests(BaseTestCase):
    """Tests for preview image cleanup on post deletion."""

    def setUp(self):
        """Create a reusable user."""
        super().setUp()
        self.user = User.objects.create_user(
            username='delete_preview_author',
            password='testpass123',
        )

    def test_post_delete_removes_preview_rows_and_image_files(self):
        """Post.delete() should call each preview delete override before cascading."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                post = Post.objects.create(author=self.user, body='Delete')
                preview = LinkPreview.objects.create(
                    post=post,
                    url='https://delete.example.com',
                    status='ok',
                )
                preview.image.save('preview.jpg', ContentFile(b'image bytes'), save=True)
                image_path = preview.image.path
                preview_id = preview.id

                self.assertTrue(os.path.exists(image_path))

                post.delete()

                self.assertFalse(LinkPreview.objects.filter(id=preview_id).exists())
                self.assertFalse(os.path.exists(image_path))
