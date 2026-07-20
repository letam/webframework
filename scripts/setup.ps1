#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

# Get the directory where this script resides
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path $ScriptDir -Parent

function Log($msg) {
    Write-Host $msg
}

function Run-Setup($scriptName, $scriptPath) {
    Log "=== Running $scriptName ==="
    & $scriptPath
    if ($LASTEXITCODE -ne 0) {
        Log "Error: $scriptName failed."
        exit 1
    }
    Log "=== $scriptName completed successfully ==="
}

Set-Location $ProjectRoot

Log "Starting full project setup..."
Log ""

Run-Setup "Backend Setup" "$ScriptDir/setup/setup-backend.ps1"
Log ""
Run-Setup "Frontend Setup" "$ScriptDir/setup/setup-frontend.ps1"
Log ""

Log ""
Log "=== Setup Complete ==="
Log "🚀 To start the development servers:"
Log "1. In a new terminal, run: uv run python server/manage.py runserver_plus"
Log "2. In another terminal, run: cd app && bun dev"
Log "Then access the web app at: http://localhost:8000"
