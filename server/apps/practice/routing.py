"""Practice WebSocket path mounted under its own exact origin validator."""

from django.urls import path

from .consumers import PracticeConsumer

websocket_urlpatterns = [
    path('ws/practice/rooms/<uuid:room_id>/', PracticeConsumer.as_asgi()),
]
