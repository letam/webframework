"""Django app configuration for authentication."""

from django.apps import AppConfig


class AuthConfig(AppConfig):
    """Configure the authentication app."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.auth'
