#!/usr/bin/env bash

# Get FLY_APP_NAME from command line arguments
FLY_APP_NAME=$1

# Display usage if no argument is provided
if [ -z "$FLY_APP_NAME" ]; then
    echo "Usage: $0 <app_name>"
    exit 1
fi

# Set app name in project via script
./scripts/set-fly-app-name.sh $FLY_APP_NAME

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
yes n | fly launch --name $FLY_APP_NAME --vm-memory 512 --ha=false --no-db --now --copy-config --build-only

# Set database location
flyctl secrets set DATABASE_URL=sqlite:////data/db.sqlite3

# Set uploads location
flyctl secrets set MEDIA_URL=https://${FLY_APP_NAME}.fly.dev/media/
flyctl secrets set MEDIA_ROOT=/data/uploads
flyctl secrets set USE_LOCAL_FILE_STORAGE=True

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
fly deploy --config ./scripts/configs/fly-sqlite.toml

# Wait for app to be ready
echo "Waiting for app to be ready..."
while ! curl -s -o /dev/null -w "%{http_code}" https://$FLY_APP_NAME.fly.dev; do
    sleep 2
done
echo
echo "App is ready!"

# Run migrations
echo "Running migrations..."
fly ssh console -C 'python manage.py migrate'

# Restore existing fly.toml
mv .tmp/fly.toml fly.toml
