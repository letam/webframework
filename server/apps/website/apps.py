"""Django app configuration for website rendering."""

from django.apps import AppConfig


class WebsiteConfig(AppConfig):
    """Configure the website app."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.website'
