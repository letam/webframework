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

log "Setting up frontend server..."

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    log "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
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

log "Frontend setup completed successfully!"
log "To start the frontend server, run: bun dev"