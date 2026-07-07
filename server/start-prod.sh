#!/bin/bash
# Run the web server and the background-task worker side by side.
# If either dies, exit non-zero so the platform restarts the whole machine.
set -u

python manage.py db_worker &
gunicorn --bind :8000 --workers 2 config.wsgi &

wait -n
echo 'start-prod.sh: a process exited, shutting down' >&2
exit 1
