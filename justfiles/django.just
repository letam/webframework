# justfile for common Django commands (using uv)

# Run the Django development server
dev:
    uv run python server/manage.py runserver_plus

# Make new migrations for all apps
makemigrations:
    uv run python server/manage.py makemigrations

# Apply all migrations
migrate:
    uv run python server/manage.py migrate

# Create a Django superuser
createsuperuser:
    uv run python server/manage.py createsuperuser

# Open the Django shell
shell:
    uv run python server/manage.py shell_plus

# Run Django tests
test:
    uv run python server/manage.py test

# Collect static files
collectstatic:
    uv run python server/manage.py collectstatic --noinput


# Show all available just commands
list:
    just --list
