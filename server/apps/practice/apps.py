"""Practice room apps."""

from django.apps import AppConfig


class PracticeConfig(AppConfig):
    """Register the optional durable practice app."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.practice'
