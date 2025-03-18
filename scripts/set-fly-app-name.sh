#!/usr/bin/env bash

# Get FLY_APP_NAME from command line arguments
FLY_APP_NAME=$1

# Display usage if no argument is provided
if [ -z "$FLY_APP_NAME" ]; then
    echo "Usage: $0 <app_name>"
    exit 1
fi

# Set app name in project
sed -i.bak "s/FLY_APP_NAME/$FLY_APP_NAME/g" server/config/settings.py
find scripts/configs/ -type f -name "fly-*" -exec sed -i.bak "s/FLY_APP_NAME/$FLY_APP_NAME/g" {} +
