#!/bin/bash

# Create Django app and configure onto Django project

set -e

[ $# -lt 1 ] && { echo "Usage: $0 <app_name>"; exit 1; }

app_name=$1

function create_django_app() {
    uv run python server/manage.py startapp "$app_name"
}

function update_apps_py_to_use_full_module_path() {
    sed -i.bak "s/name = '$app_name'/name = 'apps.$app_name'/" "$app_name/apps.py"
    rm "$app_name/apps.py.bak"
}

function move_app_to_server_apps() {
    mv "$app_name" server/apps
}

create_django_app
update_apps_py_to_use_full_module_path
move_app_to_server_apps
