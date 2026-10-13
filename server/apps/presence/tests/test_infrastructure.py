"""Configuration and ASGI HTTP regression tests for the optional capability."""

import tempfile
from pathlib import Path
from unittest.mock import patch

from channels.testing import WebsocketCommunicator
from channels.testing.application import ApplicationCommunicator
from config.asgi import build_application
from config.realtime import validate_realtime
from django.conf import settings
from django.core.asgi import get_asgi_application
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, TransactionTestCase, override_settings


class ConfigurationTests(SimpleTestCase):
    """Disabled instances boot normally; enabled instances have explicit boundaries."""

    def configuration(self):
        """Return complete safe test configuration without relying on local .env."""
        result = {
            name: getattr(settings, name)
            for name in dir(settings)
            if name.startswith(('REALTIME_', 'PRESENCE_'))
        }
        result.update(
            REALTIME_ENABLED=True,
            PRESENCE_ENABLED=True,
            DEBUG=True,
            REALTIME_REDIS_URL='redis://localhost:6379/0',
            REALTIME_PREFIX='test-instance',
            PRESENCE_HASH_KEY='h' * 32,
            PRESENCE_SCOPES={'reading': {'origins': ['http://localhost:5173']}},
        )
        return result

    def test_enabled_configuration_requires_real_redis(self):
        """No in-memory fallback is accepted for enabled realtime."""
        config = self.configuration()
        config['REALTIME_REDIS_URL'] = ''
        with self.assertRaisesMessage(ImproperlyConfigured, 'redis://'):
            validate_realtime(config)

    def test_production_origins_are_explicit_https(self):
        """Wildcard, host-only, missing and HTTP production origins fail closed."""
        for origin in (
            '*',
            'localhost',
            'https://*.example.test',
            'http://example.test',
            'https://example.test/path',
            'https://user@example.test',
            'https://example.test:invalid',
            'https://example.test:65536',
        ):
            with self.subTest(origin=origin):
                config = self.configuration()
                config.update(DEBUG=False, PRESENCE_SCOPES={'reading': {'origins': [origin]}})
                with self.assertRaises(ImproperlyConfigured):
                    validate_realtime(config)

    def test_disabled_capability_requires_no_redis_or_hash_secret(self):
        """Existing instances need no additional services or credentials."""
        validate_realtime({'REALTIME_ENABLED': False, 'PRESENCE_ENABLED': False})

    def test_presence_requires_realtime(self):
        """Presence cannot accidentally enable its routes without shared state."""
        with self.assertRaises(ImproperlyConfigured):
            validate_realtime({'REALTIME_ENABLED': False, 'PRESENCE_ENABLED': True})

    @override_settings(REALTIME_ENABLED=False, PRESENCE_ENABLED=False)
    async def test_disabled_websockets_are_rejected(self):
        """HTTP-only instances do not accept even a well-formed socket handshake."""
        socket = WebsocketCommunicator(
            build_application(), '/ws/presence/', headers=[(b'origin', b'http://localhost:5173')]
        )
        accepted, code = await socket.connect()
        self.assertFalse(accepted)
        self.assertEqual(code, 4404)
        await socket.wait()


@override_settings(
    REALTIME_ENABLED=False, PRESENCE_ENABLED=False, ALLOWED_HOSTS=['testserver'], DEBUG=True
)
class ASGIHTTPTests(TransactionTestCase):
    """Exercise real Django middleware/views through ASGI rather than the WSGI client."""

    async def request(self, path, method='GET', headers=None, body=b''):
        """Send one HTTP request through the initialized Django ASGI application."""
        communicator = ApplicationCommunicator(
            get_asgi_application(),
            {
                'type': 'http',
                'http_version': '1.1',
                'method': method,
                'path': path,
                'query_string': b'',
                'headers': headers or [(b'host', b'testserver')],
            },
        )
        await communicator.send_input({'type': 'http.request', 'body': body})
        response = await communicator.receive_output(timeout=5)
        response['body'] = b''
        while True:
            chunk = await communicator.receive_output(timeout=5)
            response['body'] += chunk.get('body', b'')
            if not chunk.get('more_body', False):
                break
        await communicator.wait()
        return response

    async def test_health_readiness_auth_and_csrf_routes(self):
        """Platform health and existing session/CSRF routes remain usable."""
        for path in ('/healthz/', '/readyz/', '/auth/status/'):
            with self.subTest(path=path):
                response = await self.request(path)
                self.assertEqual(response['status'], 200)
        response = await self.request('/auth/csrf/')
        self.assertEqual(response['status'], 200)
        self.assertIn(b'token', response['body'])

    async def test_csrf_is_still_enforced_under_asgi(self):
        """A session mutation without the existing CSRF exchange is rejected."""
        response = await self.request('/auth/logout/', method='POST')
        self.assertEqual(response['status'], 403)

    async def test_static_and_media_are_served_through_asgi(self):
        """WhiteNoise and Django's development media routes work in the ASGI stack."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'presence-probe.txt').write_text('asset from ASGI')
            with override_settings(
                STATIC_ROOT=directory, MEDIA_ROOT=directory, WHITENOISE_AUTOREFRESH=True
            ):
                response = await self.request('/static/presence-probe.txt')
                self.assertEqual(response['status'], 200)
                self.assertEqual(response['body'], b'asset from ASGI')
                # Media URL patterns are generated at URLconf import. Test a fresh
                # URL resolver rather than mutating the instance's existing routes.
                from django.conf.urls.static import static
                from django.urls import clear_url_caches

                with override_settings(
                    ROOT_URLCONF=type(
                        'MediaRoutes',
                        (),
                        {'urlpatterns': static('/media/', document_root=directory)},
                    )
                ):
                    clear_url_caches()
                    response = await self.request('/media/presence-probe.txt')
                    self.assertEqual(response['status'], 200)
                    self.assertEqual(response['body'], b'asset from ASGI')
                clear_url_caches()

    async def test_readiness_redis_failure_does_not_change_health_contract(self):
        """Dependency readiness reports an outage separately from platform health."""
        from redis.exceptions import ConnectionError

        with override_settings(
            REALTIME_ENABLED=True, REALTIME_REDIS_URL='redis://localhost:6379/0'
        ):
            with patch('config.readiness.Redis.from_url', side_effect=ConnectionError()):
                response = await self.request('/readyz/')
            self.assertEqual(response['status'], 503)
            response = await self.request('/healthz/')
            self.assertEqual(response['status'], 200)
