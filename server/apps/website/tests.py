"""Tests for the website app."""

from unittest import mock

from django.test import TestCase


class HealthCheckMiddlewareTests(TestCase):
    """Tests for the health check middleware."""

    def test_health_check_returns_ok(self):
        """Return ok when the database cursor succeeds."""
        response = self.client.get('/healthz/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    def test_health_check_bypasses_allowed_hosts(self):
        """Return ok even when the host is not allowed."""
        with self.settings(ALLOWED_HOSTS=['testserver']):
            response = self.client.get('/healthz/', HTTP_HOST='bogus.example')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    def test_health_check_reports_database_failure(self):
        """Return service unavailable when the database check fails."""
        with mock.patch('config.middleware.connection') as connection:
            connection.cursor.side_effect = RuntimeError('database unavailable')

            response = self.client.get('/healthz/')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'status': 'error'})
