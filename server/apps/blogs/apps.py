"""Django app configuration for blogs."""

from django.apps import AppConfig


class BlogsConfig(AppConfig):
    """Configure the blogs app."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.blogs'
