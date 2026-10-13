# justfile for common Django commands (using uv)

# Shortcut to run manage.py command
[no-exit-message]
manage-py *args:
    uv run python server/manage.py {{args}}

# Run the Django development server
runserver:
    uv run python server/manage.py runserver_plus

# Make new migrations for all apps
makemigrations:
    uv run python server/manage.py makemigrations

# Apply all migrations
migrate:
    uv run python server/manage.py migrate

# Refresh stale and failed link previews
refresh-link-previews *ARGS:
    uv run python server/manage.py refresh_link_previews {{ARGS}}

# Run the background task worker (only needed when TASKS_IMMEDIATE=False)
worker:
    uv run python server/manage.py db_worker

# Create a Django superuser
createsuperuser:
    uv run python server/manage.py createsuperuser

# Open the Django shell
shell:
    uv run python server/manage.py shell_plus

# Run Django tests (the 'apps' label is required: bare 'test' from the repo
# root discovers 0 tests)
test:
    uv run python server/manage.py test apps

# Collect static files
collectstatic:
    uv run python server/manage.py collectstatic --noinput


# Show all available just commands
list:
    just --list

# Serve HTTP and WebSockets with Daphne (set realtime variables in server/.env).
asgi:
    PYTHONPATH=server ASGI_ENABLED=True uv run daphne -b 127.0.0.1 -p 8000 --websocket-max-message-size 2048 --websocket-max-frame-size 2048 config.asgi:application

# Local durable/ephemeral dependencies; ports are confined to loopback.
realtime-up:
    docker compose -f compose.realtime.yml up -d --wait

realtime-down:
    docker compose -f compose.realtime.yml down

# Integration checks require both real Redis and Postgres.
test-presence:
    REQUIRE_REALTIME_TESTS=1 uv run python server/manage.py test apps.presence

# Schedule daily via the instance's existing scheduler (no request-triggered retention).
prune-presence:
    uv run python server/manage.py prune_presence_statistics
