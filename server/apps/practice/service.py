"""All durable timer and membership mutations serialize on the room row."""

import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, timedelta
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import PracticeRoom, RoomCommand, RoomMembership

MESSAGES = {
    'invalid_request': 'The request is invalid.',
    'not_found': 'This room is unavailable.',
    'forbidden': 'You cannot access this room.',
    'host_only': 'Only the host can do that.',
    'host_cannot_leave': 'The host can close the room instead.',
    'closed': 'This room is closed.',
    'invalid_invitation': 'The invitation is invalid or expired.',
    'revision_conflict': 'The room changed. Refresh and try again.',
    'invalid_transition': 'That action is unavailable in the current state.',
    'request_id_reused': 'This request ID was already used.',
    'capacity_reached': 'This room is full.',
    'rate_limited': 'Practice requests are too frequent. Reconnect later.',
    'service_unavailable': 'Practice is temporarily unavailable. Reconnect later.',
    'lease_expired': 'The connection expired. Reconnect to resume.',
    'hello_timeout': 'The room handshake timed out. Reconnect to resume.',
}


class PracticeError(ValueError):
    """Carry a safe code and status across service and transport layers."""

    def __init__(self, code, status=400):
        """Carry a stable code and safe HTTP status to the transport."""
        self.code = code
        self.status = status
        super().__init__(MESSAGES[code])


@dataclass(frozen=True)
class CommandOutcome:
    """Report the stored decision with a freshly read room snapshot."""

    accepted: bool
    code: str
    replayed: bool
    accepted_revision: int | None
    snapshot: dict


def iso(value):
    """Serialize UTC datetimes for the versioned JSON protocol."""
    return value.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def valid_uuid4(value):
    """Accept only canonical UUID4 request IDs."""
    if not isinstance(value, str):
        raise PracticeError('invalid_request')
    try:
        result = UUID(value)
    except (TypeError, ValueError, AttributeError) as exc:
        raise PracticeError('invalid_request') from exc
    if result.version != 4 or str(result) != value:
        raise PracticeError('invalid_request')
    return result


def validate_duration(value):
    """Bound an explicit duration to one through 120 whole minutes."""
    if type(value) is not int or not 1 <= value <= 120:
        raise PracticeError('invalid_request')
    return value * 60_000


def _hash_invitation(secret):
    return hashlib.sha256(secret.encode('ascii')).hexdigest()


def _new_invitation(room):
    secret = secrets.token_urlsafe(32)
    room.invitation_hash = _hash_invitation(secret)
    return secret


def _normalize(room, now):
    if room.status == 'running' and room.deadline <= now:
        room.status = 'completed'
        room.remaining_ms = 0
        room.deadline = None
        room.revision += 1
        room.save(update_fields=['status', 'remaining_ms', 'deadline', 'revision', 'updated_at'])
        return True
    return False


def _membership(room, user_id):
    if not RoomMembership.objects.filter(
        room=room, user_id=user_id, revoked_at__isnull=True
    ).exists():
        raise PracticeError('forbidden', 403)


def _snapshot(room, user_id, now):
    remaining = room.remaining_ms
    if room.status == 'running':
        remaining = max(0, int((room.deadline - now).total_seconds() * 1000))
    members = [
        {
            'user_id': item.user_id,
            'username': item.user.username,
            'is_host': item.user_id == room.host_id,
            'connected': False,
        }
        for item in RoomMembership.objects.filter(room=room, revoked_at__isnull=True)
        .select_related('user')
        .order_by('joined_at', 'user_id')
    ]
    return {
        'v': 1,
        'type': 'room.snapshot',
        'room_id': str(room.id),
        'title': room.title,
        'host_id': room.host_id,
        'current_user_id': user_id,
        'is_host': user_id == room.host_id,
        'closed_at': iso(room.closed_at) if room.closed_at else None,
        'duration_ms': room.duration_ms,
        'run_id': room.run_id,
        'status': room.status,
        'remaining_ms': remaining,
        'deadline': iso(room.deadline) if room.deadline else None,
        'revision': room.revision,
        'membership_revision': room.membership_revision,
        'server_time': iso(now),
        'members': members,
        'presence_sequence': 0,
        'heartbeat_seconds': settings.PRACTICE_HEARTBEAT_SECONDS,
        'lease_seconds': settings.PRACTICE_LEASE_SECONDS,
    }


@transaction.atomic
def create_room(user_id, title, duration_minutes=10):
    """Create a host membership and single-use secret response atomically."""
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
        raise PracticeError('invalid_request')
    duration = validate_duration(duration_minutes)
    room = PracticeRoom(
        title=title.strip(),
        host_id=user_id,
        duration_ms=duration,
        remaining_ms=duration,
        membership_revision=1,
    )
    secret = _new_invitation(room)
    room.save()
    RoomMembership.objects.create(room=room, user_id=user_id)
    return _snapshot(room, user_id, timezone.now()), secret


@transaction.atomic
def get_snapshot(room_id, user_id):
    """Return authorized state after normalizing an expired deadline."""
    room = PracticeRoom.objects.select_for_update().filter(id=room_id).first()
    if room is None:
        raise PracticeError('not_found', 404)
    _membership(room, user_id)
    now = timezone.now()
    _normalize(room, now)
    return _snapshot(room, user_id, now)


@transaction.atomic
def join_room(room_id, user_id, secret):
    """Exchange a live invitation secret for durable membership."""
    room = PracticeRoom.objects.select_for_update().filter(id=room_id).first()
    if room is None:
        raise PracticeError('not_found', 404)
    now = timezone.now()
    _normalize(room, now)
    if room.closed_at:
        raise PracticeError('closed', 409)
    if not isinstance(secret, str) or not 32 <= len(secret) <= 128 or not secret.isascii():
        raise PracticeError('invalid_invitation', 403)
    if not room.invitation_hash or not hmac.compare_digest(
        room.invitation_hash, _hash_invitation(secret)
    ):
        raise PracticeError('invalid_invitation', 403)
    if not RoomMembership.objects.filter(
        room=room, revoked_at__isnull=True, user_id=user_id
    ).exists():
        active = RoomMembership.objects.filter(room=room, revoked_at__isnull=True).count()
        if active >= settings.PRACTICE_MAX_MEMBERS:
            raise PracticeError('capacity_reached', 409)
    membership, created = RoomMembership.objects.get_or_create(room=room, user_id=user_id)
    if membership.revocation_reason == 'host':
        # A host revocation must not be defeated by an old or newly shared invitation.
        raise PracticeError('forbidden', 403)
    rejoining = membership.revoked_at is not None
    if rejoining:
        membership.revoked_at = None
        membership.revocation_reason = ''
        membership.save(update_fields=['revoked_at', 'revocation_reason'])
    if created or rejoining:
        room.membership_revision += 1
        room.save(update_fields=['membership_revision', 'updated_at'])
    return _snapshot(room, user_id, now)


@transaction.atomic
def manage_membership(room_id, user_id, action, target_id=None):
    """Leave voluntarily or revoke a participant under the room lock."""
    room = PracticeRoom.objects.select_for_update().filter(id=room_id).first()
    if room is None:
        raise PracticeError('not_found', 404)
    _membership(room, user_id)
    now = timezone.now()
    _normalize(room, now)
    if action == 'leave':
        if user_id == room.host_id:
            raise PracticeError('host_cannot_leave', 403)
        target_id = user_id
    else:
        if user_id != room.host_id:
            raise PracticeError('host_only', 403)
        if target_id == room.host_id:
            raise PracticeError('invalid_request')
    updated = RoomMembership.objects.filter(
        room=room, user_id=target_id, revoked_at__isnull=True
    ).update(revoked_at=now, revocation_reason='leave' if action == 'leave' else 'host')
    if not updated:
        raise PracticeError('not_found', 404)
    room.membership_revision += 1
    room.save(update_fields=['membership_revision', 'updated_at'])
    return _snapshot(room, user_id, now) if action != 'leave' else None


@transaction.atomic
def manage_invitation(room_id, user_id, action):
    """Rotate or revoke the current invitation without removing members."""
    room = PracticeRoom.objects.select_for_update().filter(id=room_id).first()
    if room is None:
        raise PracticeError('not_found', 404)
    _membership(room, user_id)
    if user_id != room.host_id:
        raise PracticeError('host_only', 403)
    if room.closed_at:
        raise PracticeError('closed', 409)
    secret = _new_invitation(room) if action == 'rotate' else None
    if action == 'revoke':
        room.invitation_hash = ''
    room.save(update_fields=['invitation_hash'])
    return _snapshot(room, user_id, timezone.now()), secret


@transaction.atomic
def apply_command(room_id, user_id, request_id, expected_revision, action, duration_minutes=None):
    """Serialize, deduplicate and record one host timer command."""
    room = PracticeRoom.objects.select_for_update().filter(id=room_id).first()
    if room is None:
        raise PracticeError('not_found', 404)
    _membership(room, user_id)
    if user_id != room.host_id:
        raise PracticeError('host_only', 403)
    request_uuid = valid_uuid4(request_id)
    if (
        type(expected_revision) is not int
        or expected_revision < 0
        or not isinstance(action, str)
        or action not in {'start', 'pause', 'resume', 'reset', 'close'}
    ):
        raise PracticeError('invalid_request')
    if action != 'reset' and duration_minutes is not None:
        raise PracticeError('invalid_request')
    duration = validate_duration(duration_minutes) if duration_minutes is not None else None
    payload = {
        'action': action,
        'expected_revision': expected_revision,
        'duration_minutes': duration_minutes,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
    ).hexdigest()
    now = timezone.now()
    _normalize(room, now)
    previous = RoomCommand.objects.filter(room=room, request_id=request_uuid).first()
    if previous:
        if previous.user_id != user_id or not hmac.compare_digest(previous.payload_hash, digest):
            raise PracticeError('request_id_reused', 409)
        return CommandOutcome(
            previous.accepted,
            previous.code,
            True,
            previous.accepted_revision,
            _snapshot(room, user_id, now),
        )
    accepted = False
    code = 'ok'
    if room.closed_at:
        code = 'closed'
    elif room.revision != expected_revision:
        code = 'revision_conflict'
    elif action == 'start' and room.status == 'ready':
        room.status = 'running'
        room.deadline = now + timedelta(milliseconds=room.remaining_ms)
        accepted = True
    elif action == 'pause' and room.status == 'running':
        room.remaining_ms = max(0, int((room.deadline - now).total_seconds() * 1000))
        room.deadline = None
        room.status = 'paused'
        accepted = True
    elif action == 'resume' and room.status == 'paused':
        room.deadline = now + timedelta(milliseconds=room.remaining_ms)
        room.status = 'running'
        accepted = True
    elif action == 'reset':
        if duration is not None:
            room.duration_ms = duration
        room.run_id += 1
        room.remaining_ms = room.duration_ms
        room.deadline = None
        room.status = 'ready'
        accepted = True
    elif action == 'close':
        room.closed_at = now
        room.invitation_hash = ''
        accepted = True
    else:
        code = 'invalid_transition'
    if accepted:
        room.revision += 1
        room.save()
    RoomCommand.objects.create(
        room=room,
        user_id=user_id,
        request_id=request_uuid,
        payload_hash=digest,
        accepted=accepted,
        code=code,
        accepted_revision=room.revision if accepted else None,
    )
    return CommandOutcome(
        accepted, code, False, room.revision if accepted else None, _snapshot(room, user_id, now)
    )
