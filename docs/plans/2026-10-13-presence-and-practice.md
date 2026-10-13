# Presence and practice implementation

The optional Channels/Daphne and Redis foundation is implemented. Durable visitor
statistics, the private reporting API and retention are now implemented. Live presence
follows separately; shared practice rooms and
synchronized timers are the next phase. Socket routes currently reject all handshakes.
Presence settings reserve the explicit boundaries used by those later features.

## Instance capabilities

HTTP-only instances keep their existing Gunicorn, SQLite, API, session authentication
and background-task behavior. `REALTIME_ENABLED` and `PRESENCE_ENABLED` both default
to false. Installing dependencies and applying the presence migration does not
require Redis. Disabled socket handshakes are rejected.

Realtime uses Channels 4.3.2, channels-redis 4.3.0, Daphne 4.2.3 and redis-py 6.4.0
against the locked Django 6.1 release. The Redis channel layer and lease store have
separate prefixes beneath an explicit instance namespace. Enabled realtime without
a Redis URL fails configuration; there is no in-memory fallback. Redis unavailability
fails readiness before accepting production traffic.

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
DATABASE_URL=postgresql://webframework:webframework-local@127.0.0.1:5433/webframework
REALTIME_REDIS_URL=redis://127.0.0.1:6380/0
REALTIME_PREFIX=local-webframework
```

Then `just migrate`, `just asgi` and the existing frontend development command. Vite
proxies `/ws/` to `http://127.0.0.1:8000`; `VITE_WS_PROXY_TARGET` can override that target.

## Verification and operations

`/healthz/` preserves the existing database-backed platform health contract. `/readyz/`
separately checks database and, when realtime is enabled, Redis, returning 503 for an
unavailable dependency without exposing credentials. Production routing should use
readiness to detect dependency failure while preserving its existing platform health check.

Run `uv run python server/manage.py test apps.presence.tests.test_infrastructure`
to check configuration, disabled sockets, dependency readiness and existing HTTP
authentication, CSRF, static and media routes through ASGI. No Redis is needed for
these regression checks.

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


The transactional statistics service is ready for the next commit’s socket writer.
Run `uv run python server/manage.py test apps.presence.tests.test_statistics` for
privacy, reporting, deduplication and retention checks. Its four race tests additionally
require a Postgres test database.
