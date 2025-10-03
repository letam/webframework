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
    cp -p ./scripts/configs/fly-postgres.toml fly.toml
}
specify_target_fly_toml

# Launch app
yes n | fly launch --name $FLY_APP_NAME --now --copy-config

# Restore existing fly.toml
mv .tmp/fly.toml fly.toml
