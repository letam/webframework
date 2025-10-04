# justfile for actions on fly.io


# Deploy app with SQLite config
fly-deploy-app-sqlite app_name:
    fly deploy --config admin/configs/fly-sqlite.toml --app {{app_name}}


# Deploy app with Postgres config
fly-deploy-app-postgres app_name:
    fly deploy --config admin/configs/fly-postgres.toml --app {{app_name}}


# Launch app with local SQLite database
fly-launch-app-sqlite app_name:
    ./admin/deploy/launch-fly.io-sqlite.sh {{app_name}}


# Launch app with remote Postgres database
fly-launch-app-postgres app_name:
    ./admin/deploy/launch-fly.io-postgres.sh {{app_name}}


# Launch app (with local SQLite database)
fly-launch-app app_name:
    ./admin/deploy/launch-fly.io-sqlite.sh {{app_name}}


# Clone fly.io machine for app
fly-machine-clone app_name:
    app_name={{app_name}} ; \
        machine_id=$(fly machine list --app "$app_name" | grep primary | cut -f1) ; \
        fly machine clone "$machine_id" --app $app_name


# Clone enough fly.io machines to ensure high availability for app
fly-machine-clone-ha app_name:
    #!/usr/bin/env bash
    set -euo pipefail
    app_name={{app_name}}
    # Save machine list once
    machine_ids=$(fly machine list --app "$app_name" -q)

    # Count machines
    count=$(echo "$machine_ids" | wc -l | tr -d '[:space:]')
    echo "Current machine count: $count"
    first_id=$(echo "$machine_ids" | head -n 1 | cut -f1)

    # Clone until we have an odd number of machines greater than 1
    while (( count <= 1 || count % 2 == 0 )); do
        echo "Cloning machine to reach odd count > 1 (current: $count)..."
        fly machine clone "$first_id" --app "$app_name"
        ((count++))
    done

    echo "Final machine count is odd and > 1: $count"
    echo "'$app_name' is now set up for high availability!"


# Launch fly.io app with high availability
fly-launch-app-ha app_name:
    just fly-launch-app-postgres {{app_name}}
    just fly-machine-clone-ha {{app_name}}-db


# Delete fly.io replicas for machine
fly-delete-replicas app_name:
    #!/usr/bin/env bash
    set -euo pipefail
    app_name={{app_name}}
    echo "Fetching machines for '$app_name'..."
    machines=$(fly machine list --app "$app_name")
    primary_id=$(echo -e "$machines" | grep primary | cut -f1)

    if [[ -z "$primary_id" ]]; then
        echo "No primary machine detected. Aborting."
        exit 1
    fi
    echo "Primary machine is: $primary_id"

    replica_ids=$(echo -e "$machines" | grep replica | cut -f1)
    if [[ -z "$replica_ids" ]]; then
        echo "No replicas to delete. Nothing to do."
        exit 0
    fi

    for id in $replica_ids; do
        echo "Deleting replica $id..."
        fly machine destroy "$id" --app "$app_name" --force
    done

    echo "All replicas deleted for '$app_name'. Primary $primary_id kept."


# Destroy all fly.io app resources (machines, database, etc.) for app
fly-destroy-app-all app_name:
    #!/usr/bin/env bash
    set -euo pipefail
    app_name={{app_name}}
    echo "Destroying all app resources (machines, database, etc.) for $app_name..."
    apps_list=$(fly apps list -q)
    if ! echo "$apps_list" | grep -q "^$app_name\s"; then
        echo "App $app_name does not exist in your Fly.io account."
        exit 1
    fi
    fly apps destroy "$app_name"
    if echo "$apps_list" | grep -q "^$app_name-db\s"; then
        fly apps destroy "$app_name-db"
    fi
    echo "All app resources (as specified in justfile) destroyed for $app_name."
