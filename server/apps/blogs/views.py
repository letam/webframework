"""Views and API endpoints for blog posts and media."""

import hashlib
import logging
import mimetypes
import os
import tempfile

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import (
    BooleanField,
    Count,
    Exists,
    IntegerField,
    OuterRef,
    Subquery,
    Value,
)
from django.db.models.functions import Coalesce
from django.http import FileResponse, Http404, HttpResponse, HttpResponseRedirect, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle
from werkzeug.http import parse_range_header

from apps.uploads.s3 import (
    ALLOWED_CONTENT_TYPE_RE,
    delete_object,
    download_to_file,
    generate_presigned_get_url,
    head_object,
)

from .link_previews import sync_link_previews
from .models import (
    MEDIA_TYPE_CHOICES,
    VISIBILITY_PUBLIC,
    VISIBILITY_UNLISTED,
    Comment,
    Like,
    LinkPreview,
    Media,
    Post,
    PostView,
    generate_share_token,
)
from .pagination import PostCursorPagination
from .serializers import CommentSerializer, PostCreateSerializer, PostSerializer
from .tasks import fetch_link_previews, process_post_media, transcribe_post_media
from .utils import (
    MediaProbeError,
    generate_poster_rendition,
    is_valid_image,
    probe_media_duration,
    save_media_thumbnail,
)
from .utils.get_file_mimetype import get_file_mime_type

logger = logging.getLogger(__name__)

VALID_MEDIA_TYPES = {choice[0] for choice in MEDIA_TYPE_CHOICES}
POSTER_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024


class MediaValidationError(ValueError):
    """Raised when a media payload fails pre-create validation."""

    pass


def _related_count(model):
    """Count a post's related rows via a subquery.

    Joining two to-many relations into one aggregate produces an L×C row
    fan-out per post; independent subqueries keep each count linear.
    """
    return Coalesce(
        Subquery(
            model.objects.filter(post=OuterRef('pk'))
            .order_by()
            .values('post')
            .annotate(total=Count('pk'))
            .values('total'),
            output_field=IntegerField(),
        ),
        0,
    )


class TranscribeRateThrottle(UserRateThrottle):
    """Throttle for the transcribe action, which calls a paid external API."""

    scope = 'transcribe'


def _is_truthy(value):
    """Return whether a form/query value represents true."""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, str):
        return value.lower() in {'1', 'true', 'yes', 'on'}
    return bool(value)


def _pop_data_value(data, key):
    """Pop and return a scalar request value from dict-like request data."""
    value = data.get(key) if key in data else None
    data.pop(key, None)
    return value


def _shallow_request_data(data):
    """Return mutable scalar request data without deep-copying uploaded files."""
    if hasattr(data, 'dict'):
        return data.dict()
    return dict(data)


def _viewer_key_for_request(request):
    """Return the stable, non-credential viewer key for the request."""
    if request.user.is_authenticated:
        return f'u:{request.user.id}'

    if not request.session.session_key:
        request.session.save()

    session_key = request.session.session_key
    digest = hashlib.sha256(f'{settings.SECRET_KEY}:{session_key}'.encode()).hexdigest()[:40]
    return f's:{digest}'


def _record_post_views(request, posts):
    """Create deduped view rows for visible, published posts by non-author viewers."""
    posts_to_record = []
    user = request.user

    for post in posts:
        if post.is_draft:
            continue
        if user.is_authenticated and post.author_id == user.id:
            continue
        posts_to_record.append(post)

    if not posts_to_record:
        return

    viewer_key = _viewer_key_for_request(request)
    PostView.objects.bulk_create(
        [PostView(post=post, viewer_key=viewer_key) for post in posts_to_record],
        ignore_conflicts=True,
    )


def _enqueue_process_post_media(media_id):
    """Queue derived media processing without breaking the committed post."""
    try:
        process_post_media.enqueue(media_id)
    except Exception:
        logger.exception('Failed to enqueue media processing for media %s', media_id)


def _enqueue_fetch_link_previews(post_id):
    """Queue link preview fetching without breaking the committed post."""
    try:
        fetch_link_previews.enqueue(post_id)
    except Exception:
        logger.exception('Failed to enqueue link preview fetching for post %s', post_id)


class PostViewSet(viewsets.ModelViewSet):
    """API viewset for creating, reading, updating, and deleting posts."""

    permission_classes = [AllowAny]
    queryset = Post.objects.all()
    serializer_class = PostSerializer
    pagination_class = PostCursorPagination
    throttle_scope = None

    def get_annotated_queryset(self):
        """Return the annotated post queryset before visibility filtering."""
        queryset = (
            Post.objects.select_related('author', 'media')
            .prefetch_related('post_set', 'link_previews')
            .annotate(
                like_count=_related_count(Like),
                comment_count=_related_count(Comment),
                view_count=_related_count(PostView),
            )
        )

        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                liked=Exists(Like.objects.filter(post=OuterRef('pk'), user=user))
            )
        else:
            queryset = queryset.annotate(liked=Value(False, output_field=BooleanField()))

        return queryset

    def get_queryset(self):
        """Return the annotated post queryset with optional feed filters."""
        queryset = self.get_annotated_queryset()
        user = self.request.user

        if self.request.query_params.get('drafts', '').lower() == 'true':
            if not user.is_authenticated:
                return queryset.none()
            return queryset.filter(author=user, is_draft=True)

        queryset = queryset.visible_to(user)

        author_id = self.request.query_params.get('author')
        if author_id:
            try:
                queryset = queryset.filter(author_id=int(author_id))
            except (TypeError, ValueError):
                # Silently ignoring the filter would serve the whole feed as
                # if it were one author's posts.
                raise ValidationError({'author': 'must be an integer'}) from None

        if self.request.query_params.get('liked', '').lower() == 'true':
            if user.is_authenticated:
                queryset = queryset.filter(likes__user=user)
            else:
                queryset = queryset.none()

        if _is_truthy(self.request.query_params.get('pinned')):
            queryset = queryset.filter(pinned_at__isnull=False).order_by('-pinned_at', '-id')

        return queryset

    def get_object(self):
        """Return one annotated post after object-level visibility gating."""
        queryset = self.get_annotated_queryset()
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        lookup_value = self.kwargs[lookup_url_kwarg]
        obj = get_object_or_404(queryset, **{self.lookup_field: lookup_value})

        token = self.request.query_params.get('token')
        if not obj.is_visible_to(self.request.user, token=token):
            raise NotFound()

        self.check_object_permissions(self.request, obj)
        return obj

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
        requested_visibility = request.data.get('visibility', VISIBILITY_PUBLIC)
        requested_is_draft = _is_truthy(request.data.get('is_draft'))
        if (
            requested_visibility != VISIBILITY_PUBLIC or requested_is_draft
        ) and not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            media_payload = self._validate_media_payload(request)
        except MediaValidationError as error:
            return Response({'error': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        except MediaProbeError:
            # An environment failure (e.g. missing ffprobe), not a bad upload:
            # keep the uploaded object and don't blame the user's file.
            logger.exception('Media probing unavailable while validating an upload')
            return Response(
                {'error': 'Media validation is temporarily unavailable. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        request_data = _shallow_request_data(request.data)
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

                media = Media.objects.create(**media_kwargs)
                post.media = media  # pyright: ignore [reportOptionalMemberAccess]
                post.save(update_fields=['media'])  # pyright: ignore [reportOptionalMemberAccess]
                transaction.on_commit(
                    lambda media_id=media.pk: _enqueue_process_post_media(media_id)
                )

            if sync_link_previews(post):
                transaction.on_commit(
                    lambda post_id=post.pk: _enqueue_fetch_link_previews(post_id)
                )

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
            if media_type == 'image':
                try:
                    if not is_valid_image(media):
                        raise MediaValidationError('file is not a valid image')
                finally:
                    media.seek(0)
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
            self._validate_s3_image(s3_file_key)

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

            duration = probe_media_duration(temp_path)
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

    def _validate_s3_image(self, s3_file_key):
        """Validate that an S3 object contains decodable image bytes."""
        temp_path = None
        suffix = os.path.splitext(s3_file_key)[1]
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_path = temp_file.name
                download_to_file(s3_file_key, temp_file)

            is_valid = is_valid_image(temp_path)
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass

        if not is_valid:
            delete_object(s3_file_key)
            raise MediaValidationError('file is not a valid image')

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
        data = _shallow_request_data(request.data)

        # Extract media updates from request data if they exist
        transcript = _pop_data_value(data, 'transcript')
        alt_text = _pop_data_value(data, 'alt_text')
        thumbnail = _pop_data_value(data, 'thumbnail')

        poster = None
        if thumbnail:
            try:
                poster = self._validate_custom_poster(instance, thumbnail)
            except MediaValidationError as error:
                return Response({'error': str(error)}, status=status.HTTP_400_BAD_REQUEST)

        # Update the post
        old_head = instance.head
        old_body = instance.body
        old_link_previews_enabled = instance.link_previews_enabled
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            self.perform_update(serializer)

            if (
                instance.head != old_head
                or instance.body != old_body
                or instance.link_previews_enabled != old_link_previews_enabled
            ):
                if sync_link_previews(instance):
                    transaction.on_commit(
                        lambda post_id=instance.pk: _enqueue_fetch_link_previews(post_id)
                    )

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
                    instance.media.save(update_fields=media_updates.keys())

                if poster is not None:
                    save_media_thumbnail(instance.media, poster, 'poster.jpg')

        if getattr(instance, '_prefetched_objects_cache', None):
            # Drop stale prefetches (e.g. link_previews) so the response reflects the update.
            instance._prefetched_objects_cache = {}

        return Response(serializer.data)

    def _validate_custom_poster(self, post, thumbnail):
        """Validate and normalize an uploaded custom poster image."""
        if not post.media or post.media.media_type != 'video':
            raise MediaValidationError('poster image can only be set for video posts')

        if getattr(thumbnail, 'size', 0) > POSTER_UPLOAD_LIMIT_BYTES:
            raise MediaValidationError('poster image is too large')

        try:
            if not is_valid_image(thumbnail):
                raise MediaValidationError('poster image is not a valid image')
        finally:
            if hasattr(thumbnail, 'seek'):
                thumbnail.seek(0)

        try:
            return generate_poster_rendition(thumbnail)
        except Exception as error:
            raise MediaValidationError('poster image is not a valid image') from error

    @action(detail=True, methods=['post', 'delete'])
    def like(self, request, pk=None):
        """Like (POST) or unlike (DELETE) a post as the authenticated user."""
        post = self.get_object()

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if request.method == 'POST':
            Like.objects.get_or_create(user=request.user, post=post)
            liked = True
        else:
            Like.objects.filter(user=request.user, post=post).delete()
            liked = False

        return Response({'liked': liked, 'like_count': post.likes.count()})

    @action(detail=True, methods=['post', 'delete'])
    def pin(self, request, pk=None):
        """Pin (POST) or unpin (DELETE) a published post as its author or an admin."""
        post = self.get_object()

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not (request.user.id == post.author_id or request.user.is_superuser):
            return Response(
                {'error': 'Permission denied. Only the author or admin can pin this post.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if request.method == 'POST':
            if post.is_draft:
                return Response(
                    {'error': 'Drafts cannot be pinned'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            pinned_count = (
                Post.objects.filter(author=post.author, pinned_at__isnull=False)
                .exclude(pk=post.pk)
                .count()
            )
            if pinned_count >= 3:
                return Response(
                    {'error': 'You can pin up to 3 posts'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            post.pinned_at = timezone.now()
            post.save(update_fields=['pinned_at'])
        else:
            post.pinned_at = None
            post.save(update_fields=['pinned_at'])

        serializer = self.get_serializer(post)
        return Response(serializer.data)

    @action(
        detail=False,
        methods=['post'],
        url_path='views',
        throttle_classes=[ScopedRateThrottle],
        throttle_scope='views',
    )
    def views(self, request):
        """Record unique views for visible published posts."""
        post_ids = request.data.get('post_ids')
        if not isinstance(post_ids, list):
            return Response(
                {'error': 'post_ids must be a list of integers'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(post_ids) > 50:
            return Response(
                {'error': 'post_ids cannot contain more than 50 ids'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if any(not isinstance(post_id, int) or isinstance(post_id, bool) for post_id in post_ids):
            return Response(
                {'error': 'post_ids must be a list of integers'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = Post.objects.visible_to(request.user).filter(id__in=set(post_ids))
        if request.user.is_authenticated:
            queryset = queryset.exclude(author=request.user)

        _record_post_views(request, queryset)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """Publish a draft post, bumping its public timestamp."""
        post = self.get_object()

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not (request.user.id == post.author_id or request.user.is_superuser):
            return Response(
                {'error': 'Permission denied. Only the author or admin can publish this post.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if post.is_draft:
            post.is_draft = False
            post.created = timezone.now()
            post.save(update_fields=['is_draft', 'created', 'modified'])

        serializer = self.get_serializer(post)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='share-token')
    def regenerate_share_token(self, request, pk=None):
        """Rotate a post's share token."""
        post = self.get_object()

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not (request.user.id == post.author_id or request.user.is_superuser):
            return Response(
                {'error': 'Permission denied. Only the author or admin can reset this link.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        post.share_token = generate_share_token()
        post.save(update_fields=['share_token', 'modified'])

        serializer = self.get_serializer(post)
        return Response(serializer.data)

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
        post = self.get_object()

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        comment = get_object_or_404(Comment, id=comment_id, post=post)

        is_author = request.user.id == comment.author_id
        is_admin = request.user.is_superuser

        if not (is_author or is_admin):
            return Response(
                {'error': 'Permission denied. Only the author or admin can delete this comment.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        comment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Return aggregate post/like totals for an author.

        The paginated feed only ever holds the loaded pages client-side, so
        profile headers need a server-side aggregate to show true totals.
        """
        try:
            author_id = int(request.query_params.get('author', ''))
        except (TypeError, ValueError):
            return Response(
                {'error': 'author is required and must be an integer'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                'post_count': Post.objects.visible_to(request.user)
                .filter(author_id=author_id)
                .count(),
                'likes_received': Like.objects.filter(
                    post__in=Post.objects.visible_to(request.user).filter(author_id=author_id)
                ).count(),
            }
        )

    @action(detail=True, methods=['post'], throttle_classes=[TranscribeRateThrottle])
    def transcribe(self, request, pk=None):
        """Transcribe the audio of a media file of an existing post.

        Restricted to the post author or an admin because transcription calls a
        paid external API.
        """
        post = self.get_object()

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

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
            if post.media.transcript_status != 'pending':
                post.media.transcript_status = 'pending'
                post.media.save(update_fields=['transcript_status'])
                transcribe_post_media.enqueue(post.media.pk)
                post.media.refresh_from_db()
        except Exception:
            logger.exception('Error transcribing audio for post %s', post.id)
            return Response(
                {'error': 'An error occurred while transcribing the media file'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        serializer = self.get_serializer(post)
        return Response(serializer.data, status=status.HTTP_202_ACCEPTED)

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
    if not post.is_visible_to(request.user, token=request.GET.get('token')):
        raise Http404

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
    if not post.is_visible_to(request.user, token=request.GET.get('token')):
        raise Http404

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

    # Resolves suffix (bytes=-N) and open-ended (bytes=N-) ranges against the
    # file size, returning end-exclusive bounds, or None when unsatisfiable.
    bounds = ranges.range_for_length(file_size)
    if bounds is None:
        response = HttpResponse(status=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE)
        response['Content-Range'] = f'bytes */{file_size}'
        return response

    start, end = bounds
    with open(file_path, 'rb') as file_to_send:
        file_to_send.seek(start)
        data = file_to_send.read(end - start)

    # HTTP Content-Range is end-inclusive, hence end - 1.
    response = HttpResponse(data, content_type=get_file_mime_type(file_path))
    response['Content-Length'] = len(data)
    response['Content-Range'] = f'bytes {start}-{end - 1}/{file_size}'
    response['Accept-Ranges'] = 'bytes'
    response.status_code = 206  # Partial Content
    return response


@require_GET
def link_preview_image(request, preview_id):
    """Serve a stored link preview image through post visibility checks."""
    preview = get_object_or_404(LinkPreview.objects.select_related('post'), id=preview_id)
    if not preview.image:
        raise Http404
    if not preview.post.is_visible_to(request.user, token=request.GET.get('token')):
        raise Http404

    response = FileResponse(preview.image.open('rb'), content_type='image/jpeg')
    response['Cache-Control'] = 'private, max-age=86400'
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
    if not post.is_visible_to(request.user, token=request.GET.get('token')):
        raise Http404

    # Check if client wants JSON response
    accept_header = request.META.get('HTTP_ACCEPT', '')
    if 'application/json' in accept_header:
        # Plain Django view: a DRF Response would never get rendered here.
        serializer = PostSerializer(post, context={'request': request})
        return JsonResponse(serializer.data)

    _record_post_views(request, [post])

    # Media embeds via the gated streaming endpoint rather than raw storage
    # URLs: raw FieldFile URLs are empty for S3-backed media and bypass the
    # visibility checks for local media. Unlisted posts carry the share token
    # so token-holders (who by definition already have it) can load the bytes.
    media_url = None
    if post.media:
        media_url = reverse('stream_post_media', args=[post.id])
        if post.visibility == VISIBILITY_UNLISTED:
            media_url = f'{media_url}?token={post.share_token}'

    # Prepare context for HTML template
    context = {
        'post': post,
        'media_url': media_url,
        'like_count': post.likes.count(),
        'comment_count': post.comments.count(),
        'view_count': post.views.count(),
        'noindex': post.visibility != VISIBILITY_PUBLIC or post.is_draft,
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
    if post.media and post.media.media_type == 'image' and media_url:
        og_data['image'] = request.build_absolute_uri(media_url)

    context['og_data'] = og_data

    return render(request, 'blogs/post_detail.html', context)
