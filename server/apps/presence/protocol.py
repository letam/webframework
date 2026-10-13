"""Strict, versioned messages for anonymous functional presence."""

import json
from dataclasses import dataclass
from uuid import UUID

PROTOCOL_VERSION = 1

ERROR_MESSAGES = {
    'invalid_message': 'The presence message is invalid.',
    'unsupported_version': 'The presence protocol version is unsupported.',
    'hello_required': 'Send hello before updating presence.',
    'already_initialized': 'This connection already received hello.',
    'unknown_scope': 'The presence scope is unavailable.',
    'origin_forbidden': 'This origin cannot access the presence scope.',
    'rate_limited': 'Presence requests are too frequent. Reconnect later.',
    'capacity_reached': 'Presence is temporarily at capacity. Reconnect later.',
    'service_unavailable': 'Presence is temporarily unavailable. Reconnect later.',
    'hello_timeout': 'The presence handshake timed out.',
    'lease_expired': 'The presence lease expired. Reconnect to resume.',
}


class ProtocolError(ValueError):
    """Carry a public error code without retaining the submitted payload."""

    def __init__(self, code='invalid_message'):
        """Initialize the error from a stable, public code."""
        self.code = code
        super().__init__(ERROR_MESSAGES[code])


@dataclass(frozen=True)
class Hello:
    """A validated hello, whose raw visitor ID must not be persisted or logged."""

    scope: str
    analytics: bool
    visible: bool
    visitor_id: str | None


def _unique_object(pairs):
    """Reject duplicate JSON keys rather than silently replacing their values."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError()
        result[key] = value
    return result


def parse_message(text, *, limit):
    """Validate exact message fields, types, UUIDs, version and UTF-8 size."""
    if not isinstance(text, str) or len(text.encode('utf-8')) > limit:
        raise ProtocolError()
    try:
        message = json.loads(text, object_pairs_hook=_unique_object)
    except (ValueError, RecursionError) as exc:
        raise ProtocolError() from exc
    if not isinstance(message, dict):
        raise ProtocolError()
    if type(message.get('v')) is not int:
        raise ProtocolError()
    if message['v'] != PROTOCOL_VERSION:
        raise ProtocolError('unsupported_version')
    message_type = message.get('type')
    if message_type in ('heartbeat', 'inactive'):
        if set(message) != {'v', 'type'}:
            raise ProtocolError()
        return message_type
    if message_type != 'hello':
        raise ProtocolError()
    fields = {'v', 'type', 'scope', 'analytics', 'visible'}
    if type(message.get('analytics')) is not bool or type(message.get('visible')) is not bool:
        raise ProtocolError()
    if message['analytics']:
        fields.add('visitor_id')
    if set(message) != fields:
        raise ProtocolError()
    scope = message['scope']
    if not isinstance(scope, str) or not 1 <= len(scope) <= 64:
        raise ProtocolError()
    visitor_id = message.get('visitor_id')
    if visitor_id is not None:
        if not isinstance(visitor_id, str):
            raise ProtocolError()
        try:
            identifier = UUID(visitor_id)
        except (ValueError, AttributeError) as exc:
            raise ProtocolError() from exc
        if identifier.version != 4 or str(identifier) != visitor_id:
            raise ProtocolError()
    return Hello(scope, message['analytics'], message['visible'], visitor_id)


def error_message(code):
    """Return a safe public error envelope."""
    return {'v': PROTOCOL_VERSION, 'type': 'error', 'code': code, 'message': ERROR_MESSAGES[code]}
