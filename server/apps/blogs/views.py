from django.shortcuts import render

from rest_framework import viewsets
from rest_framework.permissions import AllowAny

from .models import Post
from .serializers import PostSerializer


class PostViewSet(viewsets.ModelViewSet):

    permission_classes = [AllowAny]
    queryset = Post.objects.all()
    # TODO: Confirm that we should optimize with `.prefetch_related('post_set')`
    serializer_class = PostSerializer

    def perform_create(self, serializer):
        user_id = self.request.user.id if self.request.user.is_authenticated else 2
        serializer.save(author_id=user_id)
