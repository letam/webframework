#!/usr/bin/env bash

# Remove backup files created by fly deployment script
files=(
    "scripts/configs/fly-postgres.toml.bak"
    "scripts/configs/fly-sqlite.toml.bak"
    "server/config/settings.py.bak"
)
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        rm "$file"
    fi
done