#!/usr/bin/env bash

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
yes n | fly launch --now --copy-config

# Restore existing fly.toml
mv .tmp/fly.toml fly.toml
