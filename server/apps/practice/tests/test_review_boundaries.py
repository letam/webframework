"""Independent regression checks for invitation and durable command boundaries."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase

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


class PracticeBoundaryTests(TestCase):
    """Exercise caller mistakes and delayed retries without relying on Redis."""

    def setUp(self):
        """Prepare a host, participant and an invitation-only outsider."""
        user_model = get_user_model()
        self.host = user_model.objects.create_user(username='boundary-host')
        self.guest = user_model.objects.create_user(username='boundary-guest')
        self.outsider = user_model.objects.create_user(username='boundary-outsider')
        self.initial, self.secret = create_room(self.host.pk, 'Shared practice')
        self.room_id = self.initial['room_id']
        join_room(self.room_id, self.guest.pk, self.secret)

    def command(self, action, revision=0, request_id=None, duration=None):
        """Issue one host command with explicit optimistic concurrency."""
        return apply_command(
            self.room_id, self.host.pk, request_id or str(uuid4()), revision, action, duration
        )

    def test_creation_rejects_non_integer_and_out_of_range_durations(self):
        """JSON booleans and floats cannot bypass the whole-minute duration policy."""
        before = PracticeRoom.objects.count()
        for duration in (True, False, 0, 121, -1, 1.5, '10', [], {}):
            with self.subTest(duration=duration), self.assertRaises(PracticeError):
                create_room(self.host.pk, 'Invalid duration', duration)
        self.assertEqual(PracticeRoom.objects.count(), before)
        for duration in (1, 120):
            snapshot, _ = create_room(self.host.pk, 'Boundary duration', duration)
            self.assertEqual(snapshot['duration_ms'], duration * 60_000)

    def test_creation_rejects_empty_long_and_non_string_titles(self):
        """Titles have bounded nonempty visible text."""
        for title in ('', '   ', 'x' * 121, None, False, [], {}):
            with self.subTest(title=title), self.assertRaises(PracticeError):
                create_room(self.host.pk, title)
        snapshot, _ = create_room(self.host.pk, '  Quiet  ', 10)
        self.assertEqual(snapshot['title'], 'Quiet')

    def test_invitation_rotation_does_not_revoke_existing_members(self):
        """Rotated secrets reject new joins while existing membership stays valid."""
        _, new_secret = manage_invitation(self.room_id, self.host.pk, 'rotate')
        self.assertNotEqual(new_secret, self.secret)
        with self.assertRaises(PracticeError):
            join_room(self.room_id, self.outsider.pk, self.secret)
        self.assertEqual(get_snapshot(self.room_id, self.guest.pk)['room_id'], self.room_id)
        join_room(self.room_id, self.outsider.pk, new_secret)
        model = PracticeRoom.objects.get(pk=self.room_id)
        self.assertNotEqual(model.invitation_hash, new_secret)
        self.assertNotIn(new_secret, str(get_snapshot(self.room_id, self.host.pk)))

    def test_participants_cannot_manage_invites_members_or_timer(self):
        """Being admitted is distinct from holding the host's authority."""
        for action in ('rotate', 'revoke'):
            with self.subTest(action=action), self.assertRaises(PracticeError):
                manage_invitation(self.room_id, self.guest.pk, action)
        with self.assertRaises(PracticeError):
            manage_membership(self.room_id, self.guest.pk, 'revoke', self.host.pk)
        for action in ('start', 'pause', 'resume', 'reset', 'close'):
            with self.subTest(action=action), self.assertRaises(PracticeError):
                apply_command(self.room_id, self.guest.pk, str(uuid4()), 0, action)
        self.assertEqual(RoomCommand.objects.count(), 0)
        self.assertEqual(get_snapshot(self.room_id, self.host.pk)['revision'], 0)

    def test_invalid_command_schema_has_no_durable_side_effects(self):
        """Malformed request identities and JSON values never create command records."""
        for request_id in ('not-a-uuid', str(uuid4()).upper(), str(uuid4()).replace('-', '')):
            with self.subTest(request_id=request_id), self.assertRaises(PracticeError):
                self.command('start', request_id=request_id)
        for revision in (True, -1, '0', 0.0, None, [], {}):
            with self.subTest(revision=revision), self.assertRaises(PracticeError):
                self.command('start', revision=revision)
        for action in ('unknown', None, [], {}):
            with self.subTest(action=action), self.assertRaises(PracticeError):
                self.command(action)
        with self.assertRaises(PracticeError):
            self.command('start', duration=2)
        self.assertEqual(RoomCommand.objects.count(), 0)
        self.assertEqual(get_snapshot(self.room_id, self.host.pk)['revision'], 0)

    def test_retry_preserves_outcome_but_returns_latest_snapshot(self):
        """A late successful retry does not rewind a newer accepted command."""
        request_id = str(uuid4())
        start = self.command('start', request_id=request_id)
        pause = self.command('pause', revision=start.accepted_revision)
        replay = self.command('start', request_id=request_id)
        self.assertTrue(replay.accepted)
        self.assertTrue(replay.replayed)
        self.assertEqual(replay.accepted_revision, start.accepted_revision)
        self.assertEqual(replay.snapshot['revision'], pause.accepted_revision)
        self.assertEqual(replay.snapshot['status'], 'paused')
        self.assertEqual(RoomCommand.objects.count(), 2)

    def test_rejected_command_retry_remains_rejected(self):
        """A previously rejected pause cannot become actionable on a later run."""
        request_id = str(uuid4())
        rejected = self.command('pause', request_id=request_id)
        self.assertFalse(rejected.accepted)
        started = self.command('start')
        replay = self.command('pause', request_id=request_id)
        self.assertFalse(replay.accepted)
        self.assertTrue(replay.replayed)
        self.assertEqual(replay.code, rejected.code)
        self.assertEqual(replay.snapshot['revision'], started.accepted_revision)
        self.assertEqual(replay.snapshot['status'], 'running')

    def test_elapsed_deadline_normalizes_before_a_late_pause(self):
        """Expiry is durable and cannot be undone when no observer was connected."""
        start_time = datetime(2026, 10, 13, 12, tzinfo=UTC)
        with patch('apps.practice.service.timezone.now', return_value=start_time):
            started = self.command('start')
        with patch(
            'apps.practice.service.timezone.now', return_value=start_time + timedelta(minutes=11)
        ):
            late_pause = self.command('pause', revision=started.accepted_revision)
            self.assertFalse(late_pause.accepted)
            self.assertEqual(late_pause.snapshot['status'], 'completed')
            self.assertEqual(late_pause.snapshot['remaining_ms'], 0)
            current = get_snapshot(self.room_id, self.host.pk)
            self.assertEqual(current['revision'], started.accepted_revision + 1)
            self.assertEqual(
                get_snapshot(self.room_id, self.host.pk)['revision'], current['revision']
            )

    def test_close_can_be_retried_but_blocks_new_mutations_and_joins(self):
        """A lost close acknowledgement remains recoverable without reopening a room."""
        request_id = str(uuid4())
        closed = self.command('close', request_id=request_id)
        replay = self.command('close', request_id=request_id)
        self.assertTrue(replay.accepted)
        self.assertTrue(replay.replayed)
        self.assertEqual(replay.snapshot['closed_at'], closed.snapshot['closed_at'])
        for action in ('start', 'reset', 'resume'):
            result = self.command(action, revision=closed.accepted_revision)
            self.assertFalse(result.accepted)
            self.assertEqual(result.code, 'closed')
        with self.assertRaises(PracticeError):
            join_room(self.room_id, self.outsider.pk, self.secret)
        with self.assertRaises(PracticeError):
            manage_invitation(self.room_id, self.host.pk, 'rotate')
