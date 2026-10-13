"""Postgres-backed practice state; Redis only holds ephemeral connections."""

import uuid

from django.conf import settings
from django.db import models


class PracticeRoom(models.Model):
    """Persist the authoritative timer, invitation hash and revision."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=120)
    host = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    invitation_hash = models.CharField(max_length=64, blank=True)
    duration_ms = models.PositiveIntegerField(default=600000)
    run_id = models.PositiveBigIntegerField(default=1)
    status = models.CharField(max_length=12, default='ready')
    remaining_ms = models.PositiveIntegerField(default=600000)
    deadline = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=0)
    membership_revision = models.PositiveBigIntegerField(default=0)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        """Name the room without disclosing its invitation."""
        return self.title


class RoomMembership(models.Model):
    """Record durable membership and distinguish leaving from a host ban."""

    room = models.ForeignKey(PracticeRoom, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revocation_reason = models.CharField(max_length=12, blank=True)

    class Meta:
        """Enforce one durable record per room identity."""

        constraints = [
            models.UniqueConstraint(fields=['room', 'user'], name='practice_one_member')
        ]

    def __str__(self):
        """Identify a membership in administrative views."""
        return f'{self.room_id}:{self.user_id}'


class RoomCommand(models.Model):
    """Retain command outcomes so retries cannot mutate a room twice."""

    room = models.ForeignKey(PracticeRoom, on_delete=models.CASCADE, related_name='commands')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_id = models.UUIDField()
    payload_hash = models.CharField(max_length=64)
    accepted = models.BooleanField()
    code = models.CharField(max_length=40)
    accepted_revision = models.PositiveBigIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Enforce one durable record per room identity."""

        constraints = [
            models.UniqueConstraint(fields=['room', 'request_id'], name='practice_command_id')
        ]

    def __str__(self):
        """Identify a command without its payload."""
        return str(self.request_id)
