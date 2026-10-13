"""Behavioral room tests; the concurrency gate runs separately on Postgres."""

from datetime import timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.practice.models import PracticeRoom, RoomCommand
from apps.practice.service import (
    PracticeError,
    apply_command,
    create_room,
    get_snapshot,
    join_room,
    manage_invitation,
    manage_membership,
)


class PracticeDomainTests(TestCase):
    """Exercise invitation and timer state without transport dependencies."""

    def setUp(self):
        """Create authenticated fixtures for room permissions and timer cases."""
        user_model = get_user_model()
        self.host = user_model.objects.create_user(username='host', password='examplepass123')
        self.guest = user_model.objects.create_user(username='guest', password='examplepass123')
        self.other = user_model.objects.create_user(username='other', password='examplepass123')
        self.snapshot, self.secret = create_room(self.host.id, 'Quiet room')
        self.room_id = self.snapshot['room_id']

    def command(self, action, *, revision=None, request_id=None, duration=None):
        """Apply one host command with the current or requested revision."""
        return apply_command(
            self.room_id,
            self.host.id,
            request_id or str(uuid4()),
            self.snapshot['revision'] if revision is None else revision,
            action,
            duration,
        )

    def test_join_requires_live_secret_and_host_revocation_is_sticky(self):
        """Voluntary leave permits rejoin; host revocation remains effective."""
        with self.assertRaises(PracticeError):
            get_snapshot(self.room_id, self.guest.id)
        with self.assertRaises(PracticeError):
            join_room(self.room_id, self.guest.id, 'wrong' * 10)
        join_room(self.room_id, self.guest.id, self.secret)
        manage_membership(self.room_id, self.guest.id, 'leave')
        join_room(self.room_id, self.guest.id, self.secret)
        manage_membership(self.room_id, self.host.id, 'revoke', self.guest.id)
        _, rotated = manage_invitation(self.room_id, self.host.id, 'rotate')
        with self.assertRaises(PracticeError):
            join_room(self.room_id, self.guest.id, rotated)
        join_room(self.room_id, self.other.id, rotated)
        manage_invitation(self.room_id, self.host.id, 'revoke')
        with self.assertRaises(PracticeError):
            join_room(self.room_id, self.other.id, rotated)
        self.assertEqual(get_snapshot(self.room_id, self.other.id)['room_id'], self.room_id)

    def test_timer_transitions_retry_and_conflict(self):
        """Retries replay once and stale revisions reject after state changes."""
        first_id = str(uuid4())
        started = self.command('start', request_id=first_id)
        self.assertTrue(started.accepted)
        self.assertEqual(started.snapshot['status'], 'running')
        replay = self.command('start', request_id=first_id)
        self.assertTrue(replay.replayed)
        self.assertEqual(replay.accepted_revision, started.accepted_revision)
        self.assertEqual(RoomCommand.objects.count(), 1)
        with self.assertRaises(PracticeError):
            self.command('pause', request_id=first_id)
        conflict = self.command('pause')
        self.assertFalse(conflict.accepted)
        self.assertEqual(conflict.code, 'revision_conflict')
        paused = self.command('pause', revision=started.accepted_revision)
        self.assertTrue(paused.accepted)
        resumed = self.command('resume', revision=paused.accepted_revision)
        self.assertTrue(resumed.accepted)
        reset = self.command('reset', revision=resumed.accepted_revision, duration=2)
        self.assertTrue(reset.accepted)
        self.assertEqual(reset.snapshot['run_id'], 2)
        self.assertEqual(reset.snapshot['duration_ms'], 120000)

    def test_elapsed_deadline_completes_once_and_pause_cannot_revive(self):
        """An expired running deadline advances exactly one revision."""
        started = self.command('start')
        PracticeRoom.objects.filter(id=self.room_id).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        completed = get_snapshot(self.room_id, self.host.id)
        self.assertEqual(completed['status'], 'completed')
        self.assertEqual(completed['revision'], started.accepted_revision + 1)
        self.assertEqual(
            get_snapshot(self.room_id, self.host.id)['revision'], completed['revision']
        )
        result = self.command('pause', revision=started.accepted_revision)
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, 'revision_conflict')
        self.assertEqual(result.snapshot['status'], 'completed')

    def test_participant_cannot_control_and_closed_room_rejects_join(self):
        """Only a host mutates the timer and closing blocks new joins."""
        join_room(self.room_id, self.guest.id, self.secret)
        with self.assertRaises(PracticeError):
            apply_command(self.room_id, self.guest.id, str(uuid4()), 0, 'start')
        closed = self.command('close')
        self.assertTrue(closed.accepted)
        with self.assertRaises(PracticeError):
            join_room(self.room_id, self.other.id, self.secret)
