from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.permissions import AllowAny
from rest_framework.decorators import action
from rest_framework.response import Response
import logging

from .models import Post
from .serializers import PostSerializer, PostCreateSerializer
from .transcription import transcribe_audio

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

            print('Pretty print of request data:')
            # make a copy of the request data
            request_data = request.data.copy()
            # remove the media file from the request data before logging it
            if 'media' in request_data:
                media = request_data.pop('media')
                print(f'File: {media}')
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
