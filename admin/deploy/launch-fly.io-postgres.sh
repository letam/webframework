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

# Specify the target fly.toml configuration file
function specify_target_fly_toml() {
    # Move currently active fly.toml configuration file to local tmp directory
    if [ -f fly.toml ]; then
        mkdir -p .tmp
        mv fly.toml .tmp/fly.toml
    fi

    # Copy target fly.toml configuration file to project root directory
    cp -p ./admin/configs/fly-postgres.toml fly.toml
}
specify_target_fly_toml

# Launch app
yes n | fly launch --name $FLY_APP_NAME --now --copy-config --db=upg

# Restore existing fly.toml
if [ -f .tmp/fly.toml ]; then
    mv .tmp/fly.toml fly.toml
fi