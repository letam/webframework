from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Comment, Media, Post

User = get_user_model()


class UserNameSerializer(serializers.ModelSerializer):
    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        model = User
        fields = ['id', 'username', 'first_name', 'last_name']


class CommentSerializer(serializers.ModelSerializer):
    author = UserNameSerializer(read_only=True)
    body = serializers.CharField(max_length=2000)

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        model = Comment
        fields = ['id', 'author', 'body', 'created']


class MediaSerializer(serializers.ModelSerializer):
    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        model = Media
        fields = [
            'id',
            'created',
            'modified',
            'file',
            'mp3_file',
            'media_type',
            'duration',
            'thumbnail',
            'transcript',
            'alt_text',
        ]


class PostSerializer(serializers.HyperlinkedModelSerializer):
    author = UserNameSerializer(read_only=True)
    media = MediaSerializer(read_only=True)
    like_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    liked = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        model = Post
        fields = [
            'id',
            'created',
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
        # Prefer the queryset annotation; fall back to a query for
        # instances serialized outside the annotated queryset (e.g. create responses).
        count = getattr(obj, 'like_count', None)
        return count if count is not None else obj.likes.count()

    def get_comment_count(self, obj):
        count = getattr(obj, 'comment_count', None)
        return count if count is not None else obj.comments.count()

    def get_liked(self, obj):
        liked = getattr(obj, 'liked', None)
        if liked is not None:
            return liked
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.likes.filter(user=request.user).exists()
        return False


class PostCreateSerializer(serializers.ModelSerializer):
    class Meta:  # pyright: ignore [reportIncompatibleVariableOverride]
        model = Post
        fields = [
            'head',
            'body',
            'media',
        ]
