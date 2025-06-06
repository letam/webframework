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

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Create timestamp for log file
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$PROJECT_ROOT/.tmp/setup_${TIMESTAMP}.log"

# Ensure .tmp directory exists
mkdir -p "$PROJECT_ROOT/.tmp"

# Function to log messages
log() {
    echo "$1" | tee -a "$LOG_FILE"
}

# Function to run setup script and capture output
run_setup() {
    local script_name="$1"
    local script_path="$2"

    log "=== Running $script_name ==="
    if [ "$VERBOSE" -eq 1 ]; then
        # In verbose mode, show all output
        if ! "$script_path" -v > >(tee -a "$LOG_FILE") 2> >(tee -a "$LOG_FILE" >&2); then
            log "Error: $script_name failed. Check $LOG_FILE for details."
            exit 1
        fi
    else
        # In normal mode, only show errors
        if ! "$script_path" > >(tee -a "$LOG_FILE" > /dev/null) 2> >(tee -a "$LOG_FILE" >&2); then
            log "Error: $script_name failed. Check $LOG_FILE for details."
            exit 1
        fi
    fi
    log "=== $script_name completed successfully ==="
}

# Change to project root
cd "$PROJECT_ROOT" || {
    log "Error: Could not change to project root directory"
    exit 1
}

log "Starting full project setup..."
log "Log file: $LOG_FILE"
[ "$VERBOSE" -eq 1 ] && log "Running in verbose mode"

# Run backend setup
run_setup "Backend Setup" "$SCRIPT_DIR/setup/setup-backend.sh"

# Run frontend setup
run_setup "Frontend Setup" "$SCRIPT_DIR/setup/setup-frontend.sh"

log ""
log "=== Setup Complete ==="
log "To start the development servers:"
log "1. In one terminal, run: python server/manage.py runserver_plus"
log "2. In another terminal, run: cd app && bun dev"
log "Then access the web app at: http://localhost:8000"

[ "$VERBOSE" -eq 1 ] && log "Full setup log available at: $LOG_FILE"