"""HTTP permission, CSRF and feature-flag tests."""

import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import Client, TestCase, override_settings

from apps.practice.limits import PracticeRateLimitError, PracticeUnavailableError
from apps.practice.service import create_room, join_room


@override_settings(PRACTICE_ENABLED=True)
class PracticeAPITests(TestCase):
    """Check session and CSRF boundaries on the practice HTTP API."""

    def setUp(self):
        """Create authenticated fixtures for room permissions and timer cases."""
        user_model = get_user_model()
        self.host = user_model.objects.create_user(username='host', password='examplepass123')
        self.guest = user_model.objects.create_user(username='guest', password='examplepass123')
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.host)
        token = self.client.get('/auth/csrf/').json()['token']
        self.csrf = {'HTTP_X_CSRFTOKEN': token}

    def post(self, url, payload=None, **kwargs):
        """Send a JSON mutation with the issued CSRF token."""
        return self.client.post(
            url,
            data=json.dumps(payload or {}),
            content_type='application/json',
            **{**self.csrf, **kwargs},
        )

    @patch('apps.practice.views.observe_sync')
    @patch('apps.practice.views.check_rate')
    def test_create_join_revoke_and_disabled_routes(self, _rate, roster):
        """Creation requires CSRF; membership gates reads and disabled routes close."""
        roster.return_value = SimpleNamespace(user_ids=frozenset(), sequence=0)
        self.assertEqual(
            self.client.post(
                '/api/practice/rooms/', '{}', content_type='application/json'
            ).status_code,
            403,
        )
        created = self.post('/api/practice/rooms/', {'title': 'Quiet'}).json()
        room_id, secret = created['snapshot']['room_id'], created['invitation_secret']
        url = f'/api/practice/rooms/{room_id}/'
        self.assertEqual(self.client.get(url).json()['status'], 'ready')
        self.client.force_login(self.guest)
        self.assertEqual(self.client.get(url).status_code, 403)
        self.assertEqual(self.post(url + 'join/', {'invitation_secret': secret}).status_code, 200)
        self.assertEqual(self.client.get(url).json()['current_user_id'], self.guest.id)
        with override_settings(PRACTICE_ENABLED=False):
            self.assertEqual(self.client.get(url).status_code, 404)
            self.assertEqual(
                self.post(url + 'join/', {'invitation_secret': secret}).status_code, 404
            )
            self.assertEqual(
                self.client.get('/api/practice/capabilities/').json(), {'enabled': False}
            )

    def test_shared_rate_and_storage_failures_are_safe(self):
        """Both mutation and snapshot paths fail closed without leaking internals."""
        url = '/api/practice/rooms/'
        payload = {'title': 'Quiet'}
        with patch('apps.practice.views.check_rate', side_effect=PracticeRateLimitError()):
            response = self.post(url, payload)
            self.assertEqual(
                (response.status_code, response.json()['code']), (429, 'rate_limited')
            )
        with patch('apps.practice.views.check_rate', side_effect=PracticeUnavailableError()):
            response = self.post(url, payload)
            self.assertEqual(
                (response.status_code, response.json()['code']), (503, 'service_unavailable')
            )
        with patch('apps.practice.views.check_rate') as limiter:
            with patch(
                'apps.practice.views.create_room', side_effect=DatabaseError('private SQL details')
            ):
                response = self.post(url, payload)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('private SQL details', response.content.decode())
            response = self.post(url, payload)
            room_url = f"{url}{response.json()['snapshot']['room_id']}/"
            with patch(
                'apps.practice.views.get_snapshot',
                side_effect=DatabaseError('private SQL details'),
            ):
                response = self.client.get(room_url)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('private SQL details', response.content.decode())
            self.assertGreaterEqual(limiter.call_count, 2)

    @patch('apps.practice.views.check_rate')
    def test_duplicate_json_properties_rejected(self, _rate):
        """Ambiguous JSON keys cannot select a different invitation or duration."""
        response = self.client.post(
            '/api/practice/rooms/',
            data='{"title":"A","title":"B"}',
            content_type='application/json',
            **self.csrf,
        )
        self.assertEqual((response.status_code, response.json()['code']), (400, 'invalid_request'))
        nested = self.client.post(
            '/api/practice/rooms/',
            data='[' * 1000 + '0' + ']' * 1000,
            content_type='application/json',
            **self.csrf,
        )
        self.assertEqual((nested.status_code, nested.json()['code']), (400, 'invalid_request'))

    @patch('apps.practice.views.check_rate')
    def test_all_mutations_enforce_csrf_and_active_sessions(self, _rate):
        """Every mutation rejects missing/stale CSRF and anonymous/inactive sessions."""
        for action in ('create', 'join', 'leave', 'rotate', 'revoke_invitation', 'revoke_member'):
            with self.subTest(action=action):
                snapshot, secret = create_room(self.host.id, 'CSRF boundaries')
                room_id = snapshot['room_id']
                join_room(room_id, self.guest.id, secret)
                base = f'/api/practice/rooms/{room_id}/'
                url, payload, actor = {
                    'create': ('/api/practice/rooms/', {'title': 'Valid'}, self.host),
                    'join': (base + 'join/', {'invitation_secret': secret}, self.guest),
                    'leave': (base + 'leave/', {}, self.guest),
                    'rotate': (base + 'invite/rotate/', {}, self.host),
                    'revoke_invitation': (base + 'invite/revoke/', {}, self.host),
                    'revoke_member': (base + f'members/{self.guest.id}/revoke/', {}, self.host),
                }[action]
                client = Client(enforce_csrf_checks=True)
                client.force_login(actor)
                stale = client.get('/auth/csrf/').json()['token']
                client.cookies['csrftoken'] = 'a' * 32

                def send(token=None, client=client, url=url, payload=payload):
                    headers = {'HTTP_X_CSRFTOKEN': token} if token else {}
                    return client.post(
                        url, json.dumps(payload), content_type='application/json', **headers
                    )

                for token in (None, stale):
                    with self.subTest(token='missing' if token is None else 'stale'):
                        response = send(token)
                        self.assertEqual(response.status_code, 403)
                        self.assertIn('CSRF', response.content.decode())

                client.logout()
                token = client.get('/auth/csrf/').json()['token']
                response = send(token)
                self.assertEqual(
                    (response.status_code, response.json()['code']), (403, 'forbidden')
                )

                actor.is_active = False
                actor.save(update_fields=['is_active'])
                client.force_login(actor)
                token = client.get('/auth/csrf/').json()['token']
                response = send(token)
                self.assertEqual(
                    (response.status_code, response.json()['code']), (403, 'forbidden')
                )

                actor.is_active = True
                actor.save(update_fields=['is_active'])
                client.force_login(actor)
                token = client.get('/auth/csrf/').json()['token']
                response = send(token)
                self.assertEqual(response.status_code, 201 if action == 'create' else 200)
