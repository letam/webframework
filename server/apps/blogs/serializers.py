"""Serializers for blog API resources."""

import logging

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import serializers

from apps.uploads.s3 import generate_presigned_get_url
from apps.users.utils import get_avatar_url

from .models import Comment, LinkPreview, Media, Post

logger = logging.getLogger(__name__)

User = get_user_model()


class UserNameSerializer(serializers.ModelSerializer):
    """Compact user serializer for embedded author data."""

    avatar = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'avatar']

    def get_avatar(self, obj):
        """Return the user's avatar URL when one exists."""
        return get_avatar_url(obj)


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
    thumbnail = serializers.SerializerMethodField()

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
            'waveform',
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

    def get_thumbnail(self, obj):
        """Return a storage URL for a generated or uploaded thumbnail."""
        if not obj.thumbnail:
            return None
        try:
            return obj.thumbnail.storage.url(obj.thumbnail.name)
        except Exception:
            logger.exception('Failed to generate thumbnail URL for media %s', obj.pk)
            return None


class LinkPreviewSerializer(serializers.ModelSerializer):
    """Serializer for successfully fetched link previews."""

    image = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = LinkPreview
        fields = [
            'id',
            'url',
            'kind',
            'title',
            'description',
            'site_name',
            'author_name',
            'author_handle',
            'embed_id',
            'extra',
            'published_at',
            'image',
        ]

    def get_image(self, obj):
        """Return the protected image endpoint URL when an image exists."""
        if not obj.image:
            return None

        url = reverse('link-preview-image', args=[obj.pk])
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(url)
        return url


class PostSerializer(serializers.HyperlinkedModelSerializer):
    """Serializer for post read responses."""

    author = UserNameSerializer(read_only=True)
    media = MediaSerializer(read_only=True)
    link_previews = serializers.SerializerMethodField()
    post_set = serializers.SerializerMethodField()
    like_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    view_count = serializers.SerializerMethodField()
    liked = serializers.SerializerMethodField()
    share_token = serializers.SerializerMethodField()

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
            'link_previews',
            'post_set',
            'visibility',
            'is_draft',
            'link_previews_enabled',
            'pinned_at',
            'share_token',
            'like_count',
            'comment_count',
            'view_count',
            'liked',
        ]
        read_only_fields = ['is_draft', 'pinned_at']

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

    def get_view_count(self, obj):
        """Return the annotated or computed view count."""
        count = getattr(obj, 'view_count', None)
        return count if count is not None else obj.views.count()

    def get_liked(self, obj):
        """Return whether the request user has liked the post."""
        liked = getattr(obj, 'liked', None)
        if liked is not None:
            return liked
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.likes.filter(user=request.user).exists()
        return False

    def get_share_token(self, obj):
        """Return the share token only to authors and superusers."""
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if obj.author_id == request.user.id or request.user.is_superuser:
            return obj.share_token
        return None

    def get_post_set(self, obj):
        """Return ids for child posts visible to the request user."""
        request = self.context.get('request')
        user = request.user if request else None
        return [child.id for child in obj.post_set.all() if child.is_visible_to(user)]

    def get_link_previews(self, obj):
        """Return successfully fetched link previews in stored order."""
        previews = [preview for preview in obj.link_previews.all() if preview.status == 'ok']
        return LinkPreviewSerializer(previews, many=True, context=self.context).data


class PostCreateSerializer(serializers.ModelSerializer):
    """Serializer for post create payloads."""

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        """Serializer metadata."""

        model = Post
        fields = [
            'head',
            'body',
            'media',
            'visibility',
            'is_draft',
            'link_previews_enabled',
        ]
