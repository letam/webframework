#!/usr/bin/env bash


# Specify the target fly.toml configuration file
function specify_target_fly_toml() {
    # Move currently active fly.toml configuration file to local tmp directory
    if [ -f fly.toml ]; then
        mkdir -p .tmp
        mv fly.toml .tmp/fly.toml
    fi

    # Copy target fly.toml configuration file to project root directory
    cp -p ./scripts/configs/fly-sqlite.toml fly.toml
}
specify_target_fly_toml


# Create app without launching
yes n | fly launch --vm-memory 512 --ha=false --no-db --now --copy-config --build-only

# Set database location
flyctl secrets set DATABASE_URL=sqlite:////data/db.sqlite3

# Use gsed on macOS
SED_CMD="sed"
if [[ "$OSTYPE" == "darwin"* ]]; then
    SED_CMD="gsed"
fi

# HACKY FIX: flyctl will override this change that we manually made in the fly.toml file :/.
# Update fly.toml to disable release_command and migrate in a separate step
# NOTE: Run database migrations manually after deploy if using volume storage, since release_command does not have access to fly.io storage volumes
# Reference: https://community.fly.io/t/using-sqlite-from-persistent-volume-for-django-application/16206/3
$SED_CMD -i "s|^  release_command = 'python manage.py migrate --noinput'|#  release_command = 'python manage.py migrate --noinput'|g" fly.toml


# Launch app
fly deploy

# Run migrations
fly ssh console -C 'python manage.py migrate'

# Restore existing fly.toml
mv .tmp/fly.toml fly.toml
