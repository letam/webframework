"""DRF throttles keyed on the real client IP behind Fly's proxy.

DRF's stock throttles derive the client identity from ``X-Forwarded-For`` via
``NUM_PROXIES``. With ``NUM_PROXIES`` unset, ``get_ident`` buckets on the *entire*
client-supplied header, so rotating ``X-Forwarded-For`` gives a fresh bucket per
request and the anon/scoped limits never trip. Even with ``NUM_PROXIES`` set, the
XFF path assumes an exact proxy-hop count.

These subclasses sidestep both by reusing ``apps.ratelimit.get_client_ip``, which
trusts Fly's ``Fly-Client-IP`` header (set by the proxy, not the client) and falls
back to ``REMOTE_ADDR`` — the same identity the plain-Django limiter uses, so both
throttle layers now agree on who a client is.
"""

from rest_framework.throttling import (
    AnonRateThrottle,
    ScopedRateThrottle,
    UserRateThrottle,
)

from apps.ratelimit import get_client_ip


class FlyClientIpMixin:
    """Identify a client by ``get_client_ip`` instead of the raw ``X-Forwarded-For``."""

    def get_ident(self, request):
        """Return the proxy-trusted client IP as the throttle identity."""
        return get_client_ip(request)


class IpAnonRateThrottle(FlyClientIpMixin, AnonRateThrottle):
    """Anon throttle bucketed on the Fly-trusted client IP."""


class IpUserRateThrottle(FlyClientIpMixin, UserRateThrottle):
    """User throttle whose anonymous fallback uses the Fly-trusted client IP."""


class IpScopedRateThrottle(FlyClientIpMixin, ScopedRateThrottle):
    """Scoped throttle bucketed on the Fly-trusted client IP."""
