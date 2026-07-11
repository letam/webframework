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
```
