# Presence and practice implementation

Implemented capabilities: optional Channels/Daphne infrastructure, anonymous
presence with private daily visitor statistics, and durable practice room APIs.
The reading-page client and its privacy copy are a separate repository integration.
This document is the kit's source for the implemented protocols.

## Instance capabilities

HTTP-only instances keep their existing Gunicorn, SQLite, API, session authentication
and background-task behavior. `REALTIME_ENABLED` and `PRESENCE_ENABLED` both default
to false. Installing dependencies and applying the presence migration does not
require Redis. Disabled socket handshakes are rejected and private stats return 404.

Realtime uses Channels 4.3.2, channels-redis 4.3.0, Daphne 4.2.3 and redis-py 6.4.0
against the locked Django 6.1 release. The Redis channel layer and lease store have
separate prefixes beneath an explicit instance namespace. Enabled realtime without
a Redis URL fails configuration; there is no in-memory fallback. Redis unavailability
fails readiness and causes sockets to send a safe error and close.

`server/start-prod.sh` selects Daphne for enabled realtime and preserves its migration,
expired-session cleanup and supervised `db_worker`. HTTP-only startup retains the
existing two Gunicorn workers. Daphne transport pings complement application leases;
they do not count a hidden page as active. Run multiple Daphne processes behind the
instance's reverse proxy when needed; they share Postgres and Redis.

`REALTIME_ENABLED=True` implies the ASGI database policy even if `ASGI_ENABLED=False`
is supplied. `just asgi` also opts into this policy for HTTP-only ASGI development.
Postgres uses `CONN_MAX_AGE=0` under ASGI. An optional psycopg pool has bounded per-process
size; account for every web process and background worker when sizing the database.
Transactions remain synchronous service functions called with `database_sync_to_async`.
The current HTTP middleware contains synchronous WhiteNoise and Django integrations;
Django adapts these under ASGI. Static files and development media are covered through
the ASGI handler. File responses use Django's adaptation of synchronous streams, so a
fronting proxy/object storage remains appropriate for large production media.

## Local setup

Start Docker Desktop, then run:

```sh
uv sync --locked
just realtime-up
```

The development Compose file binds Postgres 18.3 on `127.0.0.1:5433` and Redis 7.4.8 on
`127.0.0.1:6380`; neither is published to other interfaces. Its database credentials are
for local development only. Redis is ephemeral and uses `noeviction`: exhausted memory
causes explicit failure rather than silently deleting rate limits. Postgres has a named
volume; `just realtime-down` preserves it.

Add these settings to `server/.env`, generating independent random secrets:

```dotenv
DEBUG=True
REALTIME_ENABLED=True
PRESENCE_ENABLED=True
DATABASE_URL=postgresql://webframework:webframework-local@127.0.0.1:5433/webframework
REALTIME_REDIS_URL=redis://127.0.0.1:6380/0
REALTIME_PREFIX=local-webframework
PRESENCE_SCOPES={"reading":{"origins":["http://localhost:5173","http://127.0.0.1:5173"]}}
PRESENCE_HASH_KEY=<random secret of at least 32 characters>
PRESENCE_STATS_TOKEN=<independent random bearer credential>
PRESENCE_TIME_ZONE=America/Toronto
```

Then `just migrate`, `just asgi` and the existing frontend development command. Vite
proxies `/ws/` to `http://127.0.0.1:8000`; `VITE_WS_PROXY_TARGET` can override that target.
It preserves the browser Origin. The websocket allowlist is explicit per scope; missing,
duplicate, wildcard and unapproved origins are rejected. Production origins must use
HTTPS. CORS does not authorize sockets. Scope names and namespaces are configurable;
the reusable app contains no deployment hostname.

## Presence protocol v1

Endpoint: `WS /ws/presence/`. Send one JSON text hello within 10 seconds:

```json
{"v":1,"type":"hello","scope":"reading","analytics":true,"visible":true,"visitor_id":"0e78152d-1908-41b3-9d11-f8cc6439fabb"}
```

`visitor_id` must be a canonical, lowercase UUID4. The future browser client creates a
random ID in localStorage only when DNT/GPC are absent and storage works. Ordinary tabs
in the same origin/scope share that ID. It is an analytics key and never authenticates
anything. Scopes on distinct origins have independent browser identities.

For functional-only presence, omit the ID entirely:

```json
{"v":1,"type":"hello","scope":"reading","analytics":false,"visible":true}
```

This is mandatory for DNT/GPC or storage failure. The server also suppresses analytics
when handshake headers include `DNT: 1` or `Sec-GPC: 1`, even if hello asks for it. The
server assigns an ephemeral identity for that page. Such pages count functionally but
cannot deduplicate across tabs and create no visitor/daily-visit record. Raw browser IDs
are never stored in SQL or Redis, logged, or returned to the public client.

While visible, send `{"v":1,"type":"heartbeat"}` every 20 seconds. A heartbeat reactivates
a page after `inactive`. On becoming hidden, send `{"v":1,"type":"inactive"}` and stop
renewing activity. Closing a socket removes only its server-assigned connection. A hidden
socket may remain open but is closed after the inactivity lease interval; returning pages
then reconnect. A 60-second server-time lease bounds crashed/sleeping/network-lost pages.

Snapshots and group updates use the same envelope:

```json
{"v":1,"type":"presence.snapshot","count":7,"sequence":12,"server_time":"2026-10-13T14:00:00Z","lease_seconds":60,"heartbeat_seconds":20,"analytics_available":true}
```

The count estimates active browsers with at least one visible unexpired lease, plus
functional-only page identities. It is not a people count. No roster or browser keys are
public. Redis atomically prunes expired connection metadata, maintains visitor refcounts
and advances the scope's sequence on count changes. A 3-second observation loop makes expiry
visible to connected clients without waiting for a new join. Heartbeat replies always carry
a fresh authoritative count, repairing dropped group messages. Group membership is refreshed
on heartbeat. Clients ignore older sequence values within a connection; reconnect replaces
all previous connection state.

Unknown fields, duplicate keys, wrong types/versions, malformed IDs, binary frames and
messages over 2,048 UTF-8 bytes are rejected. Error envelope:

```json
{"v":1,"type":"error","code":"service_unavailable","message":"Presence is temporarily unavailable. Reconnect later."}
```

Stable codes are `invalid_message`, `unsupported_version`, `hello_required`,
`already_initialized`, `unknown_scope`, `origin_forbidden`, `rate_limited`,
`capacity_reached`, `service_unavailable`, `hello_timeout` and `lease_expired`.
Service/rate/capacity errors close with application code 4413; protocol/lease errors close with 4408.
These application codes are supported by the locked Daphne/Autobahn transport.
The error and close are sent before best-effort Redis cleanup. Cleanup has a three-second
budget; it cannot keep a failed socket or consumer task waiting indefinitely.
Clients reconnect after service or expired-lease errors using jittered exponential
backoff capped at 30 seconds, resetting after a healthy reply. Protocol/configuration
errors should be corrected instead of retried indefinitely.

Clear the displayed count immediately on disconnect, offline, Redis failure or 60 seconds
without a server response; do not render zero or a cached count as current. Redis loss
closes affected existing connections. If ephemeral Redis state was lost, an existing
connection fails its admission renewal and must reconnect. Reconnect re-admits it, restores
its lease/group membership and reads a fresh snapshot. A successful daily SQL visit remains
idempotent across Redis or Django restart.

Statistics database failure does not remove functional presence. Snapshots mark
`analytics_available:false`; failed visits are not acknowledged in Redis and retry on
subsequent visible heartbeats. Peak retries are bounded. The stats endpoint returns a
sanitized 503 during database failure. No SQL is performed for normal same-day heartbeats.

## Bounds and reverse proxies

Defaults: 10,000 open connections per instance, 10,000 per scope, 50 per peer IP, 120
connection attempts per IP/minute, 12 messages per connection/minute and 600 per IP/minute.
Admission, connection expiry, visitor cardinality and rate counters are shared in Redis.
Rate allowances include multiple tabs and ordinary NAT households; anonymous counts remain
an estimate and can be forged by malicious clients. The Redis client pool is capped at 128
connections per ASGI event loop with two-second acquisition/I/O timeouts. Configure limits
with the `PRESENCE_*` names in settings before raising the pilot target.

By default the socket's actual transport peer address determines the temporary IP hash.
Forwarded client headers from an arbitrary client are ignored. Behind a reverse proxy,
configure `PRESENCE_TRUSTED_PROXY_NETWORKS` with the narrow CIDRs for that proxy's actual
peer addresses and `PRESENCE_PROXY_IP_HEADER` with `x-real-ip`, `fly-client-ip` or
`cf-connecting-ip`. The selected header must contain exactly one valid IP and must be
rewritten by the trusted proxy, never passed through from incoming public requests.
Do not allow direct network access to Daphne that bypasses this boundary. Trusting all
possible peers is rejected. For local Caddy/nginx, for example:

```dotenv
PRESENCE_TRUSTED_PROXY_NETWORKS=127.0.0.1/32,::1/128
PRESENCE_PROXY_IP_HEADER=x-real-ip
```

For nginx, replace the incoming value rather than forwarding it:

```nginx
location /ws/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;
    proxy_read_timeout 90s;
}
```

Keep Daphne bound to loopback in this layout. The hosting
provider's actual proxy peers/header behavior must be verified in the deployment task;
otherwise every visitor behind the proxy correctly shares the peer cap.

## Durable reporting and retention

`Visitor` holds a unique `(scope, HMAC key)` and first/last seen dates. `DailyVisit` has a
unique `(scope, visitor, day)` and fixed new/returning classification. A local day is
computed using `PRESENCE_TIME_ZONE` while timestamps use UTC. A page open across midnight
records its new local day on the next visible heartbeat without reconnecting. Concurrent
first sightings serialize on the visitor row, and SQL uniqueness remains authoritative if
Redis acknowledgements disappear. `DailyPresenceSummary` holds coalesced peak and daily
aggregates; heartbeats are never SQL liveness records. Peak counts include functional-only
presence; visitor totals exclude those pages.

`GET /presence/stats/?days=N` requires the dedicated credential in an
`Authorization: Bearer ...` header. It has no session/admin fallback, query-string token
or public browser credential. An unset token disables access. `N` defaults to 30 and is
bounded to 1–400. The response contains timezone, range, retention window, and per-scope
zero-filled daily counts plus aggregate visit/peak totals. Returning totals are daily
visits, not distinct people over the range. No pseudonymous per-visitor rows are exported.
Responses are not cached.

Default retention includes today and the preceding 399 local days, and deletes visitors
inactive beyond that window. Run `just prune-presence` daily with the instance scheduler;
this command works independently of the reporting endpoint and even when presence is
disabled. The command is `manage.py prune_presence_statistics [--retention-days N]`.
The allowed retention window is 1–400 days. After deletion, key rotation or storage loss,
a browser can count as new again. There is no lifetime-unique claim.

## Verification and operations

`/healthz/` preserves the existing database-backed platform health contract. `/readyz/`
separately checks database and, when realtime is enabled, Redis, returning 503 for an
unavailable dependency without exposing credentials. Production routing should use
readiness to detect dependency failure while preserving its existing platform health check.

Ordinary tests run with SQLite and realtime disabled. The dedicated CI job uses real
Postgres and Redis, runs `apps.presence`, then runs
`uv run python admin/dev/check-presence-processes.py`. The latter creates/drops an isolated
database (the supplied Postgres role needs CREATEDB), starts two actual Daphne processes,
and verifies cross-process counts, tab deduplication, privacy headers, private statistics,
abrupt process restart and recovery after ephemeral Redis state loss. It cleans only its
random Redis namespace. `REQUIRE_REALTIME_TESTS=1` prevents an integration run from silently
substituting SQLite or skipping Redis. Local integration example:

```sh
DATABASE_URL=postgresql://webframework:webframework-local@127.0.0.1:5433/webframework \
TEST_REDIS_URL=redis://127.0.0.1:6380/0 just test-presence
DATABASE_URL=postgresql://webframework:webframework-local@127.0.0.1:5433/webframework \
TEST_REDIS_URL=redis://127.0.0.1:6380/0 \
uv run python admin/dev/check-presence-processes.py
```

The existing browser suite additionally runs against Daphne to preserve the HTTP UI flow.
Do not claim a production socket capacity from this implementation: load measurements,
actual reverse-proxy upgrade/idle behavior, off-machine backups/restore and real-device
sleep/wake are deployment/integration gates. No hosting resources, DNS or production
credentials are created by these changes.

Disable `PRESENCE_ENABLED` to close its routes; disable `REALTIME_ENABLED` to return the
startup script to HTTP-only Gunicorn. Retain the migration and durable rows during rollback;
no schema deletion or user-data rollback is needed. Keep the retention schedule running.

Verification on 2026-10-13:

- Real Postgres 18.3 / Redis 7.4.8: all 65 presence tests passed, including concurrent
  daily records, midnight renewal, expiry, privacy, limits, peak races and bounded cleanup.
- Two actual Daphne processes: rejected origins, shared counts, private reporting,
  abrupt worker restart and lost-state reconnect passed with application close codes.
  A separate disposable Redis process also passed physical stop/restart, degraded close,
  readiness 503/200, count recovery and durable-visit checks.
- Existing SQLite backend run: 353 tests passed with 29 intentional skips (24 Redis-only,
  four Postgres-only, one built-shell check before its build). Real-service coverage above
  and the seven built-shell CSP checks were run separately and passed.
- Frontend: typecheck, Biome, ESLint, 355 unit tests, production build, and all 24 existing
  Playwright tests against Daphne passed. Existing frontend lint/bundle warnings remain.
- Ruff, migration drift, Django system checks, startup shell syntax and Compose configuration
  validation passed. Docker services were not launched because Docker Desktop was stopped;
  the real-service checks used isolated temporary local processes instead.

## Durable practice rooms

`PRACTICE_ENABLED` defaults to false. Enabling it requires `REALTIME_ENABLED`, a
Postgres database, Redis, and an explicit comma-separated `PRACTICE_ORIGINS` allowlist.
Presence and practice are independent capabilities: rooms can run with public presence
disabled. Installing migrations keeps existing SQLite/HTTP instances working. Disabled
practice endpoints return 404; `GET /api/practice/capabilities/` returns `{"enabled":false}`.

The existing account and session system authenticates participants. All writes use
CSRF-protected POSTs and responses are uncached. Knowing a room UUID grants no access.
Room creation returns a high-entropy invitation secret once; only its SHA-256 hash is
stored. Put the secret in the invitation URL fragment and exchange it through the join
POST. Never put it in a query string, socket URL or analytics event. Invitation rotation
invalidates old secrets without changing existing memberships; invitation revocation
prevents further joins. A voluntary leaver can rejoin with a current invitation. A host
revocation prevents that account from rejoining the room with any invitation in v1.

| API | Request and result |
| --- | --- |
| `POST /api/practice/rooms/` | `{title,duration_minutes?}`; default 10 minutes, integer range 1–120. Returns 201 `{snapshot,invitation_secret}`. |
| `GET /api/practice/rooms/<uuid>/` | Authorized current `room.snapshot`. |
| `POST .../<uuid>/join/` | `{invitation_secret}` grants membership; returns the current snapshot. |
| `POST .../<uuid>/leave/` | `{}` revokes the caller's membership and returns `{left:true}`; the host closes instead. |
| `POST .../<uuid>/invite/rotate/` | Host-only `{}`; returns `{snapshot,invitation_secret}`. |
| `POST .../<uuid>/invite/revoke/` | Host-only `{}`; returns a snapshot. |
| `POST .../<uuid>/members/<user_id>/revoke/` | Host-only `{}` revokes a participant; returns a snapshot. |

`PracticeRoom` holds the host, configured duration, run ID, timer status, remaining
milliseconds, deadline, revision and closure timestamp. `RoomMembership` has a unique
room/account pair and distinguishes voluntary leave from host revocation. `RoomCommand`
retains each request UUID, payload hash, actor and accepted/rejected outcome for the room's
lifetime. Command UUIDs are unique across the room, and retries must match both actor and
payload. Deleting a room cascades its memberships and command records; host and command
actors are protected from account deletion while their durable room records remain.

Every timer mutation locks the room row in a synchronous Postgres transaction. The
service checks membership and host authority, recognizes retries before checking the
expected revision, applies one transition and records the outcome in the same commit.
An accepted start/resume uses a server deadline; pause saves the remaining duration;
reset restores or explicitly changes the duration and increments the run ID. Close
invalidates the invitation and rejects further controls. Host disconnection does not
pause the timer or transfer authority.

A running deadline that has elapsed is normalized to completed by the next authorized
snapshot or command. That normalization increments the revision once, even if no worker
was running at expiry. A late pause cannot revive the run. A retry returns the stored
outcome together with a fresh snapshot, so a committed command remains idempotent after
an acknowledgement or broadcast is lost. Redis is never the durable timer record.

Durable API verification on 2026-10-13: all 17 domain/API/boundary tests passed on
Postgres 18.3, including two competing commands accepting exactly one revision,
CSRF/permission/invitation checks, malformed inputs and sanitized storage failures.
Ordinary SQLite regression coverage remains available with practice disabled.
Redis-dependent transport verification is documented below as that capability is integrated.
