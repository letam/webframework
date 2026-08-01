"""Tests for the auth app views."""

# pyright: reportAttributeAccessIssue=false

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.test import Client, TestCase, override_settings

from apps.ratelimit import RATE_LIMIT_CACHE_ALIAS

User = get_user_model()


class AuthViewsTestCase(TestCase):
    """Tests for signup, login status, and logout behavior."""

    def setUp(self):
        """Create a client and reset shared rate-limit state."""
        self.client = Client()
        self.signup_url = '/auth/signup/'
        self.login_url = '/auth/login/'
        self.status_url = '/auth/status/'
        # Rate-limit counters live in a process-global cache; reset them per test.
        caches[RATE_LIMIT_CACHE_ALIAS].clear()

    def test_signup_success(self):
        """Test successful user registration."""
        data = {
            'username': 'testuser',
            'password1': 'testpass123',
            'password2': 'testpass123',
        }

        response = self.client.post(
            self.signup_url, data=json.dumps(data), content_type='application/json'
        )

        self.assertEqual(response.status_code, 200)
        response_data = response.json()
        self.assertIn('user_id', response_data)
        self.assertIn('username', response_data)
        self.assertEqual(response_data['username'], 'testuser')

        # Verify user was created
        user = User.objects.get(username='testuser')
        self.assertTrue(user.is_authenticated)

    def test_signup_password_mismatch(self):
        """Test signup with mismatched passwords."""
        data = {
            'username': 'testuser',
            'password1': 'testpass123',
            'password2': 'differentpass',
        }

        response = self.client.post(
            self.signup_url, data=json.dumps(data), content_type='application/json'
        )

        self.assertEqual(response.status_code, 400)
        response_data = response.json()
        self.assertIn('password2', response_data)

    def test_signup_duplicate_username(self):
        """Test signup with existing username."""
        # Create a user first
        User.objects.create_user(username='existinguser', password='testpass123')

        data = {
            'username': 'existinguser',
            'password1': 'testpass123',
            'password2': 'testpass123',
        }

        response = self.client.post(
            self.signup_url, data=json.dumps(data), content_type='application/json'
        )

        self.assertEqual(response.status_code, 400)
        response_data = response.json()
        self.assertIn('username', response_data)

    @override_settings(
        AUTH_PASSWORD_VALIDATORS=[
            {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
            {
                'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
                'OPTIONS': {'min_length': 16},
            },
            {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
            {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
        ]
    )
    def test_signup_weak_password(self):
        """Test signup with weak password."""
        data = {'username': 'testuser', 'password1': '123', 'password2': '123'}

        response = self.client.post(
            self.signup_url, data=json.dumps(data), content_type='application/json'
        )

        self.assertEqual(response.status_code, 400)
        response_data = response.json()
        self.assertIn('password2', response_data)

    def test_signup_auto_login(self):
        """Test that user is automatically logged in after signup."""
        data = {
            'username': 'testuser',
            'password1': 'testpass123',
            'password2': 'testpass123',
        }

        # Sign up
        response = self.client.post(
            self.signup_url, data=json.dumps(data), content_type='application/json'
        )

        self.assertEqual(response.status_code, 200)

        # Check auth status
        status_response = self.client.get(self.status_url)
        self.assertEqual(status_response.status_code, 200)
        status_data = status_response.json()
        self.assertTrue(status_data['is_authenticated'])
        self.assertEqual(status_data['username'], 'testuser')

    def test_logout_rejects_get(self):
        """Logging out via GET would allow logout-by-link CSRF; only POST/DELETE."""
        response = self.client.get('/auth/logout/')
        self.assertEqual(response.status_code, 405)


class RateLimitTests(TestCase):
    """Tests for per-IP rate limiting of the auth endpoints.

    These used to flake (`400 != 429`) for two reasons, both fixed:

    - Counters shared the default LocMemCache with the rest of the suite, and past
      MAX_ENTRIES (300) it culls keys — evicting a counter mid-test so the throttle
      never tripped. They now live in their own `ratelimit` cache with a high
      ceiling; see the CACHES block in settings.py, which fixes the same hazard in
      production.
    - The limiter buckets by `int(time.time() / window)`, so a run that straddles a
      bucket boundary starts counting again and the 11th request sails through.
      Time is frozen below, which is a test concern only: in production a client
      that waits out the window is meant to get a fresh allowance.
    """

    def setUp(self):
        """Freeze the rate-limit window and reset counters between tests."""
        self.client = Client()
        caches[RATE_LIMIT_CACHE_ALIAS].clear()
        # `apps.ratelimit._now`, not `apps.ratelimit.time.time`: the latter is the
        # stdlib module's attribute, so patching it freezes the clock process-wide.
        frozen_time = patch('apps.ratelimit._now', return_value=1_800_000_000.0)
        frozen_time.start()
        self.addCleanup(frozen_time.stop)

    def test_login_is_rate_limited(self):
        """Repeated failed login attempts from one client get a 429."""
        data = json.dumps({'username': 'nobody', 'password': 'wrong-password'})

        for _ in range(10):
            response = self.client.post('/auth/login/', data, content_type='application/json')
            self.assertEqual(response.status_code, 400, "Attempts within the limit pass through")

        response = self.client.post('/auth/login/', data, content_type='application/json')
        self.assertEqual(response.status_code, 429, "The 11th attempt should be throttled")

    def test_signup_is_rate_limited(self):
        """Repeated signup attempts from one client get a 429."""
        for _ in range(10):
            response = self.client.post('/auth/signup/', '{}', content_type='application/json')
            self.assertEqual(response.status_code, 400, "Attempts within the limit pass through")

        response = self.client.post('/auth/signup/', '{}', content_type='application/json')
        self.assertEqual(response.status_code, 429, "The 11th attempt should be throttled")
