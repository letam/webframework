#!/usr/bin/env bash

# Build project for production

# Fail loudly and early: an unset variable, a failed command, or a broken pipe
# must stop the build rather than let a later step run against a half-made state.
# Without this the frontend swap below would `rm -rf` the served directory even
# when `npm run build` had just failed, then `mv` nothing into its place — the
# site left with no frontend, and the script still exiting 0.
set -euo pipefail


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

    ### Ask if user wants to create a new .env file. `|| true` so a
    ### non-interactive run (EOF on stdin) falls through to the explicit error
    ### below rather than tripping `set -e` with no message.
    read -p "Do you want to create a new .env file? (y/n): " create_new_env || true
    if [ "$create_new_env" == "y" ]; then
        cp server/.env.production.sample server/.env
        mkdir -p data
        $SED_CMD -i "s|^DATABASE_URL=.*|DATABASE_URL=sqlite:///data/db.sqlite3|" server/.env
        $SED_CMD -i "s|^MEDIA_ROOT=.*|MEDIA_ROOT=data/uploads|" server/.env

        ### The sample ships a placeholder SECRET_KEY; substitute a fresh one.
        ### Append via printf (not sed) so the generated value is treated
        ### literally — get_random_secret_key() can emit sed-special chars.
        generated_key="$(uv run python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())')"
        $SED_CMD -i '/^SECRET_KEY=/d' server/.env
        printf 'SECRET_KEY=%s\n' "$generated_key" >> server/.env
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

## Refuse an empty, placeholder, or committed-sample SECRET_KEY. Building on one
## of these would ship a world-known key — the samples deliberately no longer
## carry a real value.
### `|| true` so a missing SECRET_KEY line yields an empty value that the check
### below reports, instead of `set -o pipefail` aborting with no explanation.
secret_key_value="$(grep -E '^SECRET_KEY=' server/.env | head -n1 || true)"
secret_key_value="${secret_key_value#SECRET_KEY=}"
if [ -z "$secret_key_value" ] ||
   [ "$secret_key_value" = "REPLACE_WITH_A_GENERATED_SECRET_KEY" ] ||
   [ "$secret_key_value" = 'i!c#ilronu_o_g7@!tpvz9@94o2gkami5xkf3kytbgw1^#qt68' ]; then
    echo "ERROR: SECRET_KEY in server/.env is empty or a known placeholder/sample value."
    echo "Generate a real key with:"
    echo "  python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())'"
    exit 1
fi


## Build Backend

uv run python server/manage.py migrate
uv run python server/manage.py collectstatic --noinput


## Build Frontend

STATIC_APP_DIR="server/static/app"
STAGING_APP_DIR="server/static/.app-staging"

### Build frontend files into app/dist. `set -e` aborts here on a build failure,
### so nothing below runs against a broken or absent build.
###
### bun, not npm, and --frozen-lockfile: this must resolve the same dependency
### tree CI gates and the Dockerfile ships. Building against whatever happens to
### be in app/node_modules — or letting npm re-resolve bun.lock's ranges — means
### this path can produce a bundle nothing ever tested.
cd app
bun install --frozen-lockfile
bun run build

### Add build timestamp to index-*.js
BUILD_TIME=$(date +'%Y-%m-%d %H:%M:%S %Z')
echo "// Build time: $BUILD_TIME" >> dist/assets/index-*.js

cd - >/dev/null

### Swap into place only now that the build has succeeded. Stage the new build
### first, then replace the served directory with two renames on one filesystem,
### so a failure never leaves the site with no frontend.
rm -rf "$STAGING_APP_DIR"
mv app/dist "$STAGING_APP_DIR"
rm -rf "$STATIC_APP_DIR"
mv "$STAGING_APP_DIR" "$STATIC_APP_DIR"


### Setup to serve fully integrated index.html template
WEBSITE_TEMPLATE_DIST_DIR="server/apps/website/templates/website/dist"
mkdir -p "$WEBSITE_TEMPLATE_DIST_DIR"
cp -p "$STATIC_APP_DIR/index.html" "$WEBSITE_TEMPLATE_DIST_DIR/index.html"

### Add timestamp (local timezone, with UTC offset) to index.html
$SED_CMD -i "s|<!-- TIMESTAMP -->|<!-- TIMESTAMP: $(date +'%Y-%m-%d %H:%M:%S %Z') -->|" "$WEBSITE_TEMPLATE_DIST_DIR/index.html"
