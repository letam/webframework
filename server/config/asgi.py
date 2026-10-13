"""Serve existing Django HTTP routes and explicitly enabled WebSocket routes."""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
# Initialize Django before importing consumers that use application models.
django_application = get_asgi_application()


async def reject_websocket(scope, receive, send):
    """Keep disabled realtime instances closed to WebSocket connections."""
    await receive()
    await send({'type': 'websocket.close', 'code': 4404})


def build_application():
    """Construct routes using the current instance capability settings."""
    websocket = reject_websocket
    if settings.REALTIME_ENABLED and settings.PRESENCE_ENABLED:
        from apps.presence.routing import websocket_urlpatterns

        origins = sorted(
            {origin for scope in settings.PRESENCE_SCOPES.values() for origin in scope['origins']}
        )
        websocket = OriginValidator(URLRouter(websocket_urlpatterns), origins)
    return ProtocolTypeRouter({'http': django_application, 'websocket': websocket})


application = build_application()
