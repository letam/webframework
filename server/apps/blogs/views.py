"""Views and API endpoints for blog posts and media."""

import logging
import mimetypes
import os
import tempfile
import traceback

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import BooleanField, Count, Exists, OuterRef, Value
from django.http import FileResponse, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_GET
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from werkzeug.http import parse_range_header

from apps.uploads.s3 import (
    ALLOWED_CONTENT_TYPE_RE,
    delete_object,
    download_to_file,
    generate_presigned_get_url,
    head_object,
)

from .models import MEDIA_TYPE_CHOICES, Comment, Like, Media, Post
from .pagination import PostCursorPagination
from .serializers import CommentSerializer, PostCreateSerializer, PostSerializer
from .transcription import transcribe_audio
from .utils import convert_to_mp3, get_media_duration
from .utils.get_file_mimetype import get_file_mime_type

logger = logging.getLogger(__name__)

VALID_MEDIA_TYPES = {choice[0] for choice in MEDIA_TYPE_CHOICES}
WHISPER_FORMATS = {
    '.flac',
    '.m4a',
    '.mp3',
    '.mp4',
    '.mpeg',
    '.mpga',
    '.oga',
    '.ogg',
    '.wav',
    '.webm',
}


class MediaValidationError(ValueError):
    """Raised when a media payload fails pre-create validation."""

    pass


class TranscribeRateThrottle(UserRateThrottle):
    """Throttle for the transcribe action, which calls a paid external API."""

    scope = 'transcribe'


class PostViewSet(viewsets.ModelViewSet):
    """API viewset for creating, reading, updating, and deleting posts."""

    permission_classes = [AllowAny]
    queryset = Post.objects.all()
    serializer_class = PostSerializer
    pagination_class = PostCursorPagination

    def get_queryset(self):
        """Return the annotated post queryset with optional feed filters."""
        queryset = (
            Post.objects.select_related('author', 'media')
            .prefetch_related('post_set')
            .annotate(
                like_count=Count('likes', distinct=True),
                comment_count=Count('comments', distinct=True),
            )
        )

        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                liked=Exists(Like.objects.filter(post=OuterRef('pk'), user=user))
            )
        else:
            queryset = queryset.annotate(liked=Value(False, output_field=BooleanField()))

        author_id = self.request.query_params.get('author')
        if author_id:
            try:
                queryset = queryset.filter(author_id=int(author_id))
            except (TypeError, ValueError):
                pass

        if self.request.query_params.get('liked', '').lower() == 'true':
            if user.is_authenticated:
                queryset = queryset.filter(likes__user=user)
            else:
                queryset = queryset.none()

        return queryset

    def get_serializer_class(self):
        """Use the write serializer for creates and the read serializer otherwise."""
        if self.action == 'create':
            # Note that this is a more "readable" alternative to checking
            # if self.request.method == 'POST':
            return PostCreateSerializer
        return super().get_serializer_class()

    def perform_create(self, serializer):
        """Save a post with the authenticated or anonymous author."""
        if self.request.user.is_authenticated:
            serializer.save(author=self.request.user)
        else:
            # Anonymous posts are attributed to the dedicated 'anonymous' user
            # (created by migrations / init_users).
            serializer.save(author=get_user_model().objects.get(username='anonymous'))

    def create(self, request, *args, **kwargs):
        """Create a post and attach validated media when provided."""
        try:
            media_payload = self._validate_media_payload(request)
        except MediaValidationError as error:
            return Response({'error': str(error)}, status=status.HTTP_400_BAD_REQUEST)

        request_data = request.data.copy()
        for media_field in ('media', 'media_type', 's3_file_key'):
            request_data.pop(media_field, None)
        serializer = self.get_serializer(data=request_data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            self.perform_create(serializer)
            post = serializer.instance

            if media_payload:
                media_kwargs = {
                    'id': post.id,  # pyright: ignore [reportOptionalMemberAccess]
                    'media_type': media_payload['media_type'],
                }
                if media_payload['source'] == 'direct':
                    media_kwargs['file'] = media_payload['file']
                else:
                    media_kwargs['s3_file_key'] = media_payload['s3_file_key']
                    media_kwargs['duration'] = media_payload['duration']

                post.media = Media.objects.create(**media_kwargs)  # pyright: ignore [reportOptionalMemberAccess]
                post.save(update_fields=['media'])  # pyright: ignore [reportOptionalMemberAccess]

        # Get the created instance and serialize it with PostSerializer
        instance = serializer.instance
        response_serializer = PostSerializer(instance, context=self.get_serializer_context())
        headers = self.get_success_headers(response_serializer.data)

        return Response(response_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def _validate_media_payload(self, request):
        media = request.data.get('media')
        s3_file_key = request.data.get('s3_file_key')
        media_type = request.data.get('media_type')

        if media and s3_file_key:
            raise MediaValidationError('media and s3_file_key are mutually exclusive')

        if not media and not s3_file_key:
            return None

        if media_type not in VALID_MEDIA_TYPES:
            raise MediaValidationError('media_type is required and must be audio, video or image')

        if media:
            content_type = getattr(media, 'content_type', None)
            if not isinstance(content_type, str) or not ALLOWED_CONTENT_TYPE_RE.match(
                content_type
            ):
                raise MediaValidationError(
                    'media content_type must be an audio, video or image type'
                )
            if getattr(media, 'size', 0) > settings.MAX_MEDIA_UPLOAD_BYTES:
                raise MediaValidationError('media file is too large')
            return {
                'source': 'direct',
                'file': media,
                'media_type': media_type,
            }

        if not isinstance(s3_file_key, str):
            raise MediaValidationError('s3_file_key is invalid')

        user_id = self._media_owner_user_id(request)
        expected_prefix = f'post/audio/{user_id}/'
        if not s3_file_key.startswith(expected_prefix):
            raise MediaValidationError('s3_file_key does not belong to this user')

        if Media.objects.filter(s3_file_key=s3_file_key).exists():
            raise MediaValidationError('s3_file_key is already attached to another post')

        head = head_object(s3_file_key)
        if head is None:
            raise MediaValidationError('file was not uploaded')

        if head.get('ContentLength', 0) > settings.MAX_MEDIA_UPLOAD_BYTES:
            raise MediaValidationError('media file is too large')

        content_type = head.get('ContentType')
        if not isinstance(content_type, str) or not ALLOWED_CONTENT_TYPE_RE.match(content_type):
            raise MediaValidationError('media content_type must be an audio, video or image type')

        duration = None
        if media_type in {'audio', 'video'}:
            duration = self._validate_s3_audio_video_duration(s3_file_key)
        else:
            # HEAD validation confirms an image-like content type, but we do not
            # download and decode image bytes during post creation.
            duration = None

        return {
            'source': 's3',
            's3_file_key': s3_file_key,
            'media_type': media_type,
            'duration': duration,
        }

    def _media_owner_user_id(self, request):
        if request.user.is_authenticated:
            return request.user.id
        return get_user_model().objects.get(username='anonymous').id

    def _validate_s3_audio_video_duration(self, s3_file_key):
        temp_path = None
        suffix = os.path.splitext(s3_file_key)[1]
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_path = temp_file.name
                download_to_file(s3_file_key, temp_file)

            duration = get_media_duration(temp_path)
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass

        if duration is None:
            delete_object(s3_file_key)
            raise MediaValidationError('file is not valid audio/video')

        return duration

    def update(self, request, *args, **kwargs):
        """Update a post and supported media metadata fields."""
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # Check if user is authenticated
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Allow update if user is the author or an admin
        is_author = request.user.id == instance.author.id  # pyright: ignore [reportAttributeAccessIssue]
        is_admin = request.user.is_superuser  # pyright: ignore [reportAttributeAccessIssue]

        if not (is_author or is_admin):
            return Response(
                {'error': 'Permission denied. Only the author or admin can edit this post.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Create a mutable copy of request data
        data = request.data.copy()

        # Extract media updates from request data if they exist
        transcript = data.pop('transcript', None)
        alt_text = data.pop('alt_text', None)

        # Update the post
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if instance.media:
            # Get updates for media
            media_updates = {}

            if transcript is not None:
                instance.media.transcript = transcript
                media_updates['transcript'] = transcript

            if alt_text is not None:
                instance.media.alt_text = alt_text
                media_updates['alt_text'] = alt_text

            if media_updates:
                print(f'Media updates: {media_updates}')
                instance.media.save(update_fields=media_updates.keys())

        return Response(serializer.data)

    @action(detail=True, methods=['post', 'delete'])
    def like(self, request, pk=None):
        """Like (POST) or unlike (DELETE) a post as the authenticated user."""
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        post = self.get_object()

        if request.method == 'POST':
            Like.objects.get_or_create(user=request.user, post=post)
            liked = True
        else:
            Like.objects.filter(user=request.user, post=post).delete()
            liked = False

        return Response({'liked': liked, 'like_count': post.likes.count()})

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """List (GET) or add (POST) comments for a post."""
        post = self.get_object()

        if request.method == 'GET':
            comments = post.comments.select_related('author').all()
            serializer = CommentSerializer(comments, many=True)
            return Response(serializer.data)

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(author=request.user, post=post)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'comments/(?P<comment_id>\d+)')
    def delete_comment(self, request, pk=None, comment_id=None):
        """Delete a comment. Only the comment author or an admin may delete it."""
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        comment = get_object_or_404(Comment, id=comment_id, post_id=pk)

        is_author = request.user.id == comment.author_id
        is_admin = request.user.is_superuser

        if not (is_author or is_admin):
            return Response(
                {'error': 'Permission denied. Only the author or admin can delete this comment.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        comment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], throttle_classes=[TranscribeRateThrottle])
    def transcribe(self, request, pk=None):
        """Transcribe the audio of a media file of an existing post.

        Restricted to the post author or an admin because transcription calls a
        paid external API.
        """
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        post = self.get_object()

        is_author = request.user.id == post.author_id
        is_admin = request.user.is_superuser
        if not (is_author or is_admin):
            return Response(
                {'error': 'Permission denied. Only the author or admin can transcribe this post.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not post.media:
            return Response(
                {'error': 'No media file found for this post'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            converted_path = None
            with post.media.local_copy() as path:
                transcription_path = path
                if os.path.splitext(path)[1].lower() not in WHISPER_FORMATS:
                    converted_path = convert_to_mp3(path)
                    transcription_path = converted_path

                try:
                    transcript = transcribe_audio(transcription_path)
                finally:
                    if converted_path:
                        try:
                            os.unlink(converted_path)
                        except FileNotFoundError:
                            pass

            post.media.transcript = transcript
            post.media.save(update_fields=['transcript'])

            serializer = self.get_serializer(post)
            return Response(serializer.data)

        except FileNotFoundError:
            return Response(
                {'error': 'No media file found for this post'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            logger.error(f'Error transcribing audio for post {post.id}: {str(e)}')
            logger.error(traceback.format_exc())
            return Response(
                {'error': 'An error occurred while transcribing the media file'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def destroy(self, request, *args, **kwargs):
        """Override destroy method to check permissions.

        Allow deletion if user is the author or an admin (superuser).
        """
        instance = self.get_object()

        # Check if user is authenticated
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Allow deletion if user is the author or an admin
        is_author = request.user.id == instance.author.id  # pyright: ignore [reportAttributeAccessIssue]
        is_admin = request.user.is_superuser  # pyright: ignore [reportAttributeAccessIssue]

        if not (is_author or is_admin):
            return Response(
                {'error': 'Permission denied. Only the author or admin can delete this post.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        return super().destroy(request, *args, **kwargs)


@require_GET
def get_post_media_mime_type(request, post_id):
    """Get the mime type of media file of a post."""
    post = get_object_or_404(Post.objects.select_related('media'), id=post_id)
    # TODO: Restrict access to share only to authorized users

    if not post.media:
        return HttpResponse(status=status.HTTP_404_NOT_FOUND)

    file_path = _get_usable_media_file_path(post.media)
    if file_path:
        mime_type = get_file_mime_type(file_path)
    else:
        name = post.media.s3_file_key or post.media.file.name
        mime_type = mimetypes.guess_type(name)[0] or 'application/octet-stream'
    return HttpResponse(mime_type, content_type="text/plain")


@require_GET
def stream_post_media(request, post_id):
    """Stream a media file to the client. Necessary to load media files in Safari.

    Reference: https://stackoverflow.com/questions/79423628/django-streaming-video-audio-rangedfileresponse
    """
    post = get_object_or_404(Post.objects.select_related('media'), id=post_id)
    # TODO: Restrict access to share only to authorized users

    if not post.media:
        return HttpResponse(status=status.HTTP_404_NOT_FOUND)

    file_path = _get_usable_media_file_path(post.media)
    if not file_path:
        key = post.media.s3_file_key or post.media.file.name
        if not key:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        return HttpResponseRedirect(generate_presigned_get_url(key))

    file_size = os.path.getsize(file_path)

    # The Range header is always HTTP_RANGE in request.META, regardless of the
    # request scheme ('HTTPS_RANGE' is not a thing).
    range_header = request.META.get('HTTP_RANGE')

    ranges = parse_range_header(range_header)
    if not ranges:
        return FileResponse(open(file_path, 'rb'))

    if len(ranges.ranges) > 1:
        return HttpResponse(
            'Only one range request is supported', status=status.HTTP_400_BAD_REQUEST
        )

    if len(ranges.ranges) == 1 and (ranges.ranges[0][1] is None or ranges.ranges[0][1] == 2):
        # return the whole file
        mime_type = get_file_mime_type(file_path)
        response = FileResponse(open(file_path, 'rb'), content_type=mime_type)
        return response

    # For simplicity, handle only single range requests
    try:
        start, end = ranges.ranges[0]
    except Exception as e:
        logger.info(f'Error getting range for post {post.id}: {str(e)}')  # pyright: ignore [reportAttributeAccessIssue]
        mime_type = get_file_mime_type(file_path)
        response = FileResponse(open(file_path, 'rb'), content_type=mime_type)
        return response

    # werkzeug range tuples are end-exclusive; HTTP Content-Range is end-inclusive
    end = min(end, file_size)
    with open(file_path, 'rb') as file_to_send:
        file_to_send.seek(start)
        data = file_to_send.read(end - start)

    response = HttpResponse(data, content_type='application/octet-stream')
    response['Content-Length'] = len(data)
    response['Content-Range'] = f'bytes {start}-{end - 1}/{file_size}'
    response['Accept-Ranges'] = 'bytes'
    response.status_code = 206  # Partial Content
    return response


def _get_usable_media_file_path(media):
    if not media.file:
        return None
    try:
        return media.file.path
    except (NotImplementedError, ValueError):
        return None


def post_detail(request, post_id):
    """View for individual post detail pages.

    Returns JSON if Accept header contains application/json, otherwise renders HTML.
    """
    post = get_object_or_404(Post.objects.select_related('author', 'media'), id=post_id)

    # Check if client wants JSON response
    accept_header = request.META.get('HTTP_ACCEPT', '')
    if 'application/json' in accept_header:
        serializer = PostSerializer(post)
        return Response(serializer.data)

    # Prepare context for HTML template
    context = {
        'post': post,
        'debug': settings.DEBUG,
    }

    # Add Open Graph data
    og_data = {
        'title': post.head
        or (post.body[:140] + '...' if len(post.body) > 140 else post.body)
        or 'Post',
        'description': post.body[:200] + '...' if len(post.body) > 200 else post.body,
        'type': 'article',
        'url': request.build_absolute_uri(),
    }

    # Add image if post has media and it's an image type
    if post.media and post.media.media_type == 'image':
        if post.media.thumbnail:
            og_data['image'] = request.build_absolute_uri(post.media.thumbnail.url)
        elif post.media.file:
            og_data['image'] = request.build_absolute_uri(post.media.file.url)

    context['og_data'] = og_data

    return render(request, 'blogs/post_detail.html', context)
