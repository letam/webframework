"""Authenticated room sockets with fresh session checks and reconciliation."""

import asyncio
import hashlib
import hmac
import json
from contextlib import suppress
from importlib import import_module
from uuid import uuid4

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.contrib.auth import get_user
from django.db import DatabaseError
from django.http import HttpRequest
from redis.exceptions import RedisError

from .leases import PracticeLeaseExpiredError, PracticeLeaseStore
from .limits import PracticeRateLimitError, PracticeUnavailableError
from .service import MESSAGES, PracticeError, apply_command, get_snapshot, valid_uuid4


def _session_user(session_key):
    """Reload storage and Django's auth hash; never trust handshake scope.user."""
    if not session_key:
        return None
    store = import_module(settings.SESSION_ENGINE).SessionStore(session_key=session_key)
    store.load()
    request = HttpRequest()
    request.session = store
    user = get_user(request)
    return user.pk if user.is_authenticated and user.is_active else None


def _parse(text_data, bytes_data):
    if bytes_data is not None or not isinstance(text_data, str):
        raise PracticeError('invalid_request')
    if len(text_data.encode('utf-8')) > settings.PRACTICE_MESSAGE_LIMIT:
        raise PracticeError('invalid_request')
    try:

        def unique_pairs(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise PracticeError('invalid_request')
                result[key] = value
            return result

        message = json.loads(text_data, object_pairs_hook=unique_pairs)
    except (ValueError, RecursionError) as exc:
        raise PracticeError('invalid_request') from exc
    if not isinstance(message, dict) or type(message.get('v')) is not int or message['v'] != 1:
        raise PracticeError('invalid_request')
    kind = message.get('type')
    if kind in ('hello', 'heartbeat', 'snapshot'):
        if set(message) != {'v', 'type', 'sync_id'}:
            raise PracticeError('invalid_request')
        valid_uuid4(message['sync_id'])
    elif kind == 'timer.command':
        if set(message) not in (
            {'v', 'type', 'request_id', 'expected_revision', 'action'},
            {'v', 'type', 'request_id', 'expected_revision', 'action', 'duration_minutes'},
        ):
            raise PracticeError('invalid_request')
        valid_uuid4(message['request_id'])
        if (
            type(message['expected_revision']) is not int
            or message['expected_revision'] < 0
            or not isinstance(message['action'], str)
            or message['action'] not in {'start', 'pause', 'resume', 'reset', 'close'}
        ):
            raise PracticeError('invalid_request')
    else:
        raise PracticeError('invalid_request')
    return message


class PracticeConsumer(AsyncJsonWebsocketConsumer):
    """One private room connection; durable state always comes from Postgres."""

    async def __call__(self, scope, receive, send):
        """Bound cleanup even if the channel layer fails while receiving."""
        self._closed = False
        self._accepted = False
        self._joined = False
        self._leased = False
        self._admitted = False
        self._observer = None
        self._lock = asyncio.Lock()
        try:
            await super().__call__(scope, receive, send)
        except PracticeLeaseExpiredError:
            await self._fail('lease_expired', 4408)
        except (RedisError, OSError, TimeoutError, DatabaseError):
            await self._fail('service_unavailable', 4413)
        finally:
            await self._cleanup()

    async def connect(self):
        """Handle connect for practice rooms."""
        if not settings.REALTIME_ENABLED or not settings.PRACTICE_ENABLED:
            await self.close(code=4404)
            return
        origins = [
            value for key, value in self.scope.get('headers', []) if key.lower() == b'origin'
        ]
        try:
            origin = origins[0].decode('ascii') if len(origins) == 1 else ''
        except UnicodeDecodeError:
            origin = ''
        if origin not in settings.PRACTICE_ORIGINS:
            await self.close(code=4403)
            return
        self.room_id = str(self.scope['url_route']['kwargs']['room_id'])
        self.connection_id = str(uuid4())
        self.session_key = getattr(self.scope.get('session'), 'session_key', None)
        self.user_id = await database_sync_to_async(_session_user)(self.session_key)
        if self.user_id is None:
            await self.close(code=4403)
            return
        self.leases = PracticeLeaseStore()
        from apps.presence.consumers import client_address

        self.ip_key = hmac.new(
            settings.SECRET_KEY.encode(), client_address(self.scope).encode(), hashlib.sha256
        ).hexdigest()
        self.group = self.leases.group_name(self.room_id)
        self._hello = False
        self._hello_event = asyncio.Event()
        try:
            await self.leases.check_rate(
                'connect-user', self.user_id, settings.PRACTICE_CONNECT_RATE
            )
            await self.leases.check_rate(
                'connect-ip', self.ip_key, settings.PRACTICE_IP_CONNECT_RATE
            )
            await self.leases.admit(self.connection_id, self.ip_key)
            self._admitted = True
            # Subscription precedes the durable snapshot, so intervening commits
            # are delivered or superseded by the revision in this snapshot.
            await self.channel_layer.group_add(self.group, self.channel_name)
            self._joined = True
            roster = await self.leases.add(self.room_id, self.connection_id, self.user_id)
            self._leased = True
            snapshot = await database_sync_to_async(get_snapshot)(self.room_id, self.user_id)
            if snapshot['closed_at']:
                await self.close(code=4403)
                return
            await self.accept()
            self._accepted = True
            await self.send_json(self._decorate(snapshot, roster))
            await self._publish_presence(roster)
            self._observer = asyncio.create_task(self._observe())
        except PracticeError:
            await self.close(code=4403)
        except PracticeRateLimitError:
            await self._fail('rate_limited', 4413)
        except PracticeUnavailableError:
            await self._fail('service_unavailable', 4413)
        except DatabaseError:
            await self._fail('service_unavailable', 4413)

    def _decorate(self, snapshot, roster, sync_id=None):
        snapshot['presence_sequence'] = roster.sequence
        snapshot['members'] = [
            {**member, 'connected': member['user_id'] in roster.user_ids}
            for member in snapshot['members']
        ]
        if sync_id is not None:
            snapshot['sync_id'] = sync_id
        return snapshot

    async def _fresh_snapshot(self, sync_id=None, *, renew=True):
        if await database_sync_to_async(_session_user)(self.session_key) != self.user_id:
            await self._fail('forbidden', 4403)
            return None
        try:
            snapshot = await database_sync_to_async(get_snapshot)(self.room_id, self.user_id)
        except PracticeError:
            await self._fail('forbidden', 4403)
            return None
        if renew:
            await self.channel_layer.group_add(self.group, self.channel_name)
            await self.leases.refresh_admission(self.connection_id)
            roster = await self.leases.renew(self.room_id, self.connection_id, self.user_id)
        else:
            await self.leases.check_admission(self.connection_id)
            await self.leases.check_lease(self.room_id, self.connection_id, self.user_id)
            roster = await self.leases.observe(self.room_id)
        await self._publish_presence(roster)
        decorated = self._decorate(snapshot, roster, sync_id)
        if snapshot['closed_at']:
            await self.send_json(decorated)
            await self._fail('closed', 4403)
            return None
        return decorated

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        """Handle receive for practice rooms."""
        async with self._lock:
            if self._closed:
                return
            try:
                await self.leases.check_rate(
                    'message-user', self.user_id, settings.PRACTICE_MESSAGE_RATE
                )
                await self.leases.check_rate(
                    'message-ip', self.ip_key, settings.PRACTICE_IP_MESSAGE_RATE
                )
                message = _parse(text_data, bytes_data)
                kind = message['type']
                if kind == 'hello':
                    if self._hello:
                        raise PracticeError('invalid_request')
                    self._hello = True
                    self._hello_event.set()
                elif not self._hello:
                    raise PracticeError('invalid_request')
                if kind == 'timer.command':
                    if (
                        await database_sync_to_async(_session_user)(self.session_key)
                        != self.user_id
                    ):
                        await self._fail('forbidden', 4403)
                        return
                    await self.leases.check_admission(self.connection_id)
                    await self.leases.check_lease(self.room_id, self.connection_id, self.user_id)
                    try:
                        outcome = await database_sync_to_async(apply_command)(
                            self.room_id,
                            self.user_id,
                            message['request_id'],
                            message['expected_revision'],
                            message['action'],
                            message.get('duration_minutes'),
                        )
                    except PracticeError as exc:
                        if exc.code == 'forbidden':
                            await self._fail('forbidden', 4403)
                            return
                        snapshot = await self._fresh_snapshot(renew=False)
                        if snapshot is None:
                            return
                        await self.send_json(
                            {
                                'v': 1,
                                'type': 'command.result',
                                'request_id': message['request_id'],
                                'accepted': False,
                                'code': exc.code,
                                'replayed': False,
                                'accepted_revision': None,
                                'snapshot': snapshot,
                            }
                        )
                        return
                    roster = await self.leases.observe(self.room_id)
                    await self.send_json(
                        {
                            'v': 1,
                            'type': 'command.result',
                            'request_id': message['request_id'],
                            'accepted': outcome.accepted,
                            'code': outcome.code,
                            'replayed': outcome.replayed,
                            'accepted_revision': outcome.accepted_revision,
                            'snapshot': self._decorate(outcome.snapshot, roster),
                        }
                    )
                    if outcome.accepted and not outcome.replayed:
                        await self.channel_layer.group_send(self.group, {'type': 'room.changed'})
                    if outcome.snapshot['closed_at']:
                        await self.close(code=4403)
                        self._closed = True
                else:
                    snapshot = await self._fresh_snapshot(message['sync_id'])
                    if snapshot is not None:
                        await self.send_json(snapshot)
            except PracticeError as exc:
                await self._send_error(exc.code)
            except PracticeRateLimitError:
                await self._fail('rate_limited', 4413)
            except PracticeLeaseExpiredError:
                await self._fail('lease_expired', 4408)
            except (PracticeUnavailableError, RedisError, OSError, TimeoutError, DatabaseError):
                await self._fail('service_unavailable', 4413)

    async def room_changed(self, event):
        """Handle room changed for practice rooms."""
        async with self._lock:
            if self._closed:
                return
            try:
                snapshot = await self._fresh_snapshot(renew=False)
                if snapshot is not None:
                    await self.send_json(snapshot)
            except (PracticeUnavailableError, RedisError, OSError, TimeoutError, DatabaseError):
                await self._fail('service_unavailable', 4413)
            except PracticeLeaseExpiredError:
                await self._fail('lease_expired', 4408)

    async def room_presence(self, event):
        """Handle room presence for practice rooms."""
        async with self._lock:
            if self._closed:
                return
            try:
                snapshot = await self._fresh_snapshot(renew=False)
                if snapshot is None:
                    return
                await self.send_json(
                    {
                        'v': 1,
                        'type': 'room.presence',
                        'sequence': snapshot['presence_sequence'],
                        'membership_revision': snapshot['membership_revision'],
                        'members': snapshot['members'],
                        'server_time': snapshot['server_time'],
                    }
                )
            except (PracticeUnavailableError, RedisError, OSError, TimeoutError, DatabaseError):
                await self._fail('service_unavailable', 4413)
            except PracticeLeaseExpiredError:
                await self._fail('lease_expired', 4408)

    async def _publish_presence(self, roster):
        if roster.changed:
            await self.channel_layer.group_send(self.group, {'type': 'room.presence'})

    async def _observe(self):
        try:
            try:
                await asyncio.wait_for(
                    self._hello_event.wait(), timeout=settings.PRACTICE_HELLO_SECONDS
                )
            except TimeoutError:
                await self._fail('hello_timeout', 4408)
                return
            while not self._closed:
                await asyncio.sleep(settings.PRACTICE_HEARTBEAT_SECONDS)
                async with self._lock:
                    if self._closed:
                        return
                    await self._fresh_snapshot(renew=False)
                    # Refresh group membership independently of lease renewal.
                    await self.channel_layer.group_add(self.group, self.channel_name)
        except asyncio.CancelledError:
            raise
        except (PracticeUnavailableError, RedisError, OSError, TimeoutError, DatabaseError):
            await self._fail('service_unavailable', 4413)
        except PracticeLeaseExpiredError:
            await self._fail('lease_expired', 4408)

    async def _send_error(self, code):
        if self._accepted and not self._closed:
            await self.send_json(
                {
                    'v': 1,
                    'type': 'error',
                    'code': code,
                    'message': MESSAGES.get(code, 'Practice is unavailable.'),
                }
            )

    async def _fail(self, code, close_code):
        if self._closed:
            return
        await self._send_error(code)
        self._closed = True
        await self.close(code=close_code)

    async def disconnect(self, close_code):
        """Handle disconnect for practice rooms."""
        await self._cleanup()

    async def _cleanup(self):
        if getattr(self, '_cleaned', False):
            return
        self._cleaned = True
        self._closed = True
        task = asyncio.create_task(self._cleanup_inner())
        done, _ = await asyncio.wait({task}, timeout=3)
        if task in done:
            with suppress(Exception, asyncio.CancelledError):
                task.result()
        else:
            task.cancel()
            task.add_done_callback(
                lambda finished: finished.exception() if not finished.cancelled() else None
            )

    async def _cleanup_inner(self):
        observer = self._observer
        if observer and observer is not asyncio.current_task():
            observer.cancel()
            await asyncio.wait({observer}, timeout=1)
        if self._leased:
            try:
                roster = await asyncio.wait_for(
                    self.leases.remove(self.room_id, self.connection_id), timeout=2
                )
                await self._publish_presence(roster)
            except (PracticeUnavailableError, RedisError, OSError, TimeoutError):
                pass
        if self._joined:
            with suppress(Exception):
                await asyncio.wait_for(
                    self.channel_layer.group_discard(self.group, self.channel_name), timeout=2
                )
        if self._admitted:
            with suppress(PracticeUnavailableError, TimeoutError):
                await asyncio.wait_for(self.leases.release(self.connection_id), timeout=1)
