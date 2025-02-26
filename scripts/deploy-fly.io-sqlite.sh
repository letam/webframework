#!/usr/bin/env bash

# Create app without launching
fly launch --vm-memory 512 --ha=false --no-db --now --build-only

# Set database location
flyctl secrets set DATABASE_URL=sqlite:////data/db.sqlite3

# Launch app
fly deploy

# Run migrations
fly ssh console -C 'python manage.py migrate'
