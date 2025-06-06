#!/bin/bash

# Exit on error
set -e

echo "Starting full project setup..."

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root
cd "$PROJECT_ROOT" || {
    echo "Error: Could not change to project root directory"
    exit 1
}

# Run backend setup
echo "=== Setting up Backend ==="
"$SCRIPT_DIR/setup/setup-backend.sh"

# Run frontend setup
echo "=== Setting up Frontend ==="
"$SCRIPT_DIR/setup/setup-frontend.sh"

echo ""

echo "=== Setup Complete ==="
echo "To start the development servers:"
echo "1. In one terminal, run: python server/manage.py runserver_plus"
echo "2. In another terminal, run: cd app && bun dev"
echo "Then access the web app at: http://localhost:8000"