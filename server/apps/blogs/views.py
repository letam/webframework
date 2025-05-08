import os

from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.permissions import AllowAny
from rest_framework.decorators import action
from rest_framework.response import Response
import logging
from werkzeug.http import parse_range_header
from django.http import FileResponse, HttpResponse
from django.views.decorators.http import require_GET

from .models import Post
from .serializers import PostSerializer, PostCreateSerializer
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
            self.request.user.id  # type: ignore
            if self.request.user.is_authenticated
            else ANONYMOUS_USER_ID
        )
        serializer.save(author_id=user_id)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)

        # Only print the request data in DEBUG mode
        if settings.DEBUG:
            # pretty print the request data
            import json

            print('Create Post - request data:')
            request_data = request.data
            if 'media' in request_data:
                media = request.data.get('media')
                print(f'File: {media}')
                request_data = {k: v for k, v in request.data.items() if k != 'media'}
            print(json.dumps(request_data, indent=4))

        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)

        # Get the created instance and serialize it with PostSerializer
        instance = serializer.instance
        response_serializer = PostSerializer(instance)

        return Response(response_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=True, methods=['post'])
    def transcribe(self, request, pk=None):
        """
        Transcribe the audio of a media file of an existing post.
        """
        post = self.get_object()

        if not post.media and not post.media_mp3:
            return Response(
                {'error': 'No media file found for this post'}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # if the media file is not mp3, convert it to mp3
            media = post.media_mp3 if post.media_mp3 else post.media
            if not media.path.endswith('.mp3'):
                post.convert_media_to_mp3()
                media = post.media_mp3

            # if the media file is not mp3, return an error
            if not media.path.endswith('.mp3'):
                return Response(
                    {'error': 'Media file is not mp3'}, status=status.HTTP_400_BAD_REQUEST
                )

            transcript = transcribe_audio(media)
            # Update the post with the transcript
            update_kwargs = {
                'body': transcript,
            }
            Post.objects.filter(id=post.id).update(**update_kwargs)

            # Refresh the post instance to get updated data
            post.refresh_from_db()
            serializer = self.get_serializer(post)
            return Response(serializer.data)

        except Exception as e:
            logger.error(f'Error transcribing audio for post {post.id}: {str(e)}')
            return Response(
                {'error': 'An error occurred while transcribing the media file'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


@require_GET
def get_post_media_mime_type(request, post_id):
    """Get the mime type of media file of a post."""
    post = Post.objects.get(id=post_id)
    # TODO: Restrict access to share only to authorized users

    if not post.media:
        return HttpResponse(status=status.HTTP_404_NOT_FOUND)

    mime_type = get_file_mime_type(post.media.path)
    return HttpResponse(mime_type, content_type="text/plain")


@require_GET
def stream_post_media(request, post_id):
    """Stream a media file to the client. Necessary to load media files in Safari.

    Reference: https://stackoverflow.com/questions/79423628/django-streaming-video-audio-rangedfileresponse
    """
    post = Post.objects.get(id=post_id)
    # TODO: Restrict access to share only to authorized users

    file_size = os.path.getsize(post.media.path)

    if request.is_secure():
        range_header = request.META.get('HTTPS_RANGE')
    else:
        range_header = request.META.get('HTTP_RANGE')

    ranges = parse_range_header(range_header)
    if not ranges:
        return FileResponse(open(post.media.path, 'rb'))

    if len(ranges.ranges) > 1:
        return Response(
            {'error': 'Only one range request is supported'}, status=status.HTTP_400_BAD_REQUEST
        )

    if len(ranges.ranges) == 1 and (ranges.ranges[0][1] is None or ranges.ranges[0][1] == 2):
        # return the whole file
        mime_type = get_file_mime_type(post.media.path)
        response = FileResponse(open(post.media.path, 'rb'), content_type=mime_type)
        return response

    # For simplicity, handle only single range requests
    try:
        start, end = ranges[0]
    except Exception as e:
        logger.info(f'Error getting range for post {post.id}: {str(e)}')
        mime_type = get_file_mime_type(post.media.path)
        response = FileResponse(open(post.media.path, 'rb'), content_type=mime_type)
        return response

    with open(post.media.path, 'rb') as file_to_send:
        file_to_send.seek(start)
        data = file_to_send.read(end - start + 1)

    response = FileResponse(data, content_type='application/octet-stream')
    response['Content-Length'] = len(data)
    response['Content-Range'] = f'bytes {start}-{end}/{file_size}'
    response['Accept-Ranges'] = 'bytes'
    response.status_code = 206  # Partial Content
    return response
