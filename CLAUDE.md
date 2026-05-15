# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Django + React web framework ("framework on top of frameworks") for rapid web app development. Ships with a micro-blogging app that supports public posts, file/media uploads, and audio transcription.

## Architecture

Two cooperating tiers in one repo. In **development**, the backend (`runserver_plus` on `:8000`) and the frontend (`vite` via `bun dev`) run as separate processes; the app is accessed via the Vite dev server but the backend remains the source of truth for API routes. In **production**, the React app is built and copied into `server/static/app/`, and `server/apps/website/templates/website/dist/index.html` is served by Django for any non-API route via a final catch-all `re_path('', index)` in `server/config/urls.py`. That catch-all is significant: any path Django doesn't match earlier falls through to the SPA, so new backend routes must be registered **before** it.

### Backend (`server/`)
- Django 5.2.5 + DRF, Python 3.13+, managed by `uv`.
- Django apps live in `server/apps/`: `website`, `users`, `blogs`, `uploads`, `auth`.
- The `manage.py` is at `server/manage.py`, but **Python commands are run from the project root** (e.g. `uv run python server/manage.py …`).
- Routing is centralized in `server/config/urls.py` — apps do not currently define their own `urls.py`; views are imported directly and a single DRF `DefaultRouter` registers `PostViewSet` at `/api/posts/`.
- Settings split: `server/config/settings.py` (base/dev) and `server/config/settings_production.py`. Env loaded via `environs` from `server/.env` (a missing `.env` is auto-created on first run — see `check_and_create_env_file`).
- DB: SQLite in dev (`server/db.sqlite3`), Postgres in prod. WhiteNoise serves static; media can be local or Cloudflare R2 (S3-compatible via `django-storages`/`boto3`).
- Test layout is **inconsistent across apps**: `blogs/` uses a `tests/` package (`test_models.py`, `test_views.py`); `website/`, `users/`, `auth/` use a single `tests.py`. Be sure to mirror the existing structure for the app you're modifying.

### Frontend (`app/`)
- React 19 + TypeScript + Vite, managed by `bun`. UI is shadcn/ui on top of Radix; styling is Tailwind v4 (via `@tailwindcss/vite`). Data fetching is TanStack Query; routing is `react-router` v7.
- Path alias `@/` → `app/src/` (configured in `vite.config.ts` and `tsconfig.json`).
- Vite has a `base` switch: in production builds, `base` is set to `/static/app/` so the built assets resolve under Django's static URL. Don't hardcode asset paths.
- `lovable-tagger` runs only in dev mode; the production build script (`admin/prod/build-prod.sh`) strips Lovable-related script/meta tags from the served `index.html`.
- Tests: Vitest + React Testing Library (`app/src/__tests__/`) for unit/component, Playwright (`app/e2e/`) for end-to-end.

## Commands

`just` is the canonical task runner. Run `just --list` to see everything. Common recipes live in `justfile` + `admin/justfiles/{dev,django,fly.io}.just`.

### Backend (run from project root)
```bash
just dev                  # tmux session: backend + frontend + 2 CLIs (NOT just `runserver`)
just runserver            # uv run python server/manage.py runserver_plus
just migrate              # apply migrations
just makemigrations       # generate migrations
just shell                # shell_plus (django-extensions)
just test                 # full Django test suite
just createsuperuser
just collectstatic
just manage-py <args>     # generic passthrough to manage.py

# Run a single Django test (dotted path under `server/apps/`)
uv run python server/manage.py test apps.blogs.tests.test_models
uv run python server/manage.py test apps.blogs.tests.test_models.PostModelTests.test_some_case

# Python lint/format
ruff check server/ && ruff format server/
black server/ && isort server/    # also configured; black uses skip-string-normalization
```

### Frontend (run from `app/`)
```bash
bun dev                   # Vite dev server
bun run build             # production build
bun run build:dev         # dev-mode build (keeps lovable-tagger)
bun run lint              # ESLint
bun run format            # biome format --write
bun run check             # biome check
bun test                  # Vitest (single run)
bun run test:watch
bun run test:coverage
bun run test:e2e          # Playwright (also :ui, :headed, :debug, :report)

# Run a single Vitest file or test by name
bun test src/__tests__/components/Foo.test.tsx
bun test -t "renders the header"
```

### Project root
```bash
npx @biomejs/biome check .          # Biome at repo root (uses biome.json)
./admin/prod/build-prod.sh           # full prod build: migrate, collectstatic, vite build, copy into server/
./admin/setup/setup-all.sh           # first-time local setup
```

### Deploy (Fly.io)
SQLite (single-host) and Postgres (HA) configs are both supported.
```bash
just fly-launch-app <name>           # alias for fly-launch-app-sqlite
just fly-launch-app-postgres <name>
just fly-launch-app-ha <name>        # postgres + clone db machines for HA
just fly-deploy-app-sqlite <name>
just fly-deploy-app-postgres <name>
```
Fly configs are in `admin/configs/fly-{sqlite,postgres}.toml`. Note that scripts use `gsed` on macOS — install via `brew install gsed` or `admin/setup/setup-mac.sh`.

## Conventions

### Python
- Ruff (`pyproject.toml`) selects `E,F,I,DJ,D,B,N,UP`. Migrations are excluded. Line length 99. Target `py313`.
- Black config has `skip-string-normalization = true` — **don't auto-flip single↔double quotes**. Ruff's formatter mirrors this with `quote-style = "preserve"`.
- Docstring convention: Google style (enforced by `pydocstyle` via Ruff).
- `isort` profile = black.
- Pyright includes `admin` + `server` only (frontend excluded from Python type-checking).

### TypeScript / React
- Biome is the formatter and primary checker; ESLint is also wired up. **Tabs**, 2-wide; single quotes; trailing commas ES5; semicolons as needed; max line 100.
- `biome.json` ignores `dist/`, `tsconfig*.json`, `vite.config.ts`, `.vscode/` — don't fight the tool by editing those for style.
- Functional components only; use shadcn/ui patterns; place reusable logic in `app/src/hooks/`.

## Notes That Will Save You Time

- **Run all Python commands from the project root**, not from `server/`. The `.env` discovery logic checks for a `server/` child dir to decide where to look (`server/.env` vs `.env`), so cwd matters.
- New backend URL patterns must be added in `server/config/urls.py` **before** the trailing `re_path('', index)` catch-all, or they'll be swallowed by the SPA.
- `just dev` launches a tmux session with four panes (backend, frontend, two CLI shells) — it is **not** just an alias for `runserver`. If tmux isn't installed or you only want one server, use `just runserver` and `cd app && bun dev` directly.
- The production build script writes `server/static/app/` and `server/apps/website/templates/website/dist/index.html`; both are derived artifacts and shouldn't be hand-edited.
- Package managers are pinned by role: `uv` for Python (`uv.lock`), `bun` for the frontend (`app/bun.lock`). The root `package.json` exists only to pull in Biome via `npx`.
