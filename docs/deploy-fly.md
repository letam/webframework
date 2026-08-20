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

## Post-deploy verification

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
