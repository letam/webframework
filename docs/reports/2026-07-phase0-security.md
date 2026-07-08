# Phase 0 — security lockdown (2026-07-06 evening, commits `9be258b` chore + `96982ac`)

Triggered by Tam's "go" right after committing Phase 2. Implemented directly by fable-5; independently reviewed by gpt-5.5 `codex review`. 13 files, +589/−108; tests 32 → 60. Part of [project overview](2026-07-project-overview.md).

## The five holes closed

1. **Default admin credentials (critical).** Migration `users/0002` (which created `admin`/`admin` on every fresh DB) rewritten as a no-op with the history kept intact; new migration `0004` revokes the credential on existing DBs (`check_password('admin', ...)` → `make_password(None)`, touching nothing else). `init_users` now reads `DJANGO_SUPERUSER_USERNAME/PASSWORD` or prompts, never defaults, and is idempotent. Also defused a landmine: the anonymous user was addressed by hardcoded ID 2, which only held *because* admin was user 1 — now looked up by `username='anonymous'` everywhere.
2. **Transcribe** — author-or-admin only (401/403), throttled per-user via a `UserRateThrottle` subclass; the UI hides the button from non-authors to match.
3. **Presign** — content-type must match `^(audio|video|image)/...` (allowing browser types like `audio/webm;codecs=opus`), filenames sanitized against S3 key smuggling (basename extraction, character allowlist, length cap), malformed JSON → 400 not 500, per-IP throttled. Kept unauthenticated deliberately — anonymous posting is a product feature. Bonus fix: the duplicate-filename rename never updated the signed key, so dedup had been silently broken.
4. **Rate limiting** — new minimal `apps/ratelimit.py` (fixed-window on `cache.add`/`incr`, client IP from Fly-Client-IP → XFF → REMOTE_ADDR): tight fixed-window limits on login and signup, plus DRF-wide anon/user rate defaults; logout no longer accepts GET (logout-by-link CSRF).
5. **Production HTTPS** behind the Fly proxy — `SECURE_PROXY_SSL_HEADER`, Secure session/CSRF cookies, HttpOnly CSRF cookie (safe: the frontend reads the token from `/auth/csrf/` JSON), HSTS 30 days. This *exposed a real latent bug*: `stream_post_media` read a nonexistent `HTTPS_RANGE` header when `is_secure()` — Safari range requests would have broken in prod the moment the proxy header landed. Fixed to always read `HTTP_RANGE`.

## Verification

- Ran `migrate` against the dev DB (which genuinely had admin/admin): `admin/admin still works: False`, password unusable, anonymous user intact.
- Live curls: logout GET → 405; unauth transcribe → 401; `text/html` presign → 400; path-traversal filename sanitized; login flood → 400s then 429s.
- `check --deploy` clean except deliberate, understood warnings (Fly's edge terminates TLS and handles the SSL redirect).
- 28 new tests (test_security.py, users/tests.py incl. running the 0004 migration function against the real registry, auth throttle tests). Throttle counters leak through the shared test cache → `cache.clear()` added to base setUp.

## Independent review (gpt-5.5)

Found **one real bug**: with 0002 no-op'd, a fresh DB has exactly one user (anonymous from 0003), so the old `init_users` skipped superuser creation and crashed on the duplicate anonymous — fixed with the idempotent `handle()` + regression tests. Second finding — presigned PUT can't validate uploaded *bytes*, only the header — acknowledged and deliberately deferred to Phase 1's media-pipeline work (where it was indeed closed, see [Phase 1 correctness](2026-07-phase1-correctness.md)).

## Notable process facts

- `git push origin main` was **denied by the permission classifier** ("go" didn't specifically authorize pushing to the protected default branch) — pushes are Tam's to authorize; never worked around. Tam later pushed a81ec04..96982ac themselves.
- Tooling lesson recorded in [incidents & lessons](2026-07-incidents-lessons.md): the repo's working Python formatter is `uvx ruff format` (99 cols, quotes preserved), *not* black — black defaulted to 88 cols and mangled `# pyright: ignore` comments.
