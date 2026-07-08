# Phase 3 — polish (2026-07-07 afternoon, four slice commits)

Triggered by "phase 3" after a "what now?" checkpoint (where it emerged Tam had pushed the first three commits themselves; origin/main at `96982ac`). Executed as four independently-committable slices, each via the pipeline: fable-5 spec (slice-a/b/c/d-prompt.md in the session scratchpad) → gpt-5.5 `codex exec -s workspace-write -c model_reasoning_effort=xhigh` → fable-5 judge/verify/patch. Final state: **104 backend / 25 frontend / 17 e2e tests green; ruff + biome clean repo-wide**. Part of [project overview](2026-07-project-overview.md).

## Slice A — background transcription (`66dca51`)

Whisper no longer blocks a gunicorn worker. `POST /api/posts/<id>/transcribe/` marks the media pending, enqueues a **django-tasks** job, returns 202; `Media.transcript_status` (pending/done/error, migration 0017 marks existing transcripts done); idempotent while pending; failures surface as `error`. Frontend: author/admin's client polls `getPost` every 3s with a 3-minute cap and a `timedOutTranscriptionsRef` Set preventing restart loops; button shows a Transcribing state. Infrastructure: django-tasks 0.12 + django-tasks-db (the DB backend split into its own package at 0.12 — a discovery during context-gathering); dev/tests run the ImmediateBackend (`TASKS_IMMEDIATE`, default DEBUG); prod runs `manage.py db_worker` beside gunicorn via new `server/start-prod.sh` (`wait -n; exit 1` so Fly restarts the machine if either dies); SQLite got WAL + synchronous=NORMAL + `transaction_mode='IMMEDIATE'` + 20s timeout so web and worker can write concurrently; `just worker` for local use.

## Slice B — bundle, resilience, Lovable cleanup (`0ebf5c0`)

Initial JS **770KB (236KB gz) → 644KB (201KB gz)**. Codex's route-splitting (lazy Profile/Settings/Debug/NotFound) only bought ~15KB, so fable-5 profiled the bundle directly (vite-bundle-visualizer → bundle-stats.txt): the real weight was `webm-duration-fix` dragging Node `buffer`/`events` polyfills into every page. Made it a lazy ~110KB chunk loaded when a recording actually stops — required converting **all three** use sites (audio.ts, AudioRecorder, VideoRecorder) to dynamic import, because a module imported statically anywhere stays in the main chunk. Also: `AppErrorBoundary` with a themed fallback (reload + details) instead of a white screen; removed `cdn.gpteng.co` script, `lovable-tagger`, the dead recharts/chart.tsx scaffold, and the Dockerfile sed hacks that stripped them at build time; real meta/OG descriptions, theme-color, and a web manifest. react-dom (~527KB rendered) is the remaining floor; date-fns/react-hook-form are the next candidates if more is wanted.

## Slice C — ops (`b2b3198`)

`/healthz/` answered by a **first-position middleware** (cheap SELECT 1) so Fly's HTTP checks work regardless of Host header without weakening ALLOWED_HOSTS; `[[http_service.checks]]` wired into fly.toml and both alt configs. Sentry env-gated on both sides: backend `SENTRY_DSN` (PII off, tracing off by default); frontend `VITE_SENTRY_DSN` with `@sentry/react` *dynamically imported* — zero bundle cost until a DSN is set; ErrorBoundary reports crashes; `SENTRY_FRONTEND_INGEST_FOR_CSP` extends connect-src. Postgres readiness: `CONN_MAX_AGE=60` + `CONN_HEALTH_CHECKS=True` when DATABASE_URL is postgres.

## Slice D — validation + gates (`1c77bd1`)

Image uploads byte-validated with Pillow (`Image.open().verify()`) on both the direct path (seek(0) in finally) and the S3 path (temp download; garbage labeled `image/*` → 400 + R2 object deleted — matching the ffprobe treatment of audio/video). Ruff backlog (56 findings, mostly docstrings) cleared across auth/users/website/config. CI grew: `backend-lint` job (pinned `uvx ruff@0.15.20 check --no-fix` + `format --check`), `biome ci` in the frontend job, and a Playwright e2e job that runs on pushes/PRs **but not deploy dispatches** so a flaky browser test can never block a ship. Local Playwright isolated on strict port 5174 with `reuseExistingServer: false`; CI stays on 5173.

## Judge-layer notes

All four codex diffs were faithful to spec; the notable mid-flight problems (ruff `fix = true` mutating a file during inspection, a codex process detaching from task tracking and spawning the infamous watcher shell, uv add writing `>=` against the repo's `==` pinning convention) are catalogued in [incidents & lessons](2026-07-incidents-lessons.md).
