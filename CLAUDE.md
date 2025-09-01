# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Django + React web framework for rapid development of web applications. Features a micro-blogging app with public posts functionality.

## Architecture

### Backend (Django)
- **Location**: `server/` directory
- **Framework**: Django 5.1.5 with Django REST Framework
- **Apps**: Located in `server/apps/`
  - `website` - Main website functionality
  - `users` - User management
  - `blogs` - Blogging features
  - `uploads` - File upload handling
  - `auth` - Authentication
- **Config**: `server/config/settings.py` and `server/config/urls.py`
- **Database**: SQLite for development (`server/db.sqlite3`), PostgreSQL for production

### Frontend (React + Vite)
- **Location**: `app/` directory
- **Framework**: React 19 with TypeScript, Vite bundler
- **UI Components**: shadcn/ui with Radix UI primitives
- **Styling**: Tailwind CSS v4
- **Entry Point**: `app/src/main.tsx`
- **Pages**: `app/src/pages/`
- **Components**: `app/src/components/`
- **API Client**: TanStack Query for data fetching

## Development Commands

### Backend Commands
```bash
# Start Django development server
uv run python server/manage.py runserver_plus
# Or using justfile
just dev

# Database migrations
uv run python server/manage.py makemigrations
uv run python server/manage.py migrate
# Or using justfile
just makemigrations
just migrate

# Django shell
uv run python server/manage.py shell_plus
# Or using justfile
just shell

# Run backend tests
uv run python server/manage.py test
# Or using justfile
just test

# Create superuser
uv run python server/manage.py createsuperuser
# Or using justfile
just createsuperuser

# Python linting/formatting
black server/
isort server/
# Or use ruff (configured in pyproject.toml)
ruff check server/
ruff format server/
```

### Frontend Commands
```bash
# Navigate to frontend directory first
cd app

# Start development server
bun dev

# Build for production
bun run build

# Build for development
bun run build:dev

# Run linting
bun run lint

# Format code
bun run format

# Check formatting
bun run format:check

# Run tests
bun test
bun run test:watch
bun run test:coverage
```

### Project-Level Commands
```bash
# Format JavaScript/TypeScript files (using Biome)
npx @biomejs/biome format --write .
npx @biomejs/biome check .

# Start both servers using tmux
./scripts/start-dev-session.sh

# Build for production
./scripts/build-prod.sh
```

## Code Style and Conventions

### Python/Django
- Use Black for formatting (configured to preserve string quotes)
- Use isort for import sorting
- Ruff is configured for linting with Django-specific rules
- Follow Google docstring convention
- Line length: 99 characters

### TypeScript/React
- Use Biome for formatting and linting
- Tab indentation with 2 spaces width
- Single quotes for strings
- Trailing commas in ES5 style
- Components use functional components with TypeScript
- Use shadcn/ui component patterns

### Testing
- Backend: Django's built-in test framework
- Frontend: Vitest with React Testing Library
- Run tests before committing significant changes

## Important Notes

- Package managers: `uv` for Python, `bun` for JavaScript
- Environment files: `.env` files in both `server/` and `app/` directories
- Static files are served by WhiteNoise in production
- CORS is configured for local development
- The project supports deployment to Fly.io with both SQLite and PostgreSQL configurations
- File uploads can use local storage or Cloudflare R2 (S3-compatible)