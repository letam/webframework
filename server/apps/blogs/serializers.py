from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Media, Post

User = get_user_model()


class UserNameSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name']


class MediaSerializer(serializers.ModelSerializer):
    class Meta:
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

    class Meta:
        model = Post
        fields = [
            'id',
            'created',
            'author',
            'head',
            'body',
            'media',
            'post_set',
        ]


class PostCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Post
        fields = [
            'head',
            'body',
            'media',
        ]
