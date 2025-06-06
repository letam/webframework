#!/bin/bash

# Exit on error
set -e

# Parse command line arguments
VERBOSE=0
while getopts "v" opt; do
    case $opt in
        v)
            VERBOSE=1
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            exit 1
            ;;
    esac
done

# Function to log messages
log() {
    if [ "$VERBOSE" -eq 1 ]; then
        echo "$1"
    fi
}

log "Setting up backend server..."

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    log "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
else
    log "uv is already installed. Yay."
fi

# Install Python dependencies with uv
log "Installing Python dependencies with uv..."
uv sync

# Run migrations
log "Running database migrations..."
uv run python server/manage.py migrate

log "Backend setup completed successfully!"
log "To start the backend server, run: uv run python server/manage.py runserver_plus"