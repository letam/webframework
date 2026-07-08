# Phase 1 — correctness (2026-07-06→07 night, commit `73a47dd`)

Triggered by "go phase 1". First full run of Tam's model pipeline: fable-5 wrote two decision-complete specs (`spec-backend.md`, `spec-frontend.md`, ~24KB total, pinning the entire API contract), two gpt-5.5 `codex exec` runs at xhigh implemented them **in parallel** (disjoint directories; ~188k tokens backend, ~166k frontend), fable-5 judged, and gpt-5.5 `codex review` gave an independent pass. 35 files, +1835/−620; tests 60 → 79 backend + 16 frontend. Part of [project overview](2026-07-project-overview.md).

## The headline discovery: the S3/R2 upload flow had never worked

The frontend PUTs media to R2 via presigned URL, then POSTs the post with `s3_file_key` — **but nothing on the backend ever read that field**. Every presigned-flow post was created with no media record and an orphaned R2 object. On top of that, every `.file.path` call site crashed under `S3Boto3Storage`. The prod media configuration was completely broken; it "looked done" because the local-disk path worked.

**The rebuild:** post creation now consumes `s3_file_key` with full validation *before* any DB row — ownership prefix (`post/<type>/<user_id>/`), key uniqueness, HEAD existence/content-type/100MB cap, then download+ffprobe byte validation for audio/video (which also closed Phase 0's deferred "presigned PUT bytes unvalidated" hole); post+media created in `transaction.atomic()`. A storage-safe `Media.local_copy()` contextmanager replaced every `.file.path` use across duration probing, deletion (now also deletes the R2 object), transcription (Whisper accepts most formats directly, so mp3 conversion became transient-only), and streaming (S3-backed media redirects to a signed GET URL).

## The rest of the phase

- **Cursor pagination**: DRF `CursorPagination`, page 20, ordering `('-created','-id')` (stable under concurrent inserts), `{next, previous, results}`, `?author=`/`?liked=` filters. Frontend moved to `useInfiniteQuery` + IntersectionObserver sentinel in Feed and Profile; cross-cache mutation updates via `setQueriesData` with a key predicate; Profile queries its own scoped feeds.
- **Presign N+1 killed**: signed GET URLs are a local HMAC computation, so `media.signed_url` is generated in the serializer; the per-post presign endpoint, the client waterfall, and the URL cache were all deleted.
- **Dead unit tests revived**: full rewrite against the real API — factories in mockPosts, 16 tests covering the S3 create flow, optimistic like rollback, cross-cache updates.
- **CI**: new `ci.yml` (backend Django tests with ffmpeg via uv; frontend tsc + vitest + build via bun) on push/PR; `fly-deploy.yml` now `needs: tests`. Lint deliberately not gated yet (118 pre-existing ruff findings).

## What the judge/review layers caught (the pipeline earning its keep)

- **fable-5 judge pass**: codex's newly-activated range path had an off-by-one — werkzeug range tuples are end-*exclusive* (verified empirically: `bytes=0-499` → `(0, 500)`) while HTTP Content-Range is end-inclusive. Also simplified a redundant Profile parameter shape.
- **codex review, finding 1 (severe)**: `manage.py test` from the repo root **silently discovers zero tests** — the brand-new CI gate and the `just test` recipe were both decorative until the `apps` label was added (verified: "Ran 0 tests in 0.000s").
- **codex review, finding 2**: unliking a post left it in `{liked: true}` caches (Profile Likes tab). Fixed: liked-scope caches drop the post on unlike and invalidate on like (correct cursor position is unknowable client-side); regression test added.

## Verification

79 backend + 16 frontend green, tsc/biome clean, both workflow YAMLs parse. Live smoke test on a throwaway :8001 server (the user's :8000 server had gone down — not touched): pagination envelope, `page_size=1` cursor walk, `signed_url`/`modified` fields, anonymous `?liked=true` → empty. Junk `server/server/` dir (from codex running with cwd=server/) inspected and removed before committing.
