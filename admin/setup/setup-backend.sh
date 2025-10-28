#!/bin/bash

# Exit on error
set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Function to log messages
log() {
    echo "$1"
}

# Change to project root directory
cd "$PROJECT_ROOT" || {
    log "Error: Could not change to project root directory"
    exit 1
}

log "Setting up backend server..."

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    log "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source $HOME/.local/bin/env
else
    log "uv is already installed. Yay."
fi

# Install Python dependencies with uv
log "Installing Python dependencies with uv..."
uv sync

# Run migrations
log "Running database migrations..."
uv run python server/manage.py migrate

log ""
log "🚀 Backend setup completed successfully!"
log "To start the backend server, run: uv run python server/manage.py runserver_plus"
log ""
log "If you see the error 'command not found: uv', then either"
log "run the command in a new terminal,"
log "or first execute the command: source \$HOME/.local/bin/env"
