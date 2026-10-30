"""Regression coverage for production WebSocket CSP sources."""

from config.settings import realtime_connect_sources
from csp.constants import SELF
from django.conf import settings
from django.test import SimpleTestCase, override_settings


@override_settings(
    DEBUG=False,
    REALTIME_ENABLED=True,
    ALLOWED_HOSTS=['rooms.example.com', '.example.com', '*'],
)
class RealtimeCSPTests(SimpleTestCase):
    """Build the import-time connect-src value without reloading Django settings."""

    def connect_sources(self, sources, server_host=''):
        """Apply the CSP helper using the overridden instance settings."""
        return realtime_connect_sources(
            sources,
            debug=settings.DEBUG,
            realtime_enabled=settings.REALTIME_ENABLED,
            allowed_hosts=settings.ALLOWED_HOSTS,
            server_host=server_host,
        )

    def test_production_realtime_adds_hosts_and_preserves_existing_sources(self):
        """Concrete and leading-dot hosts are explicit; an unrestricted host is skipped."""
        sources = [
            SELF,
            'http://127.0.0.1:8000',
            'https://media.example',
            'https://sentry.example',
        ]
        self.assertEqual(
            self.connect_sources(sources),
            [*sources, 'wss://rooms.example.com', 'wss://example.com', 'wss://*.example.com'],
        )

    @override_settings(REALTIME_ENABLED=False)
    def test_disabled_realtime_keeps_sources_unchanged(self):
        """HTTP-only production instances gain no WebSocket permissions."""
        sources = [SELF, 'http://127.0.0.1:8000']
        self.assertEqual(self.connect_sources(sources, 'https://api.example.net'), sources)

    @override_settings(DEBUG=True)
    def test_debug_keeps_sources_unchanged(self):
        """Development keeps its existing HTTP and WebSocket sources."""
        sources = [SELF, 'http://localhost:8000', 'ws://localhost:5173']
        self.assertEqual(self.connect_sources(sources, 'https://api.example.net'), sources)

    def test_configured_server_host_is_included(self):
        """Honor the frontend's absolute or scheme-relative backend URL and port."""
        for server_host, expected in (
            ('https://api.example.net:8443', 'wss://api.example.net:8443'),
            ('//api.example.net', 'wss://api.example.net'),
            ('http://api.example.net:8000', 'ws://api.example.net:8000'),
        ):
            with self.subTest(server_host=server_host):
                self.assertIn(expected, self.connect_sources([SELF], server_host))
