"""Django app configuration for blogs."""

from django.apps import AppConfig


class BlogsConfig(AppConfig):
    """Configure the blogs app."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.blogs'

    def ready(self):
        """Check production storage after Django has configured logging."""
        from config.storage_checks import warn_about_ephemeral_storage

        warn_about_ephemeral_storage()
