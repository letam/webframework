# Deploying to Fly.io

Operational runbook for the production app. Written after the first real
production deploy (2026-07-11), which uncovered a migration crash-loop the hard
way — this doc exists so nobody re-derives it under pressure.

## The target

| Fact          | Value |
|---------------|-------|
| App           | `webframework` — https://webframework.fly.dev |
| Region        | `yyz` |
| Machines      | one always-on machine (it owns the volume; do not scale to >1 with SQLite) |
| Volume        | `myapp_data`, mounted at `/data` — holds **both** the SQLite DB (`/data/db.sqlite3`) and user media (`/data/uploads`, served at `/media/`) |
| Org           | Fly `personal` |
| Dashboard     | https://fly.io/apps/webframework/monitoring |

## Use the right config

The **canonical deploy configs** live in `admin/configs/`:

- `fly-sqlite.toml` — production (SQLite on the mounted volume).
- `fly-postgres.toml` — alternative (managed Postgres).
- `fly-preview.toml` — preview apps. Same as `fly-sqlite.toml` but the machine
  suspends when idle. See [Preview apps](#preview-apps).

The root `fly.toml` is a **reference snapshot only** — a human-readable copy of
the live SQLite setup. Do not deploy with it directly.

Every `fly` command needs an explicit `--app webframework`, or it falls back to
the root `fly.toml`.

## Normal deploy

```bash
just fly-deploy-app-sqlite webframework
# equivalently:
fly deploy --config admin/configs/fly-sqlite.toml --app webframework
```

**Migrations run automatically on boot** (`server/start-prod.sh` runs
`migrate --noinput` before starting gunicorn). You do **not** need a manual
migrate step. A bad migration fails the boot → the health check fails → Fly's
rolling deploy keeps the old machine. Snapshots are still cheap insurance before
a schema-changing deploy:

```bash
fly volumes snapshots create vol_<id> -a webframework   # find the id with: fly volumes list -a webframework
```

### Why not `release_command`?

The Fly *release VM* has no access to the mounted volume, so it cannot touch the
SQLite database. That's why `release_command` is commented out in
`fly-sqlite.toml` and migrations moved into the boot path instead. See
https://community.fly.io/t/using-sqlite-from-persistent-volume-for-django-application/16206/3

## Recovery: the migration crash-loop (historical / fallback)

Boot-time migrations (above) prevent this. Kept here in case a machine ever ends
up crash-looping against a schema it can't migrate (e.g. a deploy predating the
boot-migrate change, or a migration that fails mid-boot).

**Symptom:** the machine restarts every ~100s (`exit_code=1`); `fly ssh console`
and `fly machine exec` fail with "VMM not running". Root cause: `start-prod.sh`
exits non-zero when gunicorn dies, and a broken schema kills the app before it
can be fixed.

**Fix — park the machine on a no-op, migrate, then redeploy:**

```bash
MACHINE=$(fly machine list -a webframework -q | head -1)

# 1. Snapshot first.
fly volumes snapshots create vol_<id> -a webframework

# 2. Park the machine so it stays up without running the app.
fly machine update "$MACHINE" -a webframework --command "sleep infinity" --skip-health-checks --yes
fly machine start "$MACHINE" -a webframework

# 3. Migrate against the now-idle DB (bump the timeout — Django cold-start on
#    512MB is slow; the default deadline is too short).
fly machine exec "$MACHINE" "python /code/manage.py migrate --noinput" -a webframework --timeout 120

# 4. Redeploy the same image to restore start-prod.sh as the machine command.
fly deploy --config admin/configs/fly-sqlite.toml --app webframework --image <registry.fly.io/webframework:deployment-...>
```

## Preview apps

A preview is a separate Fly app on the same image, scaled to zero when idle.
Creating one from scratch:

```bash
fly apps create <name> --org personal
fly volumes create myapp_data --app <name> --region yyz --size 1 --yes

# SECRET_KEY, DATABASE_URL and MEDIA_ROOT have no production default in
# settings.py, so the app cannot boot without them. That is deliberate: the
# alternatives are a rotating secret, a database on the container's ephemeral
# filesystem, and uploads written off the mounted volume — each of which would
# boot healthy and lose data instead of failing. Generate a fresh SECRET_KEY —
# do not reuse production's.
fly secrets set --stage --app <name> \
  SECRET_KEY="$(openssl rand -base64 48 | tr -d '\n')" \
  DATABASE_URL='sqlite:////data/db.sqlite3' \
  MEDIA_URL="https://<name>.fly.dev/media/" \
  MEDIA_ROOT='/data/uploads' \
  USE_LOCAL_FILE_STORAGE='True'

just fly-deploy-app-preview <name>
```

`ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` pick up `<name>.fly.dev` automatically —
`settings.py` derives them from `FLY_APP_NAME`, which Fly injects into every machine.

Expect the first request after an idle period to take ~17s (boot + migrate on a
512MB shared VM); warm requests answer in ~30ms. A slow first load is the config
working, not the app being broken.

Background tasks run on the DB backend here (`TASKS_IMMEDIATE` defaults to `DEBUG`,
which is off), drained by the `db_worker` that `start-prod.sh` starts inside the
same machine. Two consequences worth knowing on a scale-to-zero app: task failures
surface on the row rather than in the HTTP response, and the worker only makes
progress while the machine is awake — Fly autostarts on an incoming HTTP request,
not on a pending task row, so anything enqueued just before an idle suspend waits
for the next visitor.

Two things the deploy does not give you:

- **`OPENAI_API_KEY`** is unset, so transcription fails. `POST /api/posts/<id>/transcribe/`
  still returns 202 — the failure lands on the media row as `transcript_status='error'`,
  not as a 500. (The 500 you'd see locally is the immediate task backend that `DEBUG`
  turns on.) Set the key yourself if you need to exercise that path.
- **No superuser.** `init_users` prompts for a username and password, so it fails
  with `EOFError` over `fly ssh console -C`. Run
  `fly ssh console -C 'python /code/manage.py createsuperuser' --app <name>`.
  The `anonymous` user needs no action — migration
  `users/0003_create_anonymous_user` creates it.

Tear down with `fly apps destroy <name>`, which takes the volume with it.

Prefer this sequence over `admin/deploy/launch-fly.io-sqlite.sh`: that script
rewrites the root `fly.toml` in place (restoring it only if it succeeds), needs
GNU `sed`, and never sets `SECRET_KEY`.

## Environment facts (production container)

- WORKDIR `/code`; `manage.py` at `/code/manage.py`.
- No virtualenv — `python` and deps are global (`/usr/local/...`).
- `CMD ["bash", "start-prod.sh"]`; the volume is mounted at boot.
- Health check hits `/healthz/`; `grace_period` is 40s to cover migrate + cold-start.

## Manual orphaned-media cleanup requires maintenance for deletion

Start with a report. Use the deployed database and its configured default storage;
a checkout is useful for local reports but does not inventory production.

```bash
# Repository checkout: report only
uv run python server/manage.py cleanup_orphaned_media

# Production: report against the deployed database and storage
fly ssh console --app webframework \
  -C 'python /code/manage.py cleanup_orphaned_media'
```

The command emits JSON lines: backend/root or bucket identity, database identity,
UTC cutoff, unattached row IDs, object decisions, and a final summary. Save stdout
and stderr to access-controlled log files and review the exit status. Keys are
escaped; signed URLs and credentials are not logged. A dry-run does not change
storage or database rows. Files from unattached `Media` rows, drafts, private posts,
avatars and previews remain protected by modeled references. Unattached rows are
always report-only, including with `--delete`.

Only `post/<numeric-id>/media/<file>` and
`post/audio/<numeric-user-id>/<filename>` can be reclaimed. Avatars, preview and
legacy prefixes, malformed paths, directory markers and local symlinks are excluded.
The command does not repair missing files or change upload/deletion hooks.

| Option | Default | Bound / meaning |
| --- | --- | --- |
| `--min-age-hours` | `168` | At least 168, even in reports; storage mtime must be strictly older |
| `--batch-size` | `100` | 1–1000; inventory and reference-query batches |
| `--max-scan` | `10000` | Positive finite entry budget |
| `--max-delete` | `100` | 1–1000 object deletion attempts |
| `--max-row-report` | `1000` | Positive finite unattached-row report budget |
| `--prefix` | `post/` | Repeatable narrowing, e.g. `post/audio/42/` or `post/123/media/` |

Local inventory counts visited directory, symlink and excluded entries toward the
scan budget as well as files. Prefix filtering can therefore consume budget on
sibling entries without reporting candidates. R2 lists storage-relative prefixes
with bounded pages through the configured guarded backend. Unsupported backends or
ambiguous reference mappings refuse the run. Unknown, naive or future mtimes and
unknown sizes preserve the object.

Reaching any cap marks `incomplete=true`, even if it happens to coincide with the
end of inventory. A partial report does not establish that there are no orphans.
Review the `caps` list, narrow prefixes or deliberately raise the finite scan/report
budgets, then repeat. A dry-run repeated without changing scope starts at the same
place; there is no persistent cursor. During maintenance, successful bounded
removals let subsequent runs progress. Storage-delete, database or listing failures
abort with nonzero status; inspect the last error and summary before continuing.

### Establish and retain a volume-mounted maintenance machine

`--writers-quiesced` acknowledges an operator-verified precondition; it acquires no
lock. Do not use it while uploads, attachments, admin edits, workers or external
writers can run. Database locks cannot make an absent future reference or an object
store write atomic with deletion.

1. Record the current machine ID, volume ID, deployed image and machine command.
   Verify there are no other machines, admin jobs, scheduled invocations or external
   services writing to this database or bucket. Arrange an outage and stop those
   writers. Disable deployment automation for the window.
2. Block new upload/attachment/admin traffic, drain active app requests and stop
   upload clients. Allow every outstanding
   presigned PUT authorization to expire (currently 300 seconds after issuance),
   and independently confirm that already-started transfers have completed or
   stopped. Expiry alone cannot establish this. If transfers or external writers
   cannot be accounted for, keep using dry-run.
3. Park the **existing volume-owning machine** on the idle command below. This
   replaces `start-prod.sh` and stops both its web server and worker supervisor;
   killing only `db_worker` would let the supervisor restart it. Keep the machine
   running so `/data` remains mounted and SSH/exec remain available. Do not use the
   volume-less Fly release VM, scale to zero, or create a second SQLite writer.

   ```bash
   MACHINE=<recorded-volume-owning-machine-id>
   fly machine update "$MACHINE" --app webframework \
     --command "sleep infinity" --skip-health-checks --yes
   fly machine start "$MACHINE" --app webframework
   ```

4. Inspect the parked machine's process list and confirm there is no Gunicorn,
   Daphne, `db_worker`, worker supervisor or other writer. Confirm the `/data` mount
   and rerun the report on this machine. Confirm that the `default` database alias
   points to the authoritative primary, not a read replica. Match its engine/name,
   filesystem root or R2 bucket/location against the recorded deployment. For
   SQLite, expect `/data/db.sqlite3`; local storage normally uses `/data/uploads`.
   Never redirect cleanup to an inactive bucket or an unmounted local directory.
5. Back up affected durable data while writers remain stopped. Create a volume
   snapshot and retain an off-machine, restorable database/media backup. For R2,
   also back up the candidate objects in the identified bucket to a separate
   destination; a Fly volume snapshot does not include R2. Verify restore access
   and the candidate key list before deleting. Database backups alone cannot
   restore removed object bytes.
6. Review the maintenance report and its candidate bytes, ages, references and
   caps. Run deletion only if quiescence and identity are still verified:

   ```bash
   # Inside the parked, volume-mounted production machine
   python /code/manage.py cleanup_orphaned_media \
     --delete --writers-quiesced --min-age-hours 168 --max-delete 100
   ```

   Capture each run's logs. Metadata and authoritative default-database references
   are reread immediately before each removal, but these checks do not eliminate
   races. Keep all writers stopped for the entire series of bounded runs. Review
   each summary and any errors before repeating. Stop on unexpected candidates,
   identity changes or failed checks.
7. Restore the recorded image through the canonical deployment config to restore
   `start-prod.sh` as the machine command, as in the recovery procedure above:

   ```bash
   fly deploy --config admin/configs/fly-sqlite.toml --app webframework \
     --image <recorded-registry.fly.io/webframework:deployment-image>
   ```

   Verify the mounted database/media, web and worker processes, `/healthz/`, and
   representative protected media. Restore external writers and deployment
   automation after service checks pass. If bytes need recovery, restore the
   backed-up objects while writers are still stopped, then restore service.

Do not schedule this command or add it to startup/`db_worker`. Scheduling requires
an approved retention policy and enforceable coordination with uploads, plus one
executor, bounded runs, failure alerts and overlap prevention. `django-tasks` alone
cannot coordinate uploads. Online cleanup and unattached-row pruning require a
separate design and owner approval; this command never deletes those rows.

## Before enabling realtime / practice in production

Realtime and practice ship disabled. Production currently uses SQLite on one
512 MB Fly VM. Enabling practice requires a deployment decision, not just flags.

- **Database:** provision PostgreSQL and plan migration or a separate practice
  instance before enabling `PRACTICE_ENABLED`; practice does not support SQLite.
- **Redis:** choose colocated or managed Redis for channel layers, leases and
  shared rate limits. Keep it private, use `noeviction`, disable persistence
  (`save ""`, `appendonly no`), and set a bounded `maxmemory`.
- **Server and memory:** `REALTIME_ENABLED` switches startup from Gunicorn to
  Daphne. Measure total memory headroom on the intended Fly configuration,
  including the background worker and colocated services. The
  [local pilot](reports/2026-10-13-practice-pilot.md) measured about 2 MiB of Redis
  used memory versus 253 MiB summed RSS for two Daphne processes; those different
  measurements do not establish that the production workload fits in 512 MB.
  Choose VM size and Redis placement from production-like measurements.
- **Enablement:** configure `REALTIME_ENABLED`, `PRACTICE_ENABLED`,
  `REALTIME_REDIS_URL` and exact HTTPS `PRACTICE_ORIGINS`. Enable
  `PRESENCE_ENABLED` separately if wanted. Rebuild with
  `--build-arg VITE_PRACTICE_ENABLED=true`; runtime secrets cannot enable the
  compiled navigation link.

Complete the dependency, proxy, backup/restore and device checks below before
opening the instance to users.

## Post-deploy verification

For an optional practice instance, enable `REALTIME_ENABLED` and `PRACTICE_ENABLED`,
use a separate Postgres database and private Redis service, and configure the exact HTTPS
`PRACTICE_ORIGINS` together with the instance's HTTP/CSRF host settings. Build the frontend
with `VITE_PRACTICE_ENABLED=true` for its desktop and mobile navigation entry. This is
a build-time flag, defaults to false in Docker, and requires rebuilding the frontend;
the runtime `PRACTICE_ENABLED` backend setting cannot change compiled navigation.
Pass it to the Docker/Fly build explicitly:

```sh
docker build --build-arg VITE_PRACTICE_ENABLED=true --tag webframework-practice .
fly deploy --config admin/configs/fly-postgres.toml --app <name> --build-arg VITE_PRACTICE_ENABLED=true
```

Accounts, HTTP API and room
sockets share an origin with secure host-only session cookies. Do not reuse an unrelated
production instance's database or widen its cookie domain. No deployment is created by
the kit feature. The protocol and full setup are in
[presence and practice](plans/2026-10-13-presence-and-practice.md).

Route dependency checks through `/readyz/` while preserving the existing `/healthz/`
platform check. Verify WebSocket upgrades/idle limits through the actual proxy, configure
only verified proxy peer CIDRs, size every ASGI/background worker's Postgres pool, and
test off-machine backups by restoring them before keeping practice history. Keep an
instance available for active rooms; autosuspend and transport retries are not a durable
timer scheduler. Deadline expiry remains recoverable even with all workers stopped.

Rollback rooms by disabling `PRACTICE_ENABLED` and the frontend navigation flag; retain
the room migrations/data. Existing sockets will fail their next authorization check or
worker restart. Disabling `REALTIME_ENABLED` additionally returns startup to Gunicorn and
disables public presence. Retain its statistics pruning schedule. Room command results
are retained for each room's lifetime; deleting a room cascades its memberships/commands.
Observe sanitized service/rate errors, readiness, command latency, socket counts and
Redis memory before increasing budgets. The
[local pilot](reports/2026-10-13-practice-pilot.md) is an implementation measurement,
not a production sizing guarantee.

```bash
curl -s https://webframework.fly.dev/healthz/        # {"status": "ok"}
curl -s https://webframework.fly.dev/api/posts/ | head
fly machine status "$MACHINE" -a webframework         # check: passing [1/1], no recent exit_code=1

just fly-check-logging                                # RESULT: PASS
```

`just fly-check-logging` (script: `admin/prod/check-logging.sh`) asks the running
process which handlers an ERROR and a WARNING actually survive, for both an app
logger and `django.request`. Worth running after any deploy that touches
`LOGGING` or `DEBUG`: the failure mode it guards is silent in every other check —
the app serves fine, health passes, and stack traces simply stop arriving. It
also catches the reverse regression, where `django.request` WARNINGs reach
stderr and every bot scanning for `/wp-login.php` fills the log stream.
