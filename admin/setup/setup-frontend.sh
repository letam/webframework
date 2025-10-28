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

log "Setting up frontend server..."

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    log "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
else
    log "Bun is already installed. Yay."
fi

# Change to frontend directory
cd app || {
    echo "Error: Could not find 'app' directory. Make sure you're in the project root."
    exit 1
}

# Install dependencies
log "Installing npm packages..."
bun i

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    log "Creating .env file from sample..."
    cp .env.development.local.sample .env
fi

log ""
log "🚀 Frontend setup completed successfully!"
log "To start the frontend server, run: bun dev"
log ""
log "If you see the error 'command not found: bun', then either"
log "run the command in a new terminal,"
log 'or first execute the command: source export PATH="$HOME/.bun/bin:$PATH"'
