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

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3 first."
    echo "Install from https://www.python.org/downloads/"
    exit 1
fi

# Create and activate virtual environment
log "Creating Python virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Upgrade pip and install requirements
log "Installing project requirements..."
pip install -U pip
pip install -r requirements.txt

# Run migrations
log "Running database migrations..."
python server/manage.py migrate

log "Backend setup completed successfully!"
log "To start the backend server, run: python server/manage.py runserver_plus"