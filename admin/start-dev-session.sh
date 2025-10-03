#!/bin/bash

# Start development tmux session with 2 windows
# Usage: ./scripts/start-dev-session.sh

SESSION_NAME="web-framework-dev"

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed. Please install tmux first."
    echo "On macOS: brew install tmux"
    echo "On Ubuntu/Debian: sudo apt-get install tmux"
    exit 1
fi

# Kill existing session if it exists
tmux kill-session -t $SESSION_NAME 2>/dev/null

# Create new session with first window
tmux new-session -d -s $SESSION_NAME -n "servers"

# Split the first window horizontally into 2 panes
tmux split-window -h -t $SESSION_NAME:servers

# Set up the panes in the first window:
# Pane 0 (left): Backend server
tmux send-keys -t $SESSION_NAME:servers.0 " uv run python server/manage.py runserver_plus" Enter

# Pane 1 (right): Frontend server
tmux send-keys -t $SESSION_NAME:servers.1 " cd app && bun dev" Enter

# Set pane titles for first window
tmux select-pane -t $SESSION_NAME:servers.0 -T "Backend Server"
tmux select-pane -t $SESSION_NAME:servers.1 -T "Frontend Server"

# Create second window
tmux new-window -t $SESSION_NAME -n "cli"

# Split the second window horizontally into 2 panes
tmux split-window -h -t $SESSION_NAME:cli

# Set up the panes in the second window:
# Pane 0 (left): CLI at project root
tmux send-keys -t $SESSION_NAME:cli.0 " clear" Enter

# Pane 1 (right): CLI in app directory
tmux send-keys -t $SESSION_NAME:cli.1 " cd app && clear" Enter

# Set pane titles for second window
tmux select-pane -t $SESSION_NAME:cli.0 -T "CLI (Root)"
tmux select-pane -t $SESSION_NAME:cli.1 -T "CLI (App)"

# Select the first window and first pane (backend server)
tmux select-window -t $SESSION_NAME:servers
tmux select-pane -t $SESSION_NAME:servers.0

# Attach to the session
echo "Starting tmux development session..."
echo "Session name: $SESSION_NAME"
echo ""
echo "Window layout:"
echo ""
echo "Window 1: 'servers'"
echo "┌─────────────────┬─────────────────┐"
echo "│ Backend Server  │ Frontend Server │"
echo "│ (uv runserver)  │ (bun dev)       │"
echo "└─────────────────┴─────────────────┘"
echo ""
echo "Window 2: 'cli'"
echo "┌─────────────────┬─────────────────┐"
echo "│ CLI (Root)      │ CLI (App)       │"
echo "│ (project root)  │ (app directory) │"
echo "└─────────────────┴─────────────────┘"
echo ""
echo "Useful tmux commands:"
echo "  Ctrl+b c     - Create new window"
echo "  Ctrl+b n     - Next window"
echo "  Ctrl+b p     - Previous window"
echo "  Ctrl+b 0-9   - Switch to window number"
echo "  Ctrl+b %     - Split vertically"
echo "  Ctrl+b \"     - Split horizontally"
echo "  Ctrl+b arrow - Navigate between panes"
echo "  Ctrl+b z     - Toggle pane zoom (maximize/restore)"
echo "  Ctrl+b d     - Detach from session"
echo ""
echo "To reattach later: tmux attach-session -t $SESSION_NAME"
echo ""

tmux attach-session -t $SESSION_NAME