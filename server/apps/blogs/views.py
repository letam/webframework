from rest_framework import viewsets, status
from rest_framework.permissions import AllowAny
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Post
from .serializers import PostSerializer, PostCreateSerializer
from .transcription import transcribe_audio


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

    @action(detail=True, methods=['post'])
    def transcribe(self, request, pk=None):
        """
        Transcribe the audio file of an existing post.
        """
        post = self.get_object()

        if not post.audio:
            return Response(
                {"error": "No audio file found for this post"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            transcript = transcribe_audio(post.audio)
            # Update the post with the transcript
            update_kwargs = {
                'head': transcript,
                **({
                    'body': transcript,
                } if len(transcript) > 255 else {})
            }
            Post.objects.filter(id=post.id).update(**update_kwargs)

            # Refresh the post instance to get updated data
            post.refresh_from_db()
            serializer = self.get_serializer(post)
            return Response(serializer.data)

        except Exception as e:
            return Response(
                {"error": f"Error transcribing audio: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
