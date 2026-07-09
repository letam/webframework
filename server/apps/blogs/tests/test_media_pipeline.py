"""Tests for media upload validation, S3-backed media, and signed URLs."""

import os
import subprocess
import tempfile
from array import array
from datetime import timedelta
from io import BytesIO
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from ..models import Media, Post
from ..serializers import PostSerializer
from ..utils import MediaProbeError
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

    def _png_bytes(self):
        """Return a tiny valid PNG image."""
        return self._image_bytes()

    def _image_bytes(self, width=1, height=1, image_format='PNG'):
        """Return valid image bytes for a generated solid image."""
        buffer = BytesIO()
        Image.new('RGB', (width, height), color='red').save(buffer, format=image_format)
        return buffer.getvalue()

    def _image_file(self, content=None, name='pixel.png', content_type='image/png'):
        """Return a simple uploaded image file."""
        return SimpleUploadedFile(
            name, self._png_bytes() if content is None else content, content_type=content_type
        )

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
            mock.patch('apps.blogs.views.probe_media_duration', return_value=expected_duration),
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
        # The frontend derives MIME type and download extension from the key.
        self.assertEqual(response.data['media']['s3_file_key'], self.key)

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
            mock.patch('apps.blogs.views.probe_media_duration', return_value=None),
            mock.patch('apps.blogs.views.delete_object') as mock_delete,
        ):
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 400)
        mock_delete.assert_called_once_with(self.key)
        self.assertEqual(Post.objects.count(), 0)

    def test_probe_environment_failure_returns_500_and_keeps_object(self):
        """A broken probing environment must not delete the upload or blame the file."""
        head = {'ContentLength': 512, 'ContentType': 'audio/mpeg'}

        with (
            mock.patch('apps.blogs.views.head_object', return_value=head),
            mock.patch('apps.blogs.views.download_to_file'),
            mock.patch(
                'apps.blogs.views.probe_media_duration',
                side_effect=MediaProbeError('ffprobe could not run'),
            ),
            mock.patch('apps.blogs.views.delete_object') as mock_delete,
        ):
            response = self._post_with_s3_key()

        self.assertEqual(response.status_code, 500)
        mock_delete.assert_not_called()
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

    def test_direct_image_upload_rejects_invalid_image_bytes(self):
        """Direct image uploads should reject undecodable image content."""
        response = self.client.post(
            reverse('post-list'),
            {
                'head': 'Bad image',
                'media': self._image_file(content=b'not an image'),
                'media_type': 'image',
            },
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Post.objects.count(), 0)

    def test_direct_image_upload_accepts_valid_image_bytes(self):
        """Direct image uploads should save valid image bytes after validation."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                response = self.client.post(
                    reverse('post-list'),
                    {
                        'head': 'Valid image',
                        'media': self._image_file(),
                        'media_type': 'image',
                    },
                    format='multipart',
                )

                self.assertEqual(response.status_code, 201)
                post = Post.objects.get(id=response.data['id'])
                self.assertIsNotNone(post.media)
                self.assertGreater(post.media.file.size, 0)

    def test_s3_image_upload_rejects_invalid_image_bytes_and_deletes_object(self):
        """S3 image uploads should reject undecodable bytes and delete the object."""
        key = f'post/audio/{self.user.id}/pixel.png'
        head = {'ContentLength': 512, 'ContentType': 'image/png'}

        def fake_download(_key, fileobj):
            fileobj.write(b'not an image')

        with (
            mock.patch('apps.blogs.views.head_object', return_value=head),
            mock.patch('apps.blogs.views.download_to_file', side_effect=fake_download),
            mock.patch('apps.blogs.views.delete_object') as mock_delete,
        ):
            response = self._post_with_s3_key(key=key, media_type='image')

        self.assertEqual(response.status_code, 400)
        mock_delete.assert_called_once_with(key)
        self.assertEqual(Post.objects.count(), 0)

    def test_s3_image_upload_accepts_valid_image_bytes(self):
        """S3 image uploads should save valid images without setting duration."""
        key = f'post/audio/{self.user.id}/pixel.png'
        head = {'ContentLength': 512, 'ContentType': 'image/png'}
        png_bytes = self._png_bytes()

        def fake_download(_key, fileobj):
            fileobj.write(png_bytes)

        with (
            mock.patch('apps.blogs.views.head_object', return_value=head),
            mock.patch('apps.blogs.views.download_to_file', side_effect=fake_download),
            mock.patch(
                'apps.blogs.serializers.generate_presigned_get_url',
                return_value='https://example.com/signed-image',
            ),
        ):
            response = self._post_with_s3_key(key=key, media_type='image')

        self.assertEqual(response.status_code, 201)
        post = Post.objects.get(id=response.data['id'])
        self.assertIsNotNone(post.media)
        self.assertEqual(post.media.s3_file_key, key)
        self.assertIsNone(post.media.duration)

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

    def test_media_serializer_returns_thumbnail_url_and_waveform(self):
        """Media serialization should expose derived media fields."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=self._audio_file(),
                    media_type='audio',
                    waveform=[0, 50, 100],
                )
                media.thumbnail.save(
                    'poster.jpg',
                    SimpleUploadedFile(
                        'poster.jpg',
                        self._image_bytes(image_format='JPEG'),
                        content_type='image/jpeg',
                    ),
                )
                post = Post.objects.create(author=self.user, head='Local media', media=media)
                data = PostSerializer(post).data

        self.assertEqual(data['media']['waveform'], [0, 50, 100])
        self.assertTrue(data['media']['thumbnail'].startswith('/media/post/'))

    def test_process_post_media_routes_by_media_type(self):
        """The media processing task should dispatch to the matching media handler."""
        from ..tasks import process_post_media

        processors = {
            'audio': mock.Mock(),
            'video': mock.Mock(),
            'image': mock.Mock(),
        }

        with mock.patch.dict('apps.blogs.tasks.MEDIA_PROCESSORS', processors, clear=True):
            for media_type, processor in processors.items():
                media = Media.objects.create(media_type=media_type)
                process_post_media.call(media.pk)
                processor.assert_called_once_with(media)

    def test_process_post_media_video_generates_thumbnail(self):
        """Video processing should capture a poster frame into Media.thumbnail."""
        from ..tasks import process_post_media

        with tempfile.TemporaryDirectory() as source_dir:
            video_path = os.path.join(source_dir, 'clip.avi')
            subprocess.run(
                [
                    'ffmpeg',
                    '-y',
                    '-f',
                    'lavfi',
                    '-i',
                    'color=c=red:s=32x32:r=1:d=1',
                    '-c:v',
                    'mjpeg',
                    video_path,
                ],
                capture_output=True,
                check=True,
            )
            with open(video_path, 'rb') as video_file:
                video_bytes = video_file.read()

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=SimpleUploadedFile(
                        'clip.avi', video_bytes, content_type='video/x-msvideo'
                    ),
                    media_type='video',
                    duration=timedelta(seconds=1),
                )

                process_post_media.call(media.pk)
                media.refresh_from_db()

                self.assertTrue(media.thumbnail)
                self.assertTrue(media.thumbnail.storage.exists(media.thumbnail.name))
                with media.thumbnail.open('rb'):
                    with Image.open(media.thumbnail) as image:
                        self.assertLessEqual(image.width, 1280)

    def test_process_post_media_audio_generates_waveform(self):
        """Audio processing should store normalized waveform peaks."""
        from ..tasks import process_post_media

        samples = array('h', [0, 1000, -2000, 4000] * 100)
        completed = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=samples.tobytes(),
            stderr=b'',
        )

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=self._audio_file(),
                    media_type='audio',
                    duration=timedelta(seconds=1),
                )

                with mock.patch(
                    'apps.blogs.utils.media_processing.subprocess.run',
                    return_value=completed,
                ):
                    process_post_media.call(media.pk)

                media.refresh_from_db()

        self.assertIsNotNone(media.waveform)
        self.assertLessEqual(len(media.waveform), 120)
        self.assertTrue(all(0 <= peak <= 100 for peak in media.waveform))
        self.assertEqual(max(media.waveform), 100)

    def test_process_post_media_audio_decode_failure_leaves_waveform_null(self):
        """Audio decode failure should not raise or write waveform data."""
        from ..tasks import process_post_media

        completed = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout=b'',
            stderr=b'bad audio',
        )

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=self._audio_file(),
                    media_type='audio',
                    duration=timedelta(seconds=1),
                )

                with mock.patch(
                    'apps.blogs.utils.media_processing.subprocess.run',
                    return_value=completed,
                ):
                    process_post_media.call(media.pk)

                media.refresh_from_db()

        self.assertIsNone(media.waveform)

    def test_process_post_media_image_generates_capped_rendition(self):
        """Large image processing should save a JPEG rendition capped at 1600px."""
        from ..tasks import process_post_media

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=self._image_file(
                        content=self._image_bytes(width=2000, height=1000),
                        name='large.png',
                    ),
                    media_type='image',
                )

                process_post_media.call(media.pk)
                media.refresh_from_db()

                self.assertTrue(media.thumbnail)
                with media.thumbnail.open('rb'):
                    with Image.open(media.thumbnail) as image:
                        self.assertEqual(image.format, 'JPEG')
                        self.assertLessEqual(max(image.size), 1600)

    def test_process_post_media_image_skips_small_original(self):
        """Small image originals should be served directly without a rendition."""
        from ..tasks import process_post_media

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=self._image_file(
                        content=self._image_bytes(width=32, height=32),
                        name='small.png',
                    ),
                    media_type='image',
                )

                process_post_media.call(media.pk)
                media.refresh_from_db()

        self.assertFalse(media.thumbnail)

    def test_patch_custom_video_poster_replaces_old_thumbnail(self):
        """Authors can upload a processed custom poster for video posts."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=self._audio_file(name='clip.mp4', content_type='video/mp4'),
                    media_type='video',
                    duration=timedelta(seconds=1),
                )
                media.thumbnail.save(
                    'old.jpg',
                    SimpleUploadedFile(
                        'old.jpg',
                        self._image_bytes(image_format='JPEG'),
                        content_type='image/jpeg',
                    ),
                )
                old_path = media.thumbnail.path
                post = Post.objects.create(author=self.user, head='Video', media=media)

                response = self.client.patch(
                    reverse('post-detail', args=[post.id]),
                    {
                        'thumbnail': SimpleUploadedFile(
                            'poster.png',
                            self._image_bytes(width=2000, height=1200),
                            content_type='image/png',
                        ),
                    },
                    format='multipart',
                )

                media.refresh_from_db()
                self.assertEqual(response.status_code, 200)
                self.assertFalse(os.path.exists(old_path))
                self.assertTrue(response.data['media']['thumbnail'])
                with media.thumbnail.open('rb'):
                    with Image.open(media.thumbnail) as image:
                        self.assertLessEqual(max(image.size), 1280)

    def test_patch_custom_poster_rejects_invalid_image_without_post_update(self):
        """Invalid custom posters should return 400 before applying post edits."""
        media = Media.objects.create(media_type='video')
        post = Post.objects.create(author=self.user, head='Original', media=media)

        response = self.client.patch(
            reverse('post-detail', args=[post.id]),
            {
                'head': 'Changed',
                'thumbnail': SimpleUploadedFile(
                    'poster.jpg',
                    b'not an image',
                    content_type='image/jpeg',
                ),
            },
            format='multipart',
        )

        post.refresh_from_db()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(post.head, 'Original')

    def test_patch_custom_poster_rejects_oversized_image(self):
        """Poster uploads are capped at 5 MB."""
        media = Media.objects.create(media_type='video')
        post = Post.objects.create(author=self.user, head='Video', media=media)

        response = self.client.patch(
            reverse('post-detail', args=[post.id]),
            {
                'thumbnail': SimpleUploadedFile(
                    'poster.jpg',
                    b'x' * (5 * 1024 * 1024 + 1),
                    content_type='image/jpeg',
                ),
            },
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['error'], 'poster image is too large')

    def test_patch_custom_poster_requires_author_or_admin(self):
        """Non-authors cannot replace a video's custom poster."""
        media = Media.objects.create(media_type='video')
        post = Post.objects.create(author=self.user, head='Video', media=media)
        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            reverse('post-detail', args=[post.id]),
            {
                'thumbnail': SimpleUploadedFile(
                    'poster.png',
                    self._image_bytes(),
                    content_type='image/png',
                ),
            },
            format='multipart',
        )

        self.assertEqual(response.status_code, 403)

    def test_create_enqueues_media_processing_for_media_posts(self):
        """Media post creation should enqueue processing after commit."""
        with mock.patch('apps.blogs.views._enqueue_process_post_media') as mock_enqueue:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse('post-list'),
                    {
                        'head': 'Valid image',
                        'media': self._image_file(),
                        'media_type': 'image',
                    },
                    format='multipart',
                )

        self.assertEqual(response.status_code, 201)
        post = Post.objects.get(id=response.data['id'])
        mock_enqueue.assert_called_once_with(post.media.pk)

    def test_create_does_not_enqueue_media_processing_for_text_posts(self):
        """Text-only post creation should not enqueue media processing."""
        with mock.patch('apps.blogs.views._enqueue_process_post_media') as mock_enqueue:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse('post-list'),
                    {
                        'head': 'Text',
                        'body': 'No media here',
                    },
                )

        self.assertEqual(response.status_code, 201)
        mock_enqueue.assert_not_called()

    def test_local_copy_downloads_s3_media_to_a_temp_file(self):
        """local_copy should download S3-only media and clean up afterwards."""
        media = Media.objects.create(s3_file_key=self.key, media_type='audio')

        def fake_download(key, fileobj):
            fileobj.write(b'audio-bytes')

        with mock.patch('apps.blogs.models.download_to_file', side_effect=fake_download):
            with media.local_copy() as path:
                self.assertTrue(path.endswith('.mp3'))
                with open(path, 'rb') as handle:
                    self.assertEqual(handle.read(), b'audio-bytes')

        self.assertFalse(os.path.exists(path))

    def test_duplicate_s3_file_key_is_rejected_at_the_database(self):
        """The DB constraint should close the create-time exists() race."""
        Media.objects.create(s3_file_key=self.key, media_type='audio')

        with self.assertRaises(IntegrityError), transaction.atomic():
            Media.objects.create(s3_file_key=self.key, media_type='audio')

        # Rows without a key (local-file media) must not collide.
        Media.objects.create(media_type='audio')
        Media.objects.create(media_type='audio')

    def test_local_copy_without_any_source_raises(self):
        """local_copy should raise when the media row has no backing bytes."""
        media = Media.objects.create(media_type='audio')

        with self.assertRaises(FileNotFoundError):
            with media.local_copy():
                pass

    def test_transcribe_saves_transcript_from_local_media(self):
        """The transcribe action should persist the transcript for local media."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(file=self._audio_file(), media_type='audio')
                post = Post.objects.create(author=self.user, head='Voice note', media=media)

                with mock.patch(
                    'apps.blogs.tasks.transcribe_audio', return_value='hello world'
                ) as mock_transcribe:
                    response = self.client.post(reverse('post-transcribe', args=[post.id]))

        self.assertEqual(response.status_code, 202)
        mock_transcribe.assert_called_once()
        media.refresh_from_db()
        self.assertEqual(media.transcript, 'hello world')
        self.assertEqual(media.transcript_status, 'done')
        self.assertEqual(response.data['media']['transcript'], 'hello world')
        self.assertEqual(response.data['media']['transcript_status'], 'done')

    def test_transcribe_failure_marks_status_error(self):
        """Failed transcription tasks should leave a visible error status."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(file=self._audio_file(), media_type='audio')
                post = Post.objects.create(author=self.user, head='Voice note', media=media)

                with mock.patch(
                    'apps.blogs.tasks.transcribe_audio', side_effect=RuntimeError('boom')
                ):
                    response = self.client.post(reverse('post-transcribe', args=[post.id]))

        self.assertEqual(response.status_code, 202)
        media.refresh_from_db()
        self.assertEqual(media.transcript_status, 'error')
        self.assertEqual(media.transcript, '')

    def test_transcribe_is_idempotent_while_pending(self):
        """Pending transcription requests should not enqueue duplicate work."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_LOCAL_FILE_STORAGE=True):
                media = Media.objects.create(
                    file=self._audio_file(), media_type='audio', transcript_status='pending'
                )
                post = Post.objects.create(author=self.user, head='Voice note', media=media)

                with mock.patch('apps.blogs.tasks.transcribe_audio') as mock_transcribe:
                    response = self.client.post(reverse('post-transcribe', args=[post.id]))

        self.assertEqual(response.status_code, 202)
        mock_transcribe.assert_not_called()

    def test_post_detail_returns_json_when_requested(self):
        """The post detail page should serve JSON to Accept: application/json."""
        post = Post.objects.create(author=self.user, head='Hello', body='World')

        response = self.client.get(
            reverse('post_detail', args=[post.id]), HTTP_ACCEPT='application/json'
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], post.id)


class StreamPostMediaRangeTests(ViewTestCase):
    """Tests for HTTP range handling on the media streaming endpoint."""

    CONTENT = b'0123456789'

    def setUp(self):
        """Create a post backed by a local media file with known bytes."""
        super().setUp()
        self.client = APIClient()
        self.user = User.objects.create_user(username='stream_author', password='testpass123')

        self._media_root = tempfile.TemporaryDirectory()
        self.addCleanup(self._media_root.cleanup)
        self._overrides = override_settings(
            MEDIA_ROOT=self._media_root.name, USE_LOCAL_FILE_STORAGE=True
        )
        self._overrides.enable()
        self.addCleanup(self._overrides.disable)

        media = Media.objects.create(
            file=SimpleUploadedFile('clip.mp3', self.CONTENT, content_type='audio/mpeg'),
            media_type='audio',
        )
        self.post = Post.objects.create(author=self.user, head='Stream', media=media)
        self.url = reverse('stream_post_media', args=[self.post.id])

    def test_no_range_header_returns_full_file(self):
        """Requests without a Range header should get the whole file."""
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), self.CONTENT)

    def test_bounded_range_returns_partial_content(self):
        """A bounded range should return exactly the requested bytes."""
        response = self.client.get(self.url, HTTP_RANGE='bytes=2-5')

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b'2345')
        self.assertEqual(response['Content-Length'], '4')
        self.assertEqual(response['Content-Range'], f'bytes 2-5/{len(self.CONTENT)}')

    def test_suffix_range_returns_final_bytes(self):
        """A suffix range (bytes=-N) should return the last N bytes as a 206."""
        response = self.client.get(self.url, HTTP_RANGE='bytes=-4')

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b'6789')
        self.assertEqual(response['Content-Range'], f'bytes 6-9/{len(self.CONTENT)}')

    def test_open_ended_range_returns_remaining_bytes(self):
        """An open-ended range (bytes=N-) should return the rest of the file."""
        response = self.client.get(self.url, HTTP_RANGE='bytes=3-')

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b'3456789')
        self.assertEqual(response['Content-Range'], f'bytes 3-9/{len(self.CONTENT)}')

    def test_unsatisfiable_range_returns_416(self):
        """A range past the end of the file should return 416 with the size."""
        response = self.client.get(self.url, HTTP_RANGE='bytes=50-60')

        self.assertEqual(response.status_code, 416)
        self.assertEqual(response['Content-Range'], f'bytes */{len(self.CONTENT)}')
