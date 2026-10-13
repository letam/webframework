"""Validate explicit realtime configuration without opening network connections."""

import re
from ipaddress import ip_network
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ImproperlyConfigured


def validate_realtime(config):
    """Fail clearly on unsafe or incomplete enabled configuration."""
    if not config['REALTIME_ENABLED']:
        if config['PRESENCE_ENABLED']:
            raise ImproperlyConfigured('PRESENCE_ENABLED requires REALTIME_ENABLED.')
        if config.get('PRACTICE_ENABLED'):
            raise ImproperlyConfigured('PRACTICE_ENABLED requires REALTIME_ENABLED.')
        return
    try:
        redis_url = urlsplit(config['REALTIME_REDIS_URL'])
        _ = redis_url.port
    except ValueError as error:
        raise ImproperlyConfigured(
            'REALTIME_REDIS_URL must have a valid host and port.'
        ) from error
    if redis_url.scheme not in ('redis', 'rediss') or not redis_url.hostname:
        raise ImproperlyConfigured('REALTIME_ENABLED requires a redis:// or rediss:// URL.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', config['REALTIME_PREFIX']):
        raise ImproperlyConfigured('REALTIME_PREFIX must be a short instance namespace.')
    if config.get('PRACTICE_ENABLED'):
        origins = config.get('PRACTICE_ORIGINS')
        if not isinstance(origins, list) or not origins or len(origins) > 100:
            raise ImproperlyConfigured('PRACTICE_ORIGINS requires explicit origins.')
        for origin in origins:
            if not isinstance(origin, str):
                raise ImproperlyConfigured('Practice origins must be strings.')
            try:
                parsed = urlsplit(origin)
                _ = parsed.port
            except ValueError as error:
                raise ImproperlyConfigured('Practice origins require valid ports.') from error
            if (
                parsed.scheme not in ('http', 'https')
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
                or '*' in origin
                or parsed.hostname.startswith('.')
                or (not config['DEBUG'] and parsed.scheme != 'https')
            ):
                raise ImproperlyConfigured('Practice origins must be exact HTTP(S) origins.')
        positive = (
            'PRACTICE_HEARTBEAT_SECONDS',
            'PRACTICE_LEASE_SECONDS',
            'PRACTICE_MAX_ROOM_CONNECTIONS',
            'PRACTICE_MAX_USER_CONNECTIONS',
            'PRACTICE_MAX_MEMBERS',
            'PRACTICE_MAX_CONNECTIONS',
            'PRACTICE_MAX_CONNECTIONS_PER_IP',
            'PRACTICE_IP_MESSAGE_RATE',
            'PRACTICE_IP_CONNECT_RATE',
            'PRACTICE_MESSAGE_LIMIT',
            'PRACTICE_MESSAGE_RATE',
            'PRACTICE_HTTP_RATE',
            'PRACTICE_CONNECT_RATE',
            'PRACTICE_RATE_WINDOW_SECONDS',
        )
        if any(config[name] < 1 for name in positive):
            raise ImproperlyConfigured('Practice limits and intervals must be positive.')
        if config['PRACTICE_HEARTBEAT_SECONDS'] >= config['PRACTICE_LEASE_SECONDS']:
            raise ImproperlyConfigured('Practice heartbeat must be shorter than lease.')
        if config['PRACTICE_MAX_USER_CONNECTIONS'] > config['PRACTICE_MAX_ROOM_CONNECTIONS']:
            raise ImproperlyConfigured('Practice user connection cap exceeds room cap.')
    if not config['PRESENCE_ENABLED']:
        return
    if len(config['PRESENCE_HASH_KEY']) < 32:
        raise ImproperlyConfigured('PRESENCE_HASH_KEY must contain at least 32 characters.')
    if config['PRESENCE_STATS_TOKEN'] and len(config['PRESENCE_STATS_TOKEN']) < 32:
        raise ImproperlyConfigured('PRESENCE_STATS_TOKEN must contain at least 32 characters.')
    scopes = config['PRESENCE_SCOPES']
    if not isinstance(scopes, dict) or not scopes or len(scopes) > 100:
        raise ImproperlyConfigured('PRESENCE_SCOPES must define 1–100 scopes.')
    for name, scope in scopes.items():
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', name):
            raise ImproperlyConfigured('Presence scope names must be short identifiers.')
        if not isinstance(scope, dict):
            raise ImproperlyConfigured('Each presence scope needs an origins list.')
        origins = scope.get('origins')
        if not isinstance(origins, list) or not origins or len(origins) > 100:
            raise ImproperlyConfigured('Each presence scope needs 1–100 explicit origins.')
        for origin in origins:
            if not isinstance(origin, str):
                raise ImproperlyConfigured('Presence origins must be strings.')
            try:
                parsed = urlsplit(origin)
                _ = parsed.port
            except ValueError as error:
                raise ImproperlyConfigured(
                    'Presence origins must have valid hosts and ports.'
                ) from error
            if (
                parsed.scheme not in ('http', 'https')
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
                or '*' in origin
                or parsed.hostname.startswith('.')
            ):
                raise ImproperlyConfigured('Presence origins must be exact HTTP(S) origins.')
            if not config['DEBUG'] and parsed.scheme != 'https':
                raise ImproperlyConfigured('Production presence origins must use HTTPS.')
    try:
        ZoneInfo(config['PRESENCE_TIME_ZONE'])
    except (ZoneInfoNotFoundError, ValueError, TypeError) as error:
        raise ImproperlyConfigured('PRESENCE_TIME_ZONE must be an IANA timezone.') from error
    if config['PRESENCE_PROXY_IP_HEADER'] not in (
        'x-real-ip',
        'fly-client-ip',
        'cf-connecting-ip',
    ):
        raise ImproperlyConfigured('Presence proxy IP header must carry one verified address.')
    try:
        for network in config['PRESENCE_TRUSTED_PROXY_NETWORKS']:
            if ip_network(network).prefixlen == 0:
                raise ValueError('Do not trust every possible peer')
    except (ValueError, TypeError) as error:
        raise ImproperlyConfigured(
            'Presence trusted proxies require explicit peer CIDRs.'
        ) from error
    integer_options = (
        'PRESENCE_RETENTION_DAYS',
        'PRESENCE_LEASE_SECONDS',
        'PRESENCE_HEARTBEAT_SECONDS',
        'PRESENCE_MAX_CONNECTIONS',
        'PRESENCE_MAX_SCOPE_CONNECTIONS',
        'PRESENCE_MAX_CONNECTIONS_PER_IP',
        'PRESENCE_MESSAGE_LIMIT',
        'PRESENCE_MESSAGE_RATE',
        'PRESENCE_IP_MESSAGE_RATE',
        'PRESENCE_CONNECT_RATE',
        'PRESENCE_RATE_WINDOW_SECONDS',
    )
    if any(config[name] < 1 for name in integer_options):
        raise ImproperlyConfigured('Presence limits and intervals must be positive.')
    if config['PRESENCE_RETENTION_DAYS'] > 400:
        raise ImproperlyConfigured('PRESENCE_RETENTION_DAYS cannot exceed 400.')
    if not 0 < config['PRESENCE_HEARTBEAT_SECONDS'] < config['PRESENCE_LEASE_SECONDS']:
        raise ImproperlyConfigured('Presence heartbeat must be shorter than the lease.')
    if config['PRESENCE_OBSERVATION_SECONDS'] <= 0 or config['PRESENCE_HELLO_SECONDS'] <= 0:
        raise ImproperlyConfigured('Presence observation and hello intervals must be positive.')
