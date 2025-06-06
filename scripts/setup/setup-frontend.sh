#!/bin/bash

# Exit on error
set -e

echo "Setting up frontend server..."

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
else
    echo "Bun is already installed. Yay."
fi

# Change to frontend directory
cd app || {
    echo "Error: Could not find 'app' directory. Make sure you're in the project root."
    exit 1
}

# Install dependencies
echo "Installing npm packages..."
bun i

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file from sample..."
    cp .env.development.local.sample .env
fi

echo "Frontend setup completed successfully!"
echo "To start the frontend server, run: bun dev"