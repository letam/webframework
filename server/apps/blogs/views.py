import logging
import os
import traceback

from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_GET
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from werkzeug.http import parse_range_header

from .models import Media, Post
from .serializers import PostCreateSerializer, PostSerializer
from .transcription import transcribe_audio
from .utils.get_file_mimetype import get_file_mime_type

logger = logging.getLogger(__name__)


class PostViewSet(viewsets.ModelViewSet):
    permission_classes = [AllowAny]
    queryset = Post.objects.all()
    # TODO: Confirm that we should optimize with `.prefetch_related('post_set')`
    serializer_class = PostSerializer

    def get_serializer_class(self):
        if self.action == 'create':
            # Note that this is a more "readable" alternative to checking
            # if self.request.method == 'POST':
            return PostCreateSerializer
        return super().get_serializer_class()

    def perform_create(self, serializer):
        ANONYMOUS_USER_ID = 2
        user_id = (
            self.request.user.id  # pyright: ignore [reportAttributeAccessIssue]
            if self.request.user.is_authenticated
            else ANONYMOUS_USER_ID
        )
        serializer.save(author_id=user_id)

    def create(self, request, *args, **kwargs):
        media = request.data.get('media')
        media_type = request.data.get('media_type')
        request_data = request.data
        if media:
            request_data = {k: v for k, v in request.data.items() if k != 'media'}
        serializer = self.get_serializer(data=request_data)

        # Only print the request data in DEBUG mode
        if settings.DEBUG:
            # pretty print the request data
            import json

            print('Create Post - request data:')
            print(json.dumps(request_data, indent=4))
            if media:
                print(f'File: {media}')

        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)

        if media:
            serializer.instance.media = Media.objects.create(  # pyright: ignore [reportOptionalMemberAccess]
                id=serializer.instance.id,  # pyright: ignore [reportOptionalMemberAccess]
                file=media,
                media_type=media_type,
            )
            serializer.instance.save()  # pyright: ignore [reportOptionalMemberAccess]

        # Get the created instance and serialize it with PostSerializer
        instance = serializer.instance
        response_serializer = PostSerializer(instance)

        return Response(response_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # Check if user is authenticated
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED
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

    @action(detail=True, methods=['post'])
    def transcribe(self, request, pk=None):
        """
        Transcribe the audio of a media file of an existing post.
        """
        post = self.get_object()

        if not post.media:
            return Response(
                {'error': 'No media file found for this post'}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # if the media file is not mp3, convert it to mp3
            field_file = post.media.mp3_file if post.media.mp3_file else post.media.file
            if not field_file.path.endswith('.mp3'):
                post.media.convert_to_mp3()
                field_file = post.media.mp3_file

            # if the media file is not mp3, return an error
            if not field_file.path.endswith('.mp3'):
                return Response(
                    {'error': 'Media file is not mp3'}, status=status.HTTP_400_BAD_REQUEST
                )

            transcript = transcribe_audio(field_file)
            post.media.transcript = transcript
            post.media.save(update_fields=['transcript'])

            serializer = self.get_serializer(post)
            return Response(serializer.data)

        except Exception as e:
            logger.error(f'Error transcribing audio for post {post.id}: {str(e)}')
            logger.error(traceback.format_exc())
            return Response(
                {'error': 'An error occurred while transcribing the media file'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def destroy(self, request, *args, **kwargs):
        """
        Override destroy method to check permissions.
        Allow deletion if user is the author or an admin (superuser).
        """
        instance = self.get_object()

        # Check if user is authenticated
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED
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
    post = Post.objects.get(id=post_id)
    # TODO: Restrict access to share only to authorized users

    if not post.media:
        return HttpResponse(status=status.HTTP_404_NOT_FOUND)

    mime_type = get_file_mime_type(post.media.file.path)
    return HttpResponse(mime_type, content_type="text/plain")


@require_GET
def stream_post_media(request, post_id):
    """Stream a media file to the client. Necessary to load media files in Safari.

    Reference: https://stackoverflow.com/questions/79423628/django-streaming-video-audio-rangedfileresponse
    """
    post = Post.objects.select_related('media').get(id=post_id)
    # TODO: Restrict access to share only to authorized users

    file_size = os.path.getsize(post.media.file.path)

    if request.is_secure():
        range_header = request.META.get('HTTPS_RANGE')
    else:
        range_header = request.META.get('HTTP_RANGE')

    ranges = parse_range_header(range_header)
    if not ranges:
        return FileResponse(open(post.media.file.path, 'rb'))

    if len(ranges.ranges) > 1:
        return Response(
            {'error': 'Only one range request is supported'}, status=status.HTTP_400_BAD_REQUEST
        )

    if len(ranges.ranges) == 1 and (ranges.ranges[0][1] is None or ranges.ranges[0][1] == 2):
        # return the whole file
        mime_type = get_file_mime_type(post.media.file.path)
        response = FileResponse(open(post.media.file.path, 'rb'), content_type=mime_type)
        return response

    # For simplicity, handle only single range requests
    try:
        start, end = ranges[0]  # pyright: ignore [reportIndexIssue]
    except Exception as e:
        logger.info(f'Error getting range for post {post.id}: {str(e)}')  # pyright: ignore [reportAttributeAccessIssue]
        mime_type = get_file_mime_type(post.media.file.path)
        response = FileResponse(open(post.media.file.path, 'rb'), content_type=mime_type)
        return response

    with open(post.media.file.path, 'rb') as file_to_send:
        file_to_send.seek(start)
        data = file_to_send.read(end - start + 1)

    response = FileResponse(data, content_type='application/octet-stream')
    response['Content-Length'] = len(data)
    response['Content-Range'] = f'bytes {start}-{end}/{file_size}'
    response['Accept-Ranges'] = 'bytes'
    response.status_code = 206  # Partial Content
    return response


def post_detail(request, post_id):
    """
    View for individual post detail pages.
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
