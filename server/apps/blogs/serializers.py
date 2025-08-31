from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Media, Post
from .utils.image_processing import is_image_file

User = get_user_model()


class UserNameSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name']


class MediaSerializer(serializers.ModelSerializer):
    compressed_file = serializers.SerializerMethodField()
    compressed_s3_file_key = serializers.SerializerMethodField()

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
            'compressed_file',
            'compressed_s3_file_key',
            'transcript',
            'alt_text',
        ]

    def get_compressed_file(self, obj):
        """Return compressed file URL if available, otherwise None"""
        if obj.compressed_file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.compressed_file.url)
            return obj.compressed_file.url
        return None

    def get_compressed_s3_file_key(self, obj):
        """Return compressed S3 file key if available"""
        return obj.compressed_s3_file_key if obj.compressed_s3_file_key else None


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
