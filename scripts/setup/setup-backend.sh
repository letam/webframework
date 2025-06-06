#!/bin/bash

# Exit on error
set -e

echo "Setting up backend server..."

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3 first."
    echo "Install from https://www.python.org/downloads/"
    exit 1
fi

# Create and activate virtual environment
echo "Creating Python virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Upgrade pip and install requirements
echo "Installing project requirements..."
pip install -U pip
pip install -r requirements.txt

# Run migrations
echo "Running database migrations..."
python server/manage.py migrate

echo "Backend setup completed successfully!"
echo "To start the backend server, run: python server/manage.py runserver_plus"