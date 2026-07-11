#!/bin/bash
# Production entrypoint: apply migrations, then run the web server and the
# background-task worker side by side.
set -euo pipefail

# Apply database migrations on boot.
#
# On Fly with SQLite-on-a-volume, the release VM (where `release_command` runs)
# has NO access to the mounted volume that holds the database, so migrations
# CANNOT run there. This container, however, boots with the volume mounted — so
# this is the correct place to migrate. Running here also means a bad migration
# fails the boot -> the health check fails -> Fly's rolling deploy keeps the old
# machine, instead of the app crash-looping against a half-migrated schema.
echo 'start-prod.sh: applying migrations…' >&2
python manage.py migrate --noinput

# Supervise the background-task worker: if it exits, restart it rather than
# taking the whole machine (and a healthy web server) down with it. A short
# backoff keeps a genuinely-broken worker from hot-looping.
supervise_worker() {
  while true; do
    python manage.py db_worker || true
    echo 'start-prod.sh: db_worker exited, restarting in 2s' >&2
    sleep 2
  done
}
supervise_worker &

# The web server is authoritative. `exec` makes gunicorn PID 1, so if it exits
# the container exits (non-zero on crash) and Fly restarts the machine.
echo 'start-prod.sh: starting gunicorn…' >&2
exec gunicorn --bind :8000 --workers 2 config.wsgi
