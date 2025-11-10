#!/bin/bash

# Launch script for the web application
# This script starts both the Django backend and React frontend servers

SESSION_NAME="web-framework-dev"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure PATH includes uv and bun
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

echo "==================================="
echo "Launching Web Application"
echo "==================================="
echo ""

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "⚠️  tmux is not installed. Starting servers in background..."
    echo ""
    
    # Start backend server in background
    echo "Starting Django backend server on http://127.0.0.1:8000"
    cd "$SCRIPT_DIR" && uv run python server/manage.py runserver_plus > /tmp/backend.log 2>&1 &
    BACKEND_PID=$!
    echo "Backend PID: $BACKEND_PID"
    
    # Start frontend server in background
    echo "Starting React frontend server on http://localhost:5173"
    cd "$SCRIPT_DIR/app" && bun dev > /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo "Frontend PID: $FRONTEND_PID"
    
    echo ""
    echo "==================================="
    echo "✅ Application launched successfully!"
    echo "==================================="
    echo ""
    echo "Backend:  http://127.0.0.1:8000"
    echo "Frontend: http://localhost:5173"
    echo ""
    echo "Backend PID: $BACKEND_PID (log: /tmp/backend.log)"
    echo "Frontend PID: $FRONTEND_PID (log: /tmp/frontend.log)"
    echo ""
    echo "To stop the servers:"
    echo "  kill $BACKEND_PID $FRONTEND_PID"
    echo ""
    
    # Save PIDs to file for easy cleanup
    echo "$BACKEND_PID" > /tmp/web-app-backend.pid
    echo "$FRONTEND_PID" > /tmp/web-app-frontend.pid
    
    exit 0
fi

# If tmux is available, use the proper tmux script
echo "Using tmux for better terminal management..."
exec "$SCRIPT_DIR/admin/dev/start-tmux-session.sh"
