from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Post


User = get_user_model()


class UserNameSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name']


class PostSerializer(serializers.HyperlinkedModelSerializer):
    author = UserNameSerializer(read_only=True)

    class Meta:
        model = Post
        fields = [
            'url',
            'created',
            'author',
            'head',
            'body',
            'post_set',
        ]


class PostCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Post
        fields = [
            'head',
            'body',
        ]
