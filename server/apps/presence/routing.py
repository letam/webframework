"""Public presence routes, mounted behind the configured strict origin validator."""

from django.urls import path

from .consumers import PresenceConsumer

websocket_urlpatterns = [path('ws/presence/', PresenceConsumer.as_asgi())]
