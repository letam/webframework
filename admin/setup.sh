#!/bin/bash

# Exit on error
set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Function to log messages
log() {
    echo "$1"
}

# Function to run setup script
run_setup() {
    local script_name="$1"
    local script_path="$2"

    log "=== Running $script_name ==="
    if ! "$script_path"; then
        log "Error: $script_name failed."
        exit 1
    fi
    log "=== $script_name completed successfully ==="
}

# Change to project root
cd "$PROJECT_ROOT" || {
    log "Error: Could not change to project root directory"
    exit 1
}

log "Starting full project setup..."
log ""

# Run macOS setup
if [[ "$OSTYPE" == "darwin"* ]]; then
    run_setup "macOS Setup" "$SCRIPT_DIR/setup/setup-mac.sh"
    log ""
fi

# Run backend setup
run_setup "Backend Setup" "$SCRIPT_DIR/setup/setup-backend.sh"
log ""

# Run frontend setup
run_setup "Frontend Setup" "$SCRIPT_DIR/setup/setup-frontend.sh"
log ""

log ""
log "=== Setup Complete ==="
log "🚀 To start the development servers:"
log "1. In a new terminal, run: uv run python server/manage.py runserver_plus"
log "2. In another terminal, run: cd app && bun dev"
log "Then access the web app at: http://localhost:8000"
