#!/bin/bash

# Additional setup for macOS

# Exit on error
set -e

# Install gsed if not installed
if ! command -v gsed &> /dev/null; then
		mkdir -p ~/.local/bin
		curl -L https://github.com/letam/gsed-mac/raw/refs/heads/main/gsed -o ~/.local/bin/gsed
		chmod +x ~/.local/bin/gsed
		echo "gsed installed to ~/.local/bin/gsed"
else
		echo "gsed is already installed"
fi
