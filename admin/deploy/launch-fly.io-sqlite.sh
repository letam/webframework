#!/usr/bin/env bash

# Exit on error
set -e

# Get FLY_APP_NAME from command line arguments
FLY_APP_NAME=$1

# Display usage if no argument is provided
if [ -z "$FLY_APP_NAME" ]; then
    echo "Usage: $0 <app_name>"
    exit 1
fi

# Use gsed on macOS
SED_CMD="sed"
if [[ "$OSTYPE" == "darwin"* ]]; then
    SED_CMD="gsed"
fi

# Function to check if app exists
check_app_exists() {
    local app_name=$1
    if fly apps list | grep -q "^$app_name "; then
        return 0  # App exists
    else
        return 1  # App doesn't exist
    fi
}

# Function to get the actual deployed app name
get_deployed_app_name() {
    local target_name=$1
    # Check if the exact name exists
    if check_app_exists "$target_name"; then
        echo "$target_name"
        return
    fi
    
    # Look for apps that start with the target name (Fly.io might have generated a variant)
    local found_app=$(fly apps list | grep "^$target_name" | head -1 | awk '{print $1}')
    if [ -n "$found_app" ]; then
        echo "$found_app"
        return
    fi
    
    # If no app found, return the original name (will cause error later, but that's expected)
    echo "$target_name"
}

# Specify the target fly.toml configuration file
function specify_target_fly_toml() {
    # Move currently active fly.toml configuration file to local tmp directory
    if [ -f fly.toml ]; then
        mkdir -p .tmp
        mv fly.toml .tmp/fly.toml
    fi

    # Copy target fly.toml configuration file to project root directory
    cp -p ./admin/configs/fly-sqlite.toml fly.toml
    
    # Substitute the app name in the fly.toml file
    $SED_CMD -i "s|FLY_APP_NAME|$FLY_APP_NAME|g" fly.toml
}
specify_target_fly_toml


# Check if app already exists
if check_app_exists "$FLY_APP_NAME"; then
    echo "App '$FLY_APP_NAME' already exists. Deploying to existing app..."
    DEPLOYED_APP_NAME="$FLY_APP_NAME"
else
    echo "Creating new app '$FLY_APP_NAME'..."
    # Create app without launching
    yes n | fly launch --name $FLY_APP_NAME --vm-memory 512 --ha=false --no-db --now --copy-config --build-only
    
    # Get the actual app name that was created (in case Fly.io generated a variant)
    DEPLOYED_APP_NAME=$(get_deployed_app_name "$FLY_APP_NAME")
    echo "Deployed app name: $DEPLOYED_APP_NAME"
fi

# Set database location
flyctl secrets set DATABASE_URL=sqlite:////data/db.sqlite3 --app "$DEPLOYED_APP_NAME"

# Set uploads location
flyctl secrets set MEDIA_URL=https://${DEPLOYED_APP_NAME}.fly.dev/media/ --app "$DEPLOYED_APP_NAME"
flyctl secrets set MEDIA_ROOT=/data/uploads --app "$DEPLOYED_APP_NAME"
flyctl secrets set USE_LOCAL_FILE_STORAGE=True --app "$DEPLOYED_APP_NAME"

# HACKY FIX: flyctl will override this change that we manually made in the fly.toml file :/.
# Update fly.toml to disable release_command and migrate in a separate step
# NOTE: Run database migrations manually after deploy if using volume storage, since release_command does not have access to fly.io storage volumes
# Reference: https://community.fly.io/t/using-sqlite-from-persistent-volume-for-django-application/16206/3
$SED_CMD -i "s|^  release_command = 'python manage.py migrate --noinput'|#  release_command = 'python manage.py migrate --noinput'|g" fly.toml


# Launch app
fly deploy --app "$DEPLOYED_APP_NAME" --config ./admin/configs/fly-sqlite.toml

# Wait for app to be ready
echo "Waiting for app to be ready..."
while ! curl -s -o /dev/null -w "%{http_code}" https://$DEPLOYED_APP_NAME.fly.dev; do
    sleep 2
done
echo
echo "App is ready!"

# Run migrations
echo "Running migrations..."
if fly ssh console -C 'python manage.py migrate' --app "$DEPLOYED_APP_NAME"; then
    echo "✅ Migrations completed successfully!"
else
    echo "❌ Migration failed. Please check the app logs: fly logs --app $DEPLOYED_APP_NAME"
    exit 1
fi

# Display success message
echo ""
echo "🎉 Deployment completed successfully!"
echo "App URL: https://$DEPLOYED_APP_NAME.fly.dev/"
echo "Admin URL: https://fly.io/apps/$DEPLOYED_APP_NAME"
echo ""
echo "Next steps:"
echo "1. Create a superuser: fly ssh console -C 'python manage.py createsuperuser' --app $DEPLOYED_APP_NAME"
echo "2. Monitor your app: fly logs --app $DEPLOYED_APP_NAME"
echo "3. View app status: fly status --app $DEPLOYED_APP_NAME"

# Restore existing fly.toml
if [ -f .tmp/fly.toml ]; then
    mv .tmp/fly.toml fly.toml
fi
