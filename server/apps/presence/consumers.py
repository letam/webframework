"""Anonymous presence with shared leases, bounded sockets and explicit recovery."""

import asyncio
import ipaddress
from contextlib import suppress
from time import monotonic
from uuid import uuid4

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.db import DatabaseError
from redis.exceptions import RedisError

from .leases import PresenceLeaseStore, PresenceLimitError, PresenceUnavailableError, hash_ip
from .protocol import Hello, ProtocolError, error_message, parse_message
from .statistics import hash_visitor, local_day, record_peak, record_visit


def client_address(scope):
    """Trust a single proxy IP only when its transport peer is explicitly trusted."""
    client = scope.get('client')
    try:
        peer = ipaddress.ip_address(client[0]) if client else None
    except ValueError:
        peer = None
    if peer is None:
        return 'unknown'
    trusted = any(
        peer in ipaddress.ip_network(network, strict=False)
        for network in getattr(settings, 'PRESENCE_TRUSTED_PROXY_NETWORKS', [])
    )
    header = getattr(settings, 'PRESENCE_PROXY_IP_HEADER', 'fly-client-ip')
    if not trusted or header not in {'fly-client-ip', 'x-real-ip', 'cf-connecting-ip'}:
        return str(peer)
    values = [value for key, value in scope.get('headers', []) if key.lower() == header.encode()]
    if len(values) != 1:
        return str(peer)
    try:
        return str(ipaddress.ip_address(values[0].decode('ascii').strip()))
    except (UnicodeDecodeError, ValueError):
        return str(peer)


class PresenceConsumer(AsyncJsonWebsocketConsumer):
    """Treat visibility and lease renewal as activity, never socket connectivity."""

    cleanup_timeout = 3
    observer_cancel_timeout = 1

    async def __call__(self, scope, receive, send):
        """Clean up poll tasks and handle a failed channel-layer receive loop."""
        self._closed = False
        self._cleaned = False
        self._cleanup_task = None
        self._accepted = False
        self._observer_task = None
        self._presence_scope = None
        self._admitted = False
        self._joined = False
        self._operation_lock = asyncio.Lock()
        try:
            await super().__call__(scope, receive, send)
        except (RedisError, OSError, TimeoutError):
            await self._fail('service_unavailable')
        finally:
            await self._cleanup()

    async def connect(self):
        """Reserve a server-assigned connection before accepting the handshake."""
        if not settings.REALTIME_ENABLED or not settings.PRESENCE_ENABLED:
            await self.close(code=4404)
            return
        self.connection_id = str(uuid4())
        self._last_message = monotonic()
        self._hello_deadline = self._last_message + getattr(settings, 'PRESENCE_HELLO_SECONDS', 10)
        self._last_sequence = -1
        self._analytics = False
        self._visible = False
        self._visited_day = None
        self._analytics_available = True
        self._peak_retry_at = 0
        self._ip_key = hash_ip(client_address(self.scope))
        self.leases = PresenceLeaseStore()
        try:
            await self.leases.admit(self.connection_id, self._ip_key)
            self._admitted = True
            await self.accept()
            self._accepted = True
            self._observer_task = asyncio.create_task(self._observe())
        except PresenceLimitError as exc:
            await self._fail(exc.code)
        except PresenceUnavailableError:
            await self._fail('service_unavailable')

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        """Reject oversized, binary or invalid messages before mutating a lease."""
        async with self._operation_lock:
            if self._closed:
                return
            try:
                if bytes_data is not None:
                    raise ProtocolError()
                message = parse_message(text_data, limit=settings.PRESENCE_MESSAGE_LIMIT)
                await self.leases.check_message_rate(self.connection_id, self._ip_key)
                if isinstance(message, Hello):
                    if self._presence_scope is not None:
                        raise ProtocolError('already_initialized')
                    await self._hello(message)
                else:
                    if self._presence_scope is None:
                        raise ProtocolError('hello_required')
                    await self.leases.refresh_admission(self.connection_id)
                    if message == 'heartbeat':
                        await self._group_add()
                        self._visible = True
                        snapshot = await self.leases.renew(
                            self._presence_scope, self.connection_id, self._visitor_key
                        )
                    else:
                        self._visible = False
                        snapshot = await self.leases.remove(
                            self._presence_scope, self.connection_id
                        )
                    await self._statistics(snapshot)
                    await self._publish(snapshot)
                    await self._send_snapshot(snapshot, force=True)
                self._last_message = monotonic()
            except (ProtocolError, PresenceLimitError) as exc:
                await self._fail(exc.code)
            except (PresenceUnavailableError, DatabaseError):
                await self._fail('service_unavailable')

    async def _hello(self, hello):
        scopes = settings.PRESENCE_SCOPES
        if hello.scope not in scopes:
            raise ProtocolError('unknown_scope')
        headers = {}
        origins = []
        for key, value in self.scope.get('headers', []):
            lower_key = key.lower()
            if lower_key == b'origin':
                origins.append(value)
            headers.setdefault(lower_key, []).append(value)
        try:
            origin = origins[0].decode('ascii') if len(origins) == 1 else ''
        except UnicodeDecodeError as exc:
            raise ProtocolError('origin_forbidden') from exc
        if not origin or origin not in scopes[hello.scope].get('origins', []):
            raise ProtocolError('origin_forbidden')
        privacy_requested = b'1' in headers.get(b'dnt', []) or b'1' in headers.get(b'sec-gpc', [])
        self._analytics = hello.analytics and not privacy_requested
        identity = hello.visitor_id if self._analytics else str(uuid4())
        # Only the keyed hash survives hello; the raw browser UUID is never
        # stored in Redis, a model, a log, or a public response.
        self._visitor_key = hash_visitor(hello.scope, identity)
        await self.leases.bind_scope(self.connection_id, hello.scope)
        self._presence_scope = hello.scope
        await self._group_add()
        self._visible = hello.visible
        if hello.visible:
            snapshot = await self.leases.renew(hello.scope, self.connection_id, self._visitor_key)
        else:
            snapshot = await self.leases.observe(hello.scope)
        await self._statistics(snapshot)
        await self._publish(snapshot)
        await self._send_snapshot(snapshot, force=True)

    async def _group_add(self):
        if self.channel_layer is None:
            raise PresenceUnavailableError()
        try:
            await self.channel_layer.group_add(
                self.leases.group_name(self._presence_scope), self.channel_name
            )
            self._joined = True
        except Exception as exc:
            raise PresenceUnavailableError() from exc

    async def _publish(self, snapshot):
        if not snapshot.changed:
            return
        try:
            await self.channel_layer.group_send(
                self.leases.group_name(self._presence_scope),
                {'type': 'presence.update', 'snapshot': snapshot.message()},
            )
        except Exception as exc:
            raise PresenceUnavailableError() from exc

    async def _send_snapshot(self, snapshot, *, force=False):
        if force or snapshot.sequence > self._last_sequence:
            message = snapshot.message()
            message['analytics_available'] = self._analytics_available
            await self.send_json(message)
            self._last_sequence = max(self._last_sequence, snapshot.sequence)

    async def presence_update(self, event):
        """Ignore late broadcasts; the next heartbeat/observation repairs drops."""
        async with self._operation_lock:
            if self._closed or self._presence_scope is None:
                return
            snapshot = event['snapshot']
            if snapshot['sequence'] > self._last_sequence:
                await self.send_json(
                    {**snapshot, 'analytics_available': self._analytics_available}
                )
                self._last_sequence = snapshot['sequence']

    async def _statistics(self, snapshot, *, record_daily=True):
        if record_daily:
            self._analytics_available = True
        day = local_day(snapshot.server_time).isoformat()
        if record_daily and self._analytics and self._visible and day != self._visited_day:
            if not await self.leases.visit_acknowledged(
                self._presence_scope, self._visitor_key, day
            ):
                try:
                    result = await database_sync_to_async(record_visit)(
                        self._presence_scope, self._visitor_key, now=snapshot.server_time
                    )
                except DatabaseError:
                    self._analytics_available = False
                else:
                    await self.leases.acknowledge_visit(
                        self._presence_scope, self._visitor_key, result['day']
                    )
                    self._visited_day = day
            else:
                self._visited_day = day
        if monotonic() < self._peak_retry_at:
            self._analytics_available = False
            return
        claim = await self.leases.claim_peak(self._presence_scope, snapshot.count, day)
        while claim:
            try:
                await database_sync_to_async(record_peak)(
                    self._presence_scope, claim.count, now=snapshot.server_time
                )
            except DatabaseError:
                self._analytics_available = False
                self._peak_retry_at = monotonic() + settings.PRESENCE_HEARTBEAT_SECONDS
                # Retain the bounded claim until expiry so a database outage
                # cannot turn every observer into a peak-write retry loop.
                break
            else:
                pending = await self.leases.acknowledge_peak(
                    self._presence_scope, claim.count, day, claim.token
                )
                claim = (
                    await self.leases.claim_peak(self._presence_scope, 0, day) if pending else None
                )

    async def _observe(self):
        """Expire idle sockets and publish lease expiry without needing a new join."""
        try:
            while not self._closed:
                await asyncio.sleep(getattr(settings, 'PRESENCE_OBSERVATION_SECONDS', 3))
                async with self._operation_lock:
                    if self._closed:
                        return
                    now = monotonic()
                    if self._presence_scope is None and now >= self._hello_deadline:
                        await self._fail('hello_timeout')
                        return
                    if now - self._last_message >= settings.PRESENCE_LEASE_SECONDS:
                        await self._fail('lease_expired')
                        return
                    if self._presence_scope is not None:
                        snapshot = await self.leases.observe(self._presence_scope)
                        await self._statistics(snapshot, record_daily=False)
                        await self._publish(snapshot)
                        await self._send_snapshot(snapshot)
        except asyncio.CancelledError:
            raise
        except (PresenceUnavailableError, DatabaseError):
            await self._fail('service_unavailable')

    async def _fail(self, code):
        if self._closed:
            return
        self._closed = True
        if not self._accepted:
            await self.accept()
            self._accepted = True
        retryable = {'service_unavailable', 'rate_limited', 'capacity_reached'}
        try:
            await self.send_json(error_message(code))
        finally:
            try:
                # Closing cannot wait for failed Redis or a cancelled observer.
                # The browser must be able to clear its count and reconnect.
                await self.close(code=4413 if code in retryable else 4408)
            finally:
                await self._cleanup()

    async def disconnect(self, close_code):
        """Cancel observation and release this connection, preserving other tabs."""
        self._closed = True
        await self._cleanup()

    async def _cleanup(self):
        if self._cleanup_task is None:
            self._cleaned = True
            observer = self._observer_task
            self._observer_task = None
            initiator = asyncio.current_task()
            self._cleanup_task = asyncio.create_task(self._cleanup_state(observer, initiator))
        # A disconnect and the observer may both initiate cleanup. Share its
        # bounded lifetime; cancelling either caller must not cancel cleanup.
        await asyncio.shield(self._cleanup_task)

    async def _cleanup_state(self, observer, initiator):
        try:
            async with asyncio.timeout(self.cleanup_timeout):
                if observer is not None and observer is not initiator:
                    observer.cancel()
                    # Cancellation may itself wait for a database adapter or a
                    # lock held by this receive handler. Never await it forever.
                    done, _ = await asyncio.wait({observer}, timeout=self.observer_cancel_timeout)
                    if done:
                        with suppress(asyncio.CancelledError):
                            observer.result()
                    else:
                        observer.add_done_callback(self._observer_finished)
                elif observer is not None:
                    # This observer is awaiting the cleanup task itself. It
                    # returns naturally as soon as the bounded cleanup finishes.
                    observer.add_done_callback(self._observer_finished)
                if self._presence_scope is not None:
                    with suppress(PresenceUnavailableError, PresenceLimitError):
                        snapshot = await self.leases.remove(
                            self._presence_scope, self.connection_id
                        )
                        await self._publish(snapshot)
                if self._admitted:
                    with suppress(PresenceUnavailableError, PresenceLimitError):
                        await self.leases.release(self.connection_id)
                if self._joined:
                    with suppress(Exception):
                        await self.channel_layer.group_discard(
                            self.leases.group_name(self._presence_scope), self.channel_name
                        )
        except TimeoutError:
            # Shared-state cleanup is best effort; expiry remains authoritative
            # when Redis or the channel layer cannot finish within the budget.
            pass

    @staticmethod
    def _observer_finished(observer):
        with suppress(asyncio.CancelledError):
            observer.exception()
