# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Django + React web framework for rapid development of web applications. The primary application is a micro-blogging platform with public posts, media uploads (audio/video/image), and AI-powered transcription.

## Architecture

### Backend (Django)

- **Location**: `server/`
- **Framework**: Django 5.2.5 with Django REST Framework 3.15.2
- **Python**: 3.13+ (managed by `uv`)
- **Config**: `server/config/settings.py`, `server/config/urls.py`
- **Database**: SQLite for development (`server/db.sqlite3`), PostgreSQL for production
- **Apps** (in `server/apps/`):
  - `website` - Serves the frontend (index.html in production, proxies in dev)
  - `users` - Custom User model (extends AbstractUser), management commands for initialization
  - `blogs` - Core app: Post and Media models, DRF ViewSet, media utilities, transcription
  - `uploads` - Cloudflare R2/S3 presigned URL generation for direct file uploads
  - `auth` - Session-based authentication (login, signup, logout, CSRF, status endpoints)

### Frontend (React + Vite)

- **Location**: `app/`
- **Framework**: React 19 with TypeScript, Vite 6 bundler
- **UI Components**: shadcn/ui with Radix UI primitives (40+ components in `app/src/components/ui/`)
- **Styling**: Tailwind CSS v4
- **State Management**: TanStack Query for server state, React Context for auth/theme
- **Routing**: React Router v7 (routes: `/`, `/profile`, `/settings`, `/debug`)
- **Entry Point**: `app/src/main.tsx`
- **Pages**: `app/src/pages/`
- **Components**: `app/src/components/` (post/, feed/, settings/, ui/)
- **Hooks**: `app/src/hooks/` (useAuth, usePosts, usePostFilters, useTags)
- **API Client**: `app/src/lib/api/` (posts.ts, auth.ts) with CSRF-aware fetch wrapper

### Key API Endpoints

- `GET /healthz/` - Health check endpoint that verifies database readiness
- `POST /auth/csrf/` - Get CSRF token
- `POST /auth/login/`, `/auth/signup/`, `/auth/logout/`, `/auth/status/` - Authentication
- `GET/POST /api/posts/` - List/create posts (DRF router)
- `GET/PUT/PATCH/DELETE /api/posts/<id>/` - Post detail operations
- `POST /api/posts/<id>/transcribe/` - Enqueue post media transcription via OpenAI Whisper (returns 202)
- `GET /api/uploads/presign/` - Get presigned S3 upload URL
- `GET /api/posts/<id>/media/` - Stream post media (supports range requests)
- `GET /p/<id>/` - Post detail page with Open Graph metadata

## Development Commands

### Quick Start

```bash
# Full project setup (installs deps, runs migrations, creates env files)
./admin/setup/setup-all.sh

# Start both backend and frontend in tmux
./admin/dev/start-tmux-session.sh
# Or using justfile
just dev
```

### Backend

```bash
# Start Django development server
uv run python server/manage.py runserver_plus
# Or: just runserver

# Database migrations
uv run python server/manage.py makemigrations
uv run python server/manage.py migrate
# Or: just makemigrations / just migrate

# Django shell (shell_plus from django-extensions)
uv run python server/manage.py shell_plus
# Or: just shell

# Run backend tests
uv run python server/manage.py test
# Or: just test

# Create superuser
uv run python server/manage.py createsuperuser
# Or: just createsuperuser

# Initialize users (superuser + anonymous user for anonymous posts)
uv run python server/manage.py init_users

# Python linting/formatting
ruff check server/
ruff format server/
# Or use black + isort:
black server/
isort server/
```

### Frontend

All frontend commands should be run from the `app/` directory.

```bash
cd app

# Install dependencies
bun install

# Start development server (Vite dev server on port 5173)
bun dev

# Build for production
bun run build

# Build for development (non-minified)
bun run build:dev

# Linting and formatting
bun run lint          # ESLint
bun run check         # Biome check
bun run format        # Biome format (write)
bun run format:check  # Biome format (check only)

# Tests
bun run test          # Run Vitest once (bare `bun test` runs Bun's own runner and fails)
bun run test:watch    # Watch mode
bun run test:coverage # Coverage report

# E2E tests (Playwright)
bun run test:e2e         # Headless
bun run test:e2e:headed  # Visible browser
bun run test:e2e:ui      # Interactive UI
bun run test:e2e:debug   # Debug mode
```

### Project-Level

```bash
# Biome format/check from root
npx @biomejs/biome format --write .
npx @biomejs/biome check .

# Production build (Docker)
./admin/prod/build-prod.sh
```

## Code Style and Conventions

### Python/Django

- **Formatter**: Black (preserves string quotes, line length 99)
- **Import sorting**: isort (black profile)
- **Linter**: Ruff (target Python 3.13, Django-specific rules enabled)
- **Docstrings**: Google convention
- **Line length**: 99 characters
- **Migrations**: Excluded from formatting/linting
- **Type checking**: Pyright configured for `admin/` and `server/` directories
- **Stubs**: django-stubs and djangorestframework-stubs for type hints

### TypeScript/React

- **Formatter**: Biome (tab indentation, 2 spaces width, line width 100)
- **Linter**: ESLint + Biome
- **Quotes**: Single quotes, no semicolons
- **Trailing commas**: ES5 style
- **Components**: Functional components with TypeScript
- **UI library**: shadcn/ui patterns - components in `app/src/components/ui/`
- **Path alias**: `@` maps to `app/src/`
- **TypeScript**: Strict mode is disabled; target ES2020

### Testing

- **Backend**: Django's built-in test framework. Tests in `server/apps/blogs/tests/`
  - `BaseTestCase` and `ViewTestCase` base classes in `tests/__init__.py`
  - Model tests cover Media/Post creation, deletion cascading, file cleanup, ffprobe integration
- **Frontend**: Vitest with React Testing Library. Tests in `app/src/__tests__/`
  - Component tests, hook tests, API client tests
  - Mock data in `__tests__/data/mockPosts.ts`
  - E2E tests with Playwright (`playwright.config.ts`)
- **CI gates**: Ruff check/format, Biome, backend tests, frontend type/unit/build checks, and
  Playwright e2e on pushes/PRs
- Run tests before committing significant changes

## Project Structure

```
webframework/
├── admin/                      # Scripts and configs
│   ├── configs/                # Fly.io deployment configs (SQLite/Postgres)
│   ├── deploy/                 # Deployment launch scripts
│   ├── dev/                    # Dev scripts (tmux session, django-startapp)
│   ├── justfiles/              # Just recipe files (dev, django, fly.io)
│   ├── prod/                   # Production build script
│   └── setup/                  # Setup scripts (all, backend, frontend, mac)
├── app/                        # React frontend
│   ├── public/                 # Static assets
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── post/           # Post display & creation components
│   │   │   │   └── create/     # CreatePost, AudioPostTab, VideoPostTab, etc.
│   │   │   ├── feed/           # Feed filtering components
│   │   │   ├── settings/       # Settings page components
│   │   │   └── ui/             # shadcn/ui primitives (40+ components)
│   │   ├── hooks/              # Custom React hooks
│   │   ├── lib/                # Utilities and API client
│   │   │   ├── api/            # API functions (posts.ts, auth.ts)
│   │   │   └── utils/          # Helpers (fetch, browser, file, media, audio)
│   │   ├── pages/              # Route page components
│   │   ├── types/              # TypeScript type definitions
│   │   ├── utils/              # Tag parsing utilities
│   │   └── __tests__/          # Frontend tests
│   ├── biome.json              # Biome config
│   ├── eslint.config.js        # ESLint config
│   ├── index.html              # HTML entry point
│   ├── package.json            # Frontend dependencies
│   ├── playwright.config.ts    # E2E test config
│   ├── tsconfig.json           # TypeScript config
│   └── vite.config.ts          # Vite build config
├── server/                     # Django backend
│   ├── apps/
│   │   ├── auth/               # Authentication views (login, signup, logout, CSRF)
│   │   ├── blogs/              # Core: models, views, serializers, tests, utils
│   │   │   ├── models.py       # Post, Media models
│   │   │   ├── views.py        # PostViewSet, media streaming, transcription
│   │   │   ├── serializers.py  # DRF serializers
│   │   │   ├── transcription.py # OpenAI Whisper integration
│   │   │   ├── utils/          # Media duration, MP3 conversion, MIME types
│   │   │   └── tests/          # Model and view tests
│   │   ├── uploads/            # S3/R2 presigned URL generation
│   │   ├── users/              # Custom User model, init_users management command
│   │   └── website/            # Frontend serving (index.html, static files)
│   ├── config/
│   │   ├── settings.py         # Django settings
│   │   ├── urls.py             # URL routing
│   │   └── wsgi.py             # WSGI configuration
│   └── manage.py               # Django management CLI
├── dev/                        # Development configuration files
├── html/                       # Static HTML for production
├── sys/                        # System utility scripts
├── .github/                    # GitHub Actions (Fly.io deploy workflow)
├── biome.json                  # Root Biome config
├── Dockerfile                  # Multi-stage build (backend + frontend)
├── fly.toml                    # Fly.io deployment config
├── justfile                    # Task runner (imports from admin/justfiles/)
├── package.json                # Root (Biome dev dependency)
├── pyproject.toml              # Python config (deps, ruff, black, isort, pyright)
└── pyrightconfig.json          # Python type checker config
```

## Environment Configuration

### Backend (`server/.env`)

See `server/.env.example` for template. Key variables:

- `DEBUG` - Enable/disable debug mode
- `SECRET_KEY` - Django secret key
- `DATABASE_URL` - Database connection (SQLite or PostgreSQL)
- `MEDIA_URL`, `MEDIA_ROOT` - Media file serving
- `USE_LOCAL_FILE_STORAGE` - `True` for local dev, `False` for S3/R2
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` - Cloudflare R2 credentials
- `R2_ENDPOINT_DOMAIN` - R2 endpoint (default: `r2.cloudflarestorage.com`)
- `OPENAI_API_KEY` - For audio transcription via Whisper API

### Frontend (`app/.env`)

See `app/.env.development.local.sample` for template:

- `VITE_SERVER_HOST` - Backend server URL (e.g., `//localhost:8000` for local dev)
- `VITE_UPLOAD_FILES_TO_S3` - `true` to upload directly to S3/R2

## Deployment

### Fly.io

- **Config**: `fly.toml` (main), `admin/configs/fly-sqlite.toml`, `admin/configs/fly-postgres.toml`
- **Release command**: `python manage.py migrate --noinput`
- **Server**: Gunicorn on port 8000
- **Static files**: Served by WhiteNoise at `/static/`
- **VM**: 512MB RAM, 1 shared CPU, US East (iad)

```bash
# Deploy with SQLite
just fly-deploy-app-sqlite

# Deploy with PostgreSQL
just fly-deploy-app-postgres

# Launch new app
just fly-launch-app-sqlite
just fly-launch-app-postgres
```

### Docker

Multi-stage Dockerfile:
1. `build-backend` - Python deps via uv, static file collection
2. `build-frontend` - React build via Bun
3. `production` - Combines both, installs ffmpeg, runs Gunicorn

### GitHub Actions

- `.github/workflows/fly-deploy.yml` - Manual deploy to Fly.io (workflow_dispatch)
- Requires `FLY_API_TOKEN` secret

## Middleware Stack

1. SecurityMiddleware - Security headers
2. WhiteNoiseMiddleware - Static file serving with compression
3. SessionMiddleware - Session management
4. CorsMiddleware - CORS headers (django-cors-headers)
5. CommonMiddleware - URL normalization, etc.
6. CsrfViewMiddleware - CSRF protection
7. AuthenticationMiddleware - User authentication
8. MessageMiddleware - Flash messages
9. XFrameOptionsMiddleware - Clickjacking protection
10. CSPMiddleware - Content Security Policy (django-csp)

## Important Notes

- **Package managers**: `uv` for Python, `bun` for JavaScript
- **Task runner**: `just` (justfile) wraps common Django and deployment commands
- **Media processing**: Requires `ffmpeg` and `ffprobe` (installed in Docker, needed locally for media features)
- **Authentication**: Session-based with CSRF tokens; frontend caches CSRF token via fetch wrapper
- **CORS**: Configured for `localhost:3000`, `localhost:5173`, `127.0.0.1:5173` in development
- **Anonymous posts**: Supported via a dedicated anonymous user (ID=2), created by `init_users` command
- **S3 URLs**: Presigned URLs for media are cached for 1 minute on the frontend
- **Transcription tasks**: Transcription runs via django-tasks (immediate backend in dev/tests, DB backend + `db_worker` in production, started by `server/start-prod.sh`; `just worker` runs it locally)
- **Sentry**: Env-gated error monitoring (`SENTRY_DSN` backend, `VITE_SENTRY_DSN` + `SENTRY_FRONTEND_INGEST_FOR_CSP` frontend)
- **Media streaming**: Supports HTTP range requests for Safari audio/video compatibility
- **Open Graph**: Post detail pages (`/p/<id>/`) render OG metadata for social sharing
