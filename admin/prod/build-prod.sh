#!/usr/bin/env bash

# Build project for production


## Use gsed on macOS
SED_CMD="sed"
if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! command -v gsed &> /dev/null; then
        SED_CMD="$HOME/.local/bin/gsed"
    else
        SED_CMD="gsed"
    fi
fi

## Check if server/.env is setup correctly for production build

if [ ! -f "server/.env" ]; then
    echo "ERROR: No .env file found in server/"

    ### Ask if user wants to create a new .env file
    read -p "Do you want to create a new .env file? (y/n): " create_new_env
    if [ "$create_new_env" == "y" ]; then
        cp server/.env.production.sample server/.env
        mkdir -p data
        $SED_CMD -i "s|^DATABASE_URL=.*|DATABASE_URL=sqlite:///data/db.sqlite3|" server/.env
        $SED_CMD -i "s|^MEDIA_ROOT=.*|MEDIA_ROOT=data/uploads|" server/.env
    else
        echo "Please ensure that .env is setup correctly for production build."
        exit 1
    fi
fi

if grep -q "DEBUG=True" server/.env; then
    echo "ERROR: DEBUG is set to True in server/.env"
    echo "Please ensure that .env is setup correctly for production build."
    exit 1
fi


## Build Backend

uv run python server/manage.py migrate
uv run python server/manage.py collectstatic --noinput


## Build Frontend

STATIC_APP_DIR="server/static/app"

### Build frontend files and move to static app dir
cd app
npm run build
cd - >/dev/null

rm -rf "$STATIC_APP_DIR"
mv app/dist "$STATIC_APP_DIR"


### Setup to serve fully integrated index.html template
WEBSITE_TEMPLATE_DIST_DIR="server/apps/website/templates/website/dist"
mkdir -p "$WEBSITE_TEMPLATE_DIST_DIR"
cp -p "$STATIC_APP_DIR/index.html" "$WEBSITE_TEMPLATE_DIST_DIR/index.html"

### Remove development-related code from index.html
$SED_CMD -i '\|content="https://lovable.dev|d' "$WEBSITE_TEMPLATE_DIST_DIR/index.html"
$SED_CMD -i '\|cdn.gpteng.co/gptengineer.js|d' "$WEBSITE_TEMPLATE_DIST_DIR/index.html"
$SED_CMD -i '/IMPORTANT: DO NOT REMOVE THIS SCRIPT TAG OR THIS VERY COMMENT!/d' "$WEBSITE_TEMPLATE_DIST_DIR/index.html"
