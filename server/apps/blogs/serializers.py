"""Serializers for blog API resources."""

import logging

from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.uploads.s3 import generate_presigned_get_url

from .models import Comment, Media, Post

logger = logging.getLogger(__name__)

User = get_user_model()


class UserNameSerializer(serializers.ModelSerializer):
    """Compact user serializer for embedded author data."""

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = User
        fields = ['id', 'username', 'first_name', 'last_name']


class CommentSerializer(serializers.ModelSerializer):
    """Serializer for post comments."""

    author = UserNameSerializer(read_only=True)
    body = serializers.CharField(max_length=2000)

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = Comment
        fields = ['id', 'author', 'body', 'created']


class MediaSerializer(serializers.ModelSerializer):
    """Serializer for media attached to posts."""

    signed_url = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = Media
        fields = [
            'id',
            'created',
            'modified',
            'file',
            'mp3_file',
            's3_file_key',
            'media_type',
            'duration',
            'thumbnail',
            'transcript',
            'transcript_status',
            'alt_text',
            'signed_url',
        ]

    def get_signed_url(self, obj):
        """Return a presigned object URL for S3-backed media."""
        if not obj.s3_file_key:
            return None
        try:
            return generate_presigned_get_url(obj.s3_file_key)
        except Exception:
            # A null signed_url is also what media without an S3 key returns,
            # so leave a trail distinguishing signing failures from that.
            logger.exception('Failed to generate signed URL for media %s', obj.pk)
            return None


class PostSerializer(serializers.HyperlinkedModelSerializer):
    """Serializer for post read responses."""

    author = UserNameSerializer(read_only=True)
    media = MediaSerializer(read_only=True)
    like_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    liked = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = Post
        fields = [
            'id',
            'created',
            'modified',
            'author',
            'head',
            'body',
            'media',
            'post_set',
            'like_count',
            'comment_count',
            'liked',
        ]

    def get_like_count(self, obj):
        """Return the annotated or computed like count."""
        # Prefer the queryset annotation; fall back to a query for
        # instances serialized outside the annotated queryset (e.g. create responses).
        count = getattr(obj, 'like_count', None)
        return count if count is not None else obj.likes.count()

    def get_comment_count(self, obj):
        """Return the annotated or computed comment count."""
        count = getattr(obj, 'comment_count', None)
        return count if count is not None else obj.comments.count()

    def get_liked(self, obj):
        """Return whether the request user has liked the post."""
        liked = getattr(obj, 'liked', None)
        if liked is not None:
            return liked
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.likes.filter(user=request.user).exists()
        return False


class PostCreateSerializer(serializers.ModelSerializer):
    """Serializer for post create payloads."""

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = Post
        fields = [
            'head',
            'body',
            'media',
        ]
