#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

function Log($msg) {
    Write-Host $msg
}

Log "Setting up backend server..."

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Log "Installing uv..."
    # Install uv using the official PowerShell script
    iex (irm https://astral.sh/uv/install.ps1)
    $envScript = Join-Path $HOME ".local/bin/env"
    if (Test-Path $envScript) {
        . $envScript
    }
} else {
    Log "uv is already installed. Yay."
}

Log "Installing Python dependencies with uv..."
uv sync

Log "Running database migrations..."
uv run python server/manage.py migrate

Log ""
Log "🚀 Backend setup completed successfully!"
Log "To start the backend server, run: uv run python server/manage.py runserver_plus"
Log ""
Log "If you see the error 'uv : The term 'uv' is not recognized', then either"
Log "run the command in a new terminal,"
Log "or first execute the command: . $HOME/.local/bin/env"
