#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

function Log($msg) {
    Write-Host $msg
}

Log "Setting up frontend server..."

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Log "Installing Bun..."
    # Install Bun using the official PowerShell script
    iex (irm bun.sh/install.ps1)
    $env:PATH = "$HOME/.bun/bin;" + $env:PATH
} else {
    Log "Bun is already installed. Yay."
}

Set-Location "app" -ErrorAction Stop

Log "Installing npm packages..."
bun install

if (-not (Test-Path ".env")) {
    Log "Creating .env file from sample..."
    Copy-Item ".env.development.local.sample" ".env"
}

Log ""
Log "🚀 Frontend setup completed successfully!"
Log "To start the frontend server, run: bun dev"
Log ""
Log "If you see the error 'bun : The term 'bun' is not recognized', then either"
Log "run the command in a new terminal,"
Log 'or first execute the command: $env:PATH = "$HOME/.bun/bin;" + $env:PATH'
