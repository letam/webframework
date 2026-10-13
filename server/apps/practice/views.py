"""CSRF-protected session API for private practice rooms."""

import json

from django.conf import settings
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect

from .limits import PracticeRateLimitError, PracticeUnavailableError, check_rate
from .service import (
    MESSAGES,
    PracticeError,
    create_room,
    get_snapshot,
    join_room,
    manage_invitation,
    manage_membership,
)


def _error(code, status):
    return JsonResponse(
        {'code': code, 'message': MESSAGES.get(code, 'The service is unavailable.')}, status=status
    )


def _body(request):
    if len(request.body) > 2048:
        raise PracticeError('invalid_request')
    try:

        def unique_pairs(pairs):
            """Reject ambiguous duplicate keys in client JSON."""
            result = {}
            for key, value in pairs:
                if key in result:
                    raise PracticeError('invalid_request')
                result[key] = value
            return result

        value = json.loads(request.body, object_pairs_hook=unique_pairs) if request.body else {}
    except (UnicodeDecodeError, ValueError) as exc:
        raise PracticeError('invalid_request') from exc
    if not isinstance(value, dict):
        raise PracticeError('invalid_request')
    return value


def _handle(request, operation, *, method='POST', rate=True):
    if not settings.PRACTICE_ENABLED:
        return _error('not_found', 404)
    if request.method != method:
        return _error('invalid_request', 405)
    if not request.user.is_authenticated or not request.user.is_active:
        return _error('forbidden', 403)
    try:
        if rate:
            check_rate('http', request.user.pk, settings.PRACTICE_HTTP_RATE)
        return operation(request.user.pk)
    except PracticeError as exc:
        return _error(exc.code, exc.status)
    except PracticeRateLimitError:
        return JsonResponse(
            {'code': 'rate_limited', 'message': 'Too many requests. Try again shortly.'},
            status=429,
        )
    except PracticeUnavailableError:
        return JsonResponse(
            {'code': 'service_unavailable', 'message': 'Practice is temporarily unavailable.'},
            status=503,
        )
    except DatabaseError:
        return JsonResponse(
            {'code': 'service_unavailable', 'message': 'Practice is temporarily unavailable.'},
            status=503,
        )


@never_cache
def capabilities(request):
    """Expose whether rooms are enabled without requiring a session."""
    if request.method != 'GET':
        return _error('invalid_request', 405)
    return JsonResponse({'enabled': bool(settings.PRACTICE_ENABLED)})


@never_cache
@csrf_protect
def rooms(request):
    """Create a room with the authenticated host as its first member."""

    def operation(user_id):
        """Validate the JSON body before applying the authorized mutation."""
        data = _body(request)
        if set(data) - {'title', 'duration_minutes'}:
            raise PracticeError('invalid_request')
        snapshot, secret = create_room(
            user_id, data.get('title'), data.get('duration_minutes', 10)
        )
        return JsonResponse({'snapshot': snapshot, 'invitation_secret': secret}, status=201)

    return _handle(request, operation)


@never_cache
def room(request, room_id):
    """Return a current snapshot to a persisted member."""
    return _handle(
        request, lambda user_id: JsonResponse(get_snapshot(room_id, user_id)), method='GET'
    )


@never_cache
@csrf_protect
def join(request, room_id):
    """Exchange a CSRF-protected invitation for membership."""

    def operation(user_id):
        """Validate the JSON body before applying the authorized mutation."""
        data = _body(request)
        if set(data) != {'invitation_secret'}:
            raise PracticeError('invalid_request')
        return JsonResponse(join_room(room_id, user_id, data['invitation_secret']))

    return _handle(request, operation)


@never_cache
@csrf_protect
def leave(request, room_id):
    """Allow a participant to leave without stopping the timer."""

    def operation(user_id):
        """Validate the JSON body before applying the authorized mutation."""
        if _body(request):
            raise PracticeError('invalid_request')
        manage_membership(room_id, user_id, 'leave')
        return JsonResponse({'left': True})

    return _handle(request, operation)


@never_cache
@csrf_protect
def rotate(request, room_id):
    """Return a new invitation only to the room host."""

    def operation(user_id):
        """Validate the JSON body before applying the authorized mutation."""
        if _body(request):
            raise PracticeError('invalid_request')
        snapshot, secret = manage_invitation(room_id, user_id, 'rotate')
        return JsonResponse({'snapshot': snapshot, 'invitation_secret': secret})

    return _handle(request, operation)


@never_cache
@csrf_protect
def revoke_invitation(request, room_id):
    """Disable future joins while retaining current memberships."""

    def operation(user_id):
        """Validate the JSON body before applying the authorized mutation."""
        if _body(request):
            raise PracticeError('invalid_request')
        snapshot, _ = manage_invitation(room_id, user_id, 'revoke')
        return JsonResponse(snapshot)

    return _handle(request, operation)


@never_cache
@csrf_protect
def revoke_member(request, room_id, member_id):
    """Ban a member from reconnecting or rejoining with an invite."""

    def operation(user_id):
        """Validate the JSON body before applying the authorized mutation."""
        if _body(request):
            raise PracticeError('invalid_request')
        return JsonResponse(manage_membership(room_id, user_id, 'revoke', member_id))

    return _handle(request, operation)
