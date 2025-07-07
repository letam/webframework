import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

User = get_user_model()


class AuthViewsTestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.signup_url = '/auth/signup/'
        self.login_url = '/auth/login/'
        self.status_url = '/auth/status/'

    def test_signup_success(self):
        """Test successful user registration."""
        data = {'username': 'testuser', 'password1': 'testpass123', 'password2': 'testpass123'}

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
        data = {'username': 'testuser', 'password1': 'testpass123', 'password2': 'differentpass'}

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

        data = {'username': 'existinguser', 'password1': 'testpass123', 'password2': 'testpass123'}

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
        data = {'username': 'testuser', 'password1': 'testpass123', 'password2': 'testpass123'}

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
