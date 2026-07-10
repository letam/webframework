"""Tests for post link preview extraction, fetching, API serialization, and images."""

import gzip
import json
import os
import socket
import tempfile
from datetime import date, timedelta
from io import BytesIO, StringIO
from unittest import mock

import httpx
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from ..link_previews import (
    _safe_get,
    detect_kind,
    extract_urls,
    fetch_chatgpt,
    fetch_generic,
    fetch_hackernews,
    fetch_preview_for,
    fetch_reddit,
    fetch_twitter,
    fetch_youtube,
    sync_link_previews,
)
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

    def test_detect_kind_identifies_new_provider_urls_and_excludes_unsupported_urls(self):
        """Provider detection should recognize only supported HN, Reddit, and ChatGPT links."""
        self.assertEqual(
            detect_kind('https://news.ycombinator.com/item?id=123&next=456'),
            ('hackernews', '123'),
        )
        self.assertEqual(detect_kind('https://news.ycombinator.com/newest'), ('generic', ''))
        self.assertEqual(
            detect_kind('https://news.ycombinator.com/user?id=someone'),
            ('generic', ''),
        )

        for hostname in ('reddit.com', 'www.reddit.com', 'old.reddit.com', 'np.reddit.com'):
            with self.subTest(hostname=hostname):
                self.assertEqual(
                    detect_kind(f'https://{hostname}/r/python/comments/abc123/a-post'),
                    ('reddit', ''),
                )
        self.assertEqual(
            detect_kind('https://www.reddit.com/r/python/s/token'),
            ('generic', ''),
        )
        self.assertEqual(detect_kind('https://redd.it/abc'), ('generic', ''))

        share_id = '67681bfe-1234-5678-90ab-cdef12345678'
        for url in (
            f'https://chatgpt.com/share/{share_id}',
            f'https://chatgpt.com/share/e/{share_id}',
            f'https://chat.openai.com/share/{share_id}',
        ):
            with self.subTest(url=url):
                self.assertEqual(detect_kind(url), ('chatgpt', ''))
        self.assertEqual(detect_kind('https://chatgpt.com/g/foo'), ('generic', ''))


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
                'published_at': date(2024, 5, 1),
            },
        ):
            fetch_preview_for(preview)

        preview.refresh_from_db()
        self.assertEqual(preview.status, 'ok')
        self.assertEqual(preview.fetch_attempts, 1)
        self.assertEqual(preview.title, 'Linked story')
        self.assertEqual(preview.description, 'Story description')
        self.assertEqual(preview.site_name, 'Example')
        self.assertEqual(preview.published_at, date(2024, 5, 1))
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
        self.assertEqual(preview.fetch_attempts, 1)
        self.assertIsNotNone(preview.fetched_at)

    def test_fetch_preview_for_dispatches_new_kinds_and_persists_extra(self):
        """New preview kinds should call their fetchers and persist provider metadata."""
        hackernews = LinkPreview.objects.create(
            post=self.post,
            url='https://news.ycombinator.com/item?id=123',
            kind='hackernews',
            embed_id='123',
        )
        reddit = LinkPreview.objects.create(
            post=self.post,
            url='https://www.reddit.com/r/python/comments/abc123/a-post',
            kind='reddit',
        )
        chatgpt = LinkPreview.objects.create(
            post=self.post,
            url='https://chatgpt.com/share/67681bfe-1234-5678-90ab-cdef12345678',
            kind='chatgpt',
        )
        metadata = {
            'title': 'Title',
            'description': '',
            'site_name': 'Source',
            'author_name': '',
            'author_handle': '',
            'embed_id': '',
            'published_at': None,
        }

        with (
            mock.patch(
                'apps.blogs.link_previews.fetch_hackernews',
                return_value={**metadata, 'kind': 'hackernews', 'extra': {'score': 1}},
            ) as mock_hackernews,
            mock.patch(
                'apps.blogs.link_previews.fetch_reddit',
                return_value={**metadata, 'kind': 'reddit', 'extra': {'subreddit': 'python'}},
            ) as mock_reddit,
            mock.patch(
                'apps.blogs.link_previews.fetch_chatgpt',
                return_value={**metadata, 'kind': 'chatgpt', 'extra': {}},
            ) as mock_chatgpt,
        ):
            fetch_preview_for(hackernews)
            fetch_preview_for(reddit)
            fetch_preview_for(chatgpt)

        mock_hackernews.assert_called_once_with(hackernews.url, '123')
        mock_reddit.assert_called_once_with(reddit.url)
        mock_chatgpt.assert_called_once_with(chatgpt.url)
        hackernews.refresh_from_db()
        reddit.refresh_from_db()
        chatgpt.refresh_from_db()
        self.assertEqual(hackernews.extra, {'score': 1})
        self.assertEqual(reddit.extra, {'subreddit': 'python'})
        self.assertEqual(chatgpt.extra, {})

    def test_sync_link_previews_redetects_a_kept_generic_row(self):
        """Editing a post should upgrade kept generic URLs to newly recognized kinds."""
        self.post.body = 'https://www.reddit.com/r/python/comments/abc123/a-post'
        self.post.save(update_fields=['body'])
        preview = LinkPreview.objects.create(
            post=self.post,
            url='https://www.reddit.com/r/python/comments/abc123/a-post',
            kind='generic',
            status='ok',
        )

        self.assertTrue(sync_link_previews(self.post))

        preview.refresh_from_db()
        self.assertEqual(preview.kind, 'reddit')
        self.assertEqual(preview.status, 'pending')

    def test_keep_existing_on_failure_preserves_ok_preview(self):
        """Failed refreshes should preserve stale ok preview data when requested."""
        old_fetched_at = timezone.now() - timedelta(days=2)
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                preview = LinkPreview.objects.create(
                    post=self.post,
                    url='https://example.com/story',
                    kind='generic',
                    status='ok',
                    title='Existing title',
                    description='Existing description',
                    site_name='Existing Site',
                    fetched_at=old_fetched_at,
                )
                preview.image.save('existing.jpg', ContentFile(b'existing image'), save=True)
                old_image_name = preview.image.name
                old_image_path = preview.image.path

                with mock.patch('apps.blogs.link_previews.fetch_generic', return_value=None):
                    fetch_preview_for(preview, keep_existing_on_failure=True)

                preview.refresh_from_db()
                self.assertEqual(preview.status, 'ok')
                self.assertEqual(preview.title, 'Existing title')
                self.assertEqual(preview.description, 'Existing description')
                self.assertEqual(preview.site_name, 'Existing Site')
                self.assertEqual(preview.image.name, old_image_name)
                self.assertTrue(os.path.exists(old_image_path))
                self.assertGreater(preview.fetched_at, old_fetched_at)
                self.assertEqual(preview.fetch_attempts, 1)

    def test_image_replacement_deletes_old_file(self):
        """A successful refetch with a replacement image should remove the old file."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                preview = LinkPreview.objects.create(
                    post=self.post,
                    url='https://example.com/story',
                    kind='generic',
                    status='ok',
                )
                preview.image.save('old.jpg', ContentFile(b'old image'), save=True)
                old_image_path = preview.image.path

                buffer = BytesIO()
                Image.new('RGB', (2, 2), color='blue').save(buffer, format='PNG')
                image_response = httpx.Response(
                    200,
                    headers={'content-type': 'image/png'},
                    content=buffer.getvalue(),
                    request=httpx.Request('GET', 'https://example.com/image.png'),
                )

                with (
                    mock.patch(
                        'apps.blogs.link_previews.fetch_generic',
                        return_value={
                            'title': 'Updated title',
                            'description': '',
                            'site_name': '',
                            'author_name': '',
                            'author_handle': '',
                            'embed_id': '',
                            'image_url': 'https://example.com/image.png',
                        },
                    ),
                    mock.patch('apps.blogs.link_previews._safe_get', return_value=image_response),
                ):
                    fetch_preview_for(preview)

                preview.refresh_from_db()
                new_image_path = preview.image.path

                self.assertFalse(os.path.exists(old_image_path))
                self.assertTrue(os.path.exists(new_image_path))
                self.assertNotEqual(old_image_path, new_image_path)

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


class LinkPreviewDateParsingTests(BaseTestCase):
    """Tests for publication-date extraction in the per-kind fetchers."""

    @staticmethod
    def _response(body: bytes, content_type: str) -> httpx.Response:
        return httpx.Response(
            200,
            headers={'content-type': content_type},
            content=body,
            request=httpx.Request('GET', 'https://example.com/'),
        )

    def test_fetch_twitter_parses_blockquote_date(self):
        """The trailing anchor text in the oEmbed blockquote is the tweet date."""
        oembed = {
            'author_name': 'jack',
            'html': (
                '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">'
                'just setting up my twttr</p>&mdash; jack (@jack) '
                '<a href="https://x.com/jack/status/20?ref_src=twsrc%5Etfw">'
                'March 21, 2006</a></blockquote>'
            ),
        }
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(json.dumps(oembed).encode(), 'application/json'),
        ):
            data = fetch_twitter('https://x.com/jack/status/20', 'jack')

        self.assertIsNotNone(data)
        self.assertEqual(data['description'], 'just setting up my twttr')
        self.assertEqual(data['published_at'], date(2006, 3, 21))

    def test_fetch_twitter_falls_back_to_snowflake_id_date(self):
        """Without a parseable anchor date, the snowflake status ID dates the tweet."""
        oembed = {'author_name': 'user', 'html': '<blockquote><p>hi</p></blockquote>'}
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(json.dumps(oembed).encode(), 'application/json'),
        ):
            data = fetch_twitter('https://x.com/user/status/1585841080431321088', 'user')

        self.assertIsNotNone(data)
        self.assertEqual(data['published_at'], date(2022, 10, 28))

    def test_fetch_twitter_pre_snowflake_id_yields_no_date(self):
        """Sequential pre-2010 status IDs encode no timestamp and must not invent one."""
        oembed = {'author_name': 'jack', 'html': '<blockquote><p>hi</p></blockquote>'}
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(json.dumps(oembed).encode(), 'application/json'),
        ):
            data = fetch_twitter('https://x.com/jack/status/20', 'jack')

        self.assertIsNotNone(data)
        self.assertIsNone(data['published_at'])

    def test_fetch_youtube_parses_date_published_meta(self):
        """The watch page's datePublished itemprop meta should date the video."""
        oembed = {'title': 'Video', 'author_name': 'Channel', 'thumbnail_url': ''}
        page = (
            '<html><head>'
            '<meta itemprop="datePublished" content="2009-10-24T23:57:33-07:00">'
            '<meta property="og:description" content="A classic.">'
            '</head></html>'
        )
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            side_effect=[
                self._response(json.dumps(oembed).encode(), 'application/json'),
                self._response(page.encode(), 'text/html'),
            ],
        ):
            data = fetch_youtube('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ')

        self.assertIsNotNone(data)
        self.assertEqual(data['published_at'], date(2009, 10, 24))

    def test_fetch_youtube_falls_back_to_publish_date_json(self):
        """Without meta tags, the player-response publishDate JSON should be used."""
        oembed = {'title': 'Video', 'author_name': 'Channel', 'thumbnail_url': ''}
        page = '<html><body>"publishDate":"2020-01-15T00:00:00-08:00"</body></html>'
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            side_effect=[
                self._response(json.dumps(oembed).encode(), 'application/json'),
                self._response(page.encode(), 'text/html'),
            ],
        ):
            data = fetch_youtube('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ')

        self.assertIsNotNone(data)
        self.assertEqual(data['published_at'], date(2020, 1, 15))

    def test_fetch_generic_parses_article_published_time(self):
        """OpenGraph article:published_time should date generic pages."""
        page = (
            '<html><head>'
            '<meta property="og:title" content="A story">'
            '<meta property="article:published_time" content="2024-05-01T12:00:00+00:00">'
            '</head></html>'
        )
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(page.encode(), 'text/html'),
        ):
            data = fetch_generic('https://example.com/story')

        self.assertIsNotNone(data)
        self.assertEqual(data['published_at'], date(2024, 5, 1))


class LinkPreviewSourceFetchTests(BaseTestCase):
    """Tests for Hacker News, Reddit, and ChatGPT preview fetchers."""

    @staticmethod
    def _response(body: bytes, content_type: str = 'application/json', status_code: int = 200):
        """Build a canned HTTPX response without making a network request."""
        return httpx.Response(
            status_code,
            headers={'content-type': content_type},
            content=body,
            request=httpx.Request('GET', 'https://example.com/'),
        )

    def test_fetch_hackernews_story_returns_full_metadata(self):
        """A Hacker News story should include its scores, domain, author, and date."""
        item = {
            'type': 'story',
            'title': 'Show HN: A small project',
            'by': 'pg',
            'score': 57,
            'descendants': 3,
            'time': 1160352000,
            'url': 'https://www.example.com/project',
        }
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(json.dumps(item).encode()),
        ) as mock_get:
            data = fetch_hackernews('https://news.ycombinator.com/item?id=123', '123')

        self.assertEqual(
            data,
            {
                'kind': 'hackernews',
                'title': 'Show HN: A small project',
                'description': '',
                'site_name': 'Hacker News',
                'author_name': 'pg',
                'author_handle': '',
                'embed_id': '123',
                'published_at': date(2006, 10, 9),
                'extra': {'score': 57, 'comments': 3, 'domain': 'example.com'},
            },
        )
        mock_get.assert_called_once_with(
            'https://hacker-news.firebaseio.com/v0/item/123.json',
            max_bytes=2_000_000,
        )

    def test_fetch_hackernews_ask_text_strips_html_and_omits_empty_domain(self):
        """Ask HN text should be rendered as clean text without a domain field."""
        item = {
            'type': 'story',
            'title': 'Ask HN: What are you building?',
            'text': '<p>Hello &amp; <i>world</i></p><p>Next<br>line</p>',
            'by': 'asker',
            'score': 0,
            'descendants': 0,
            'time': 1160352000,
        }
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(json.dumps(item).encode()),
        ):
            data = fetch_hackernews('https://news.ycombinator.com/item?id=124', '124')

        self.assertIsNotNone(data)
        self.assertEqual(data['description'], 'Hello & world Next line')
        self.assertEqual(data['extra'], {'score': 0, 'comments': 0})

    def test_fetch_hackernews_missing_timestamp_yields_no_date(self):
        """A story without a time field should have no publication date, not the epoch."""
        item = {'type': 'story', 'title': 'Undated story', 'by': 'pg'}
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(json.dumps(item).encode()),
        ):
            data = fetch_hackernews('https://news.ycombinator.com/item?id=128', '128')

        self.assertIsNotNone(data)
        self.assertIsNone(data['published_at'])

    def test_fetch_hackernews_rejects_missing_deleted_dead_and_unknown_items(self):
        """Unavailable or unsupported Hacker News items should not produce cards."""
        cases = [
            b'null',
            json.dumps({'type': 'story', 'deleted': True}).encode(),
            json.dumps({'type': 'story', 'dead': True}).encode(),
            json.dumps({'type': 'pollopt', 'title': 'Option'}).encode(),
        ]
        for body in cases:
            with self.subTest(body=body):
                with mock.patch(
                    'apps.blogs.link_previews._safe_get',
                    return_value=self._response(body),
                ):
                    self.assertIsNone(
                        fetch_hackernews('https://news.ycombinator.com/item?id=125', '125')
                    )

    def test_fetch_hackernews_comment_walks_to_its_story(self):
        """A Hacker News comment should use its parent story title and comment metadata."""
        comment = {
            'type': 'comment',
            'text': 'An <i>insightful</i> comment',
            'by': 'sama',
            'time': 1160352000,
            'parent': 200,
        }
        story = {'type': 'story', 'title': 'The parent story'}
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            side_effect=[
                self._response(json.dumps(comment).encode()),
                self._response(json.dumps(story).encode()),
            ],
        ):
            data = fetch_hackernews('https://news.ycombinator.com/item?id=126', '126')

        self.assertIsNotNone(data)
        self.assertEqual(data['title'], 'The parent story')
        self.assertEqual(data['description'], 'An insightful comment')
        self.assertEqual(data['extra'], {'is_comment': True})

    def test_fetch_hackernews_comment_parent_walk_is_capped(self):
        """A comment whose story lies beyond eight parents should render without a title."""
        comment = {'type': 'comment', 'text': 'Comment', 'parent': 1}
        parents = [{'type': 'comment', 'parent': parent_id + 1} for parent_id in range(1, 9)]
        responses = [self._response(json.dumps(comment).encode())]
        responses.extend(self._response(json.dumps(parent).encode()) for parent in parents)
        with mock.patch('apps.blogs.link_previews._safe_get', side_effect=responses):
            data = fetch_hackernews('https://news.ycombinator.com/item?id=127', '127')

        self.assertIsNotNone(data)
        self.assertEqual(data['title'], '')

    def test_fetch_reddit_uses_a_canonical_www_oembed_url(self):
        """Reddit oEmbed requests should canonicalize old hostnames and drop URL queries."""
        oembed = {'title': 'A post title', 'author_name': 'ChemicalRascal'}
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(json.dumps(oembed).encode()),
        ) as mock_get:
            data = fetch_reddit(
                'https://old.reddit.com/r/programming/comments/abc123/a-post/?context=3'
            )

        self.assertEqual(
            mock_get.call_args.args[0],
            'https://www.reddit.com/oembed?url='
            'https%3A%2F%2Fwww.reddit.com%2Fr%2Fprogramming%2Fcomments%2Fabc123%2Fa-post%2F',
        )
        self.assertEqual(
            data,
            {
                'kind': 'reddit',
                'title': 'A post title',
                'description': '',
                'site_name': 'Reddit',
                'author_name': 'ChemicalRascal',
                'author_handle': '',
                'embed_id': '',
                'published_at': None,
                'extra': {'subreddit': 'programming'},
            },
        )

    def test_fetch_reddit_rejects_failures_and_missing_titles(self):
        """Reddit failures and oEmbed payloads without titles should not produce cards."""
        for response in (
            None,
            self._response(b'', status_code=400),
            self._response(b'{}'),
        ):
            with self.subTest(response=response):
                with mock.patch('apps.blogs.link_previews._safe_get', return_value=response):
                    self.assertIsNone(
                        fetch_reddit('https://www.reddit.com/r/python/comments/abc123/a-post')
                    )

    def test_fetch_chatgpt_uses_the_first_share_open_graph_title(self):
        """A share page should retain its first prefixed title and UUID-derived date."""
        page = (
            '<meta property="og:title" content="ChatGPT - Planning a project">'
            '<meta property="og:description" content="Marketing copy">'
            '<meta content="https://chatgpt.com" property="og:url">'
        )
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(page.encode(), 'text/html'),
        ):
            data = fetch_chatgpt('https://chatgpt.com/share/67681bfe-1234-5678-90ab-cdef12345678')

        self.assertEqual(
            data,
            {
                'kind': 'chatgpt',
                'title': 'Planning a project',
                'description': '',
                'site_name': 'ChatGPT',
                'author_name': '',
                'author_handle': '',
                'embed_id': '',
                'published_at': date(2024, 12, 22),
                'extra': {},
            },
        )

    def test_fetch_chatgpt_rejects_shells_and_unprefixed_titles(self):
        """Dead shares and app-level titles should fail cleanly without a preview."""
        for page in (
            '<html><head></head></html>',
            '<meta content="ChatGPT" property="og:title">',
        ):
            with self.subTest(page=page):
                with mock.patch(
                    'apps.blogs.link_previews._safe_get',
                    return_value=self._response(page.encode(), 'text/html'),
                ):
                    self.assertIsNone(
                        fetch_chatgpt(
                            'https://chatgpt.com/share/67681bfe-1234-5678-90ab-cdef12345678'
                        )
                    )

    def test_fetch_chatgpt_keeps_a_valid_title_when_uuid_timestamp_is_implausible(self):
        """An implausible UUID timestamp should omit only the derived publication date."""
        page = '<meta property="og:title" content="ChatGPT - Still a valid share">'
        with mock.patch(
            'apps.blogs.link_previews._safe_get',
            return_value=self._response(page.encode(), 'text/html'),
        ):
            data = fetch_chatgpt('https://chatgpt.com/share/00000000-1234-5678-90ab-cdef12345678')

        self.assertIsNotNone(data)
        self.assertIsNone(data['published_at'])


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
                'published_at': date(2009, 10, 24),
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
        self.assertEqual(detail_response.data['link_previews'][0]['published_at'], '2009-10-24')

    def test_create_post_with_no_urls_returns_empty_previews(self):
        """Posts without URLs should serialize an empty preview array."""
        response = self.client.post(reverse('post-list'), {'body': 'No links here'})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['link_previews'], [])
        self.assertEqual(LinkPreview.objects.count(), 0)

    def test_create_post_respects_link_previews_enabled_flag(self):
        """Creating with previews disabled should store the flag and skip preview rows."""
        disabled_response = self.client.post(
            reverse('post-list'),
            {
                'body': 'Skip https://example.com/disabled',
                'link_previews_enabled': 'false',
            },
        )
        default_response = self.client.post(
            reverse('post-list'),
            {'body': 'Default https://example.com/default'},
        )

        self.assertEqual(disabled_response.status_code, 201)
        self.assertFalse(disabled_response.data['link_previews_enabled'])
        self.assertFalse(LinkPreview.objects.filter(post_id=disabled_response.data['id']).exists())
        self.assertEqual(default_response.status_code, 201)
        self.assertTrue(default_response.data['link_previews_enabled'])

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

    def test_link_preview_extra_is_serialized_through_the_post_api(self):
        """Provider-specific preview metadata should be included in successful API cards."""
        post = Post.objects.create(author=self.user, body='Link')
        LinkPreview.objects.create(
            post=post,
            url='https://news.ycombinator.com/item?id=123',
            kind='hackernews',
            status='ok',
            title='A story',
            extra={'score': 57, 'comments': 3, 'domain': 'example.com'},
        )

        response = self.client.get(reverse('post-detail', args=[post.id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data['link_previews'][0]['extra'],
            {'score': 57, 'comments': 3, 'domain': 'example.com'},
        )

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

    def test_patch_link_previews_enabled_false_deletes_rows_and_image_files(self):
        """Disabling previews for an existing post should strip rows and stored images."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                post = Post.objects.create(
                    author=self.user,
                    body='Link https://toggle.example.com',
                )
                preview = LinkPreview.objects.create(
                    post=post,
                    url='https://toggle.example.com',
                    status='ok',
                    title='Toggle',
                )
                preview.image.save('toggle.jpg', ContentFile(b'image bytes'), save=True)
                image_path = preview.image.path

                response = self.client.patch(
                    reverse('post-detail', args=[post.id]),
                    {'link_previews_enabled': 'false'},
                )

                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.data['link_previews_enabled'])
                self.assertEqual(response.data['link_previews'], [])
                self.assertFalse(LinkPreview.objects.filter(post=post).exists())
                self.assertFalse(os.path.exists(image_path))

    def test_patch_link_previews_enabled_true_reextracts_and_enqueues_fetch(self):
        """Re-enabling previews should extract existing URLs and enqueue the fetch task."""
        post = Post.objects.create(
            author=self.user,
            body='Link https://toggle.example.com',
            link_previews_enabled=False,
        )

        with mock.patch('apps.blogs.views._enqueue_fetch_link_previews') as mock_enqueue:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.patch(
                    reverse('post-detail', args=[post.id]),
                    {'link_previews_enabled': 'true'},
                )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['link_previews_enabled'])
        preview = post.link_previews.get()
        self.assertEqual(preview.url, 'https://toggle.example.com')
        self.assertEqual(preview.status, 'pending')
        mock_enqueue.assert_called_once_with(post.pk)

    def test_body_edit_resets_failed_preview_and_refetches_on_commit(self):
        """Editing text while keeping a failed URL should retry it after commit."""
        post = Post.objects.create(author=self.user, body='Old https://retry.example.com')
        preview = LinkPreview.objects.create(
            post=post,
            url='https://retry.example.com',
            status='failed',
            kind='generic',
            fetch_attempts=2,
            fetched_at=timezone.now() - timedelta(hours=2),
        )

        with mock.patch(
            'apps.blogs.link_previews.fetch_generic',
            return_value={
                'title': 'Retried',
                'description': 'Retried description',
                'site_name': 'Retry Site',
                'author_name': '',
                'author_handle': '',
                'embed_id': '',
            },
        ) as mock_fetch:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.patch(
                    reverse('post-detail', args=[post.id]),
                    {'body': 'Edited https://retry.example.com'},
                )

        self.assertEqual(response.status_code, 200)
        mock_fetch.assert_called_once_with('https://retry.example.com')
        preview.refresh_from_db()
        self.assertEqual(preview.status, 'ok')
        self.assertEqual(preview.title, 'Retried')
        self.assertEqual(preview.fetch_attempts, 3)


class RefreshLinkPreviewsCommandTests(BaseTestCase):
    """Tests for the refresh_link_previews management command."""

    def setUp(self):
        """Create reusable posts and timestamps."""
        super().setUp()
        self.user = User.objects.create_user(
            username='refresh_preview_author',
            password='testpass123',
        )
        self.post = Post.objects.create(author=self.user, body='Links')
        self.disabled_post = Post.objects.create(
            author=self.user,
            body='Disabled',
            link_previews_enabled=False,
        )
        self.now = timezone.now()

    def test_command_retries_and_refreshes_only_eligible_rows(self):
        """The command should process eligible failed and stale rows and print a summary."""
        old_time = self.now - timedelta(days=45)
        recent_time = self.now - timedelta(minutes=10)
        eligible_failed = LinkPreview.objects.create(
            post=self.post,
            url='https://failed.example.com',
            status='failed',
            fetch_attempts=1,
            fetched_at=old_time,
        )
        capped_failed = LinkPreview.objects.create(
            post=self.post,
            url='https://capped.example.com',
            status='failed',
            fetch_attempts=4,
            fetched_at=old_time,
        )
        recent_failed = LinkPreview.objects.create(
            post=self.post,
            url='https://recent.example.com',
            status='failed',
            fetch_attempts=1,
            fetched_at=recent_time,
        )
        stale_ok = LinkPreview.objects.create(
            post=self.post,
            url='https://stale.example.com',
            status='ok',
            title='Stale',
            fetch_attempts=1,
            fetched_at=old_time,
        )
        fresh_ok = LinkPreview.objects.create(
            post=self.post,
            url='https://fresh.example.com',
            status='ok',
            title='Fresh',
            fetch_attempts=1,
            fetched_at=self.now,
        )
        disabled_failed = LinkPreview.objects.create(
            post=self.disabled_post,
            url='https://disabled.example.com',
            status='failed',
            fetch_attempts=1,
            fetched_at=old_time,
        )
        output = StringIO()

        def fake_fetch(preview, *, keep_existing_on_failure=False):
            """Mark the preview as fetched without making network requests."""
            preview.fetch_attempts += 1
            preview.fetched_at = timezone.now()
            preview.title = 'Refreshed' if keep_existing_on_failure else 'Retried'
            preview.status = 'ok'
            preview.save(update_fields=['fetch_attempts', 'fetched_at', 'title', 'status'])
            return True

        with mock.patch(
            'apps.blogs.management.commands.refresh_link_previews.fetch_preview_for',
            side_effect=fake_fetch,
        ) as mock_fetch:
            call_command('refresh_link_previews', stdout=output)

        self.assertEqual(
            output.getvalue().strip(),
            'retried 1 (1 now ok), refreshed 1 (1 updated)',
        )
        self.assertEqual(
            [call.args[0].pk for call in mock_fetch.call_args_list],
            [eligible_failed.pk, stale_ok.pk],
        )
        eligible_failed.refresh_from_db()
        capped_failed.refresh_from_db()
        recent_failed.refresh_from_db()
        stale_ok.refresh_from_db()
        fresh_ok.refresh_from_db()
        disabled_failed.refresh_from_db()

        self.assertEqual(eligible_failed.status, 'ok')
        self.assertEqual(eligible_failed.fetch_attempts, 2)
        self.assertEqual(capped_failed.status, 'failed')
        self.assertEqual(capped_failed.fetch_attempts, 4)
        self.assertEqual(recent_failed.status, 'failed')
        self.assertEqual(recent_failed.fetch_attempts, 1)
        self.assertEqual(stale_ok.title, 'Refreshed')
        self.assertEqual(stale_ok.fetch_attempts, 2)
        self.assertEqual(fresh_ok.title, 'Fresh')
        self.assertEqual(fresh_ok.fetch_attempts, 1)
        self.assertEqual(disabled_failed.status, 'failed')
        self.assertEqual(disabled_failed.fetch_attempts, 1)

    def test_command_summary_does_not_count_kept_on_failure_as_updated(self):
        """A stale row whose source is gone stays ok but must not count as updated."""
        LinkPreview.objects.create(
            post=self.post,
            url='https://stale.example.com',
            status='ok',
            title='Stale',
            fetch_attempts=1,
            fetched_at=self.now - timedelta(days=45),
        )
        output = StringIO()

        def fake_fetch(preview, *, keep_existing_on_failure=False):
            """Simulate a dead source: keep existing data, report nothing applied."""
            preview.fetch_attempts += 1
            preview.fetched_at = timezone.now()
            preview.save(update_fields=['fetch_attempts', 'fetched_at'])
            return False

        with mock.patch(
            'apps.blogs.management.commands.refresh_link_previews.fetch_preview_for',
            side_effect=fake_fetch,
        ):
            call_command('refresh_link_previews', stdout=output)

        self.assertEqual(
            output.getvalue().strip(),
            'retried 0 (0 now ok), refreshed 1 (0 updated)',
        )


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
