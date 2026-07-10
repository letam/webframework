# Link previews: refresh machinery + author toggle — implementation spec

Status: implemented 2026-07-09 (fable-5 spec → codex gpt-5.5 → fable-5 judge + live-verify).
One judge-round deviation from the implementation: `fetch_preview_for` now returns True when
fresh data was applied, so the command's "(N updated)" counter excludes kept-on-failure
refreshes instead of counting every completed fetch. Live verification passed all probes
(toggle end-to-end through the Settings UI, PATCH flag flip with image-file cleanup,
edit-triggered retry, command against the real network incl. threshold defaults).

Follow-up to docs/plans/2026-07-09-link-previews.md (read it first for context).
Two features: (A) an author-side toggle to disable preview generation, (B) retry/refresh
machinery for failed and stale previews.

## A. Author-side toggle

Settings in this app are client-side (`app/src/lib/utils/settings.ts`, localStorage, see the
`autoTranscribe` pattern). The server still has to know at post time, so the flag is stored
**per post**:

### Backend

1. `Post.link_previews_enabled = models.BooleanField(default=True)` (models.py, after
   `is_draft`-adjacent fields; one migration together with B's field — run `makemigrations`,
   expect `0024_*`).
2. Serializers: add `'link_previews_enabled'` to `PostCreateSerializer.Meta.fields` AND
   `PostSerializer.Meta.fields` (writable in both — authors may PATCH it per post later).
   FormData sends `'false'` as a string; DRF's BooleanField parses it, nothing extra needed.
3. `sync_link_previews(post)` (link_previews.py) gains a first guard:

   ```python
   if not post.link_previews_enabled:
       for preview in post.link_previews.all():
           preview.delete()  # per-object delete() — cleans up image files
       return False
   ```

4. `views.py update()`: capture `old_link_previews_enabled = instance.link_previews_enabled`
   next to `old_head`/`old_body`, and widen the sync trigger to
   `... or instance.link_previews_enabled != old_link_previews_enabled`. So PATCHing the flag
   to false strips existing cards; PATCHing it back to true re-extracts and fetches.

### Frontend

5. `settings.ts`: `AppSettings.linkPreviews: boolean`, default `true` in `defaultSettings`.
6. `SettingsPage.tsx`: a toggle mirroring the auto-transcribe row exactly (same Switch +
   layout). Copy (verbatim): label **"Link previews"**, description **"Generate preview cards
   for links in your new posts"**. Reads/writes `linkPreviews` via getSettings/updateSettings.
7. Create path: `usePostHandlers` (which already reads settings for autoTranscribe) passes the
   value into the create call; `lib/api/posts.ts createPost` appends
   `formData.append('link_previews_enabled', 'false')` **only when the value is false**
   (mirrors the `is_draft` conditional-append pattern). Edits do NOT resend the flag — an
   existing post keeps its creation-time choice regardless of the current localStorage
   setting; that's deliberate (no surprise card-stripping when editing old posts after
   flipping the setting).
8. `types/post.ts`: `Post.link_previews_enabled: boolean`; `revivePost` in posts.ts defaults
   it: `post.link_previews_enabled ?? true`. Add `link_previews_enabled: true` to `makePost`
   defaults in mockPosts.ts.

## B. Retry + refresh machinery

### Model

9. `LinkPreview.fetch_attempts = models.PositiveSmallIntegerField(default=0)` (same 0024
   migration).

### fetch_preview_for changes (link_previews.py)

10. Signature: `fetch_preview_for(preview, *, keep_existing_on_failure=False)`. Every call
    increments `preview.fetch_attempts += 1` (persisted in whichever save runs).
11. Failure path (`data is None`): if `keep_existing_on_failure` and `preview.status == 'ok'`,
    only bump `fetched_at` + `fetch_attempts` (update_fields) and return — the stale-but-good
    card survives a dead source (deleted tweet keeps its text; that's intended). Otherwise
    current behavior: mark `failed` (now also persisting `fetch_attempts`).
12. Image replacement must not orphan files: remember `old_name = preview.image.name` before
    `download_preview_image`; after the success-path save, if a new image was stored under a
    different name, delete `old_name` from storage (guard with try/except like
    `LinkPreview.delete()`). If no new image was downloaded, the old image stays untouched.
    (Today a refetch leaves the previous JPEG orphaned on disk — this fixes that.)

### Edit-triggered retry

13. `sync_link_previews`: for kept previews (URL still present) with `status == 'failed'`,
    reset `status = 'pending'` (save with update_fields). The existing return value
    (`pending exists`) then triggers the enqueue in views.py — so editing a post retries its
    failed previews for free. No attempt-cap here: edits are explicit user action.

### Management command

14. New file `server/apps/blogs/management/commands/refresh_link_previews.py` (create the
    `management/` and `management/commands/` packages with empty `__init__.py`s). Google-style
    docstrings everywhere (ruff enforces D102/D105/D107).
15. Options (argparse via `add_arguments`):
    - `--stale-days` int, default 30 — refresh `ok` previews with `fetched_at` older than this.
    - `--min-retry-age-minutes` int, default 60 — don't retry a `failed` row more often than this.
    - `--max-attempts` int, default 4 — stop auto-retrying `failed` rows at this attempt count.
    - `--limit` int, default 200 — cap on rows processed per category per run.
16. Behavior (both categories every run; filter `post__link_previews_enabled=True` in both,
    defensively):
    - Retry: `status='failed', fetch_attempts__lt=max_attempts, fetched_at__lt=now-min_age`,
      ordered by `fetched_at`, `[:limit]` → `fetch_preview_for(p)`.
    - Refresh: `status='ok', fetched_at__lt=now-stale_days`, ordered by `fetched_at`,
      `[:limit]` → `fetch_preview_for(p, keep_existing_on_failure=True)`.
    - Wrap each row in try/except; an unexpected exception marks the row failed (mirror
      tasks.py) and continues.
    - `self.stdout.write` a one-line summary: retried N (M now ok), refreshed K (J updated).
17. justfile: add to `admin/justfiles/django.just` a recipe
    `refresh-link-previews *ARGS:` → `uv run python server/manage.py refresh_link_previews {{ARGS}}`
    (match the file's existing recipe style).

## Non-goals

- No scheduler/cron wiring (Fly scheduled machines are a separate ops task — note the command
  in docs/feature-backlog.md's ops section as ready-to-schedule).
- No reader-side "hide cards" toggle. (Shipped later the same day as a follow-up: client-only
  `showLinkPreviews` setting gating the card render in Post.tsx; the author-side row was
  relabeled "Create link previews" to disambiguate from the new "Show link previews" row.)
- No per-post UI control in the post menu (the API now supports PATCHing
  `link_previews_enabled`; UI can come later).

## Tests (all mocked fetchers — no network; follow existing patterns in
test_link_previews.py, e.g. override_settings MEDIA_ROOT tempdir for file assertions)

Backend:
- Create with `link_previews_enabled=false` + URL in body → 201, no LinkPreview rows,
  response field false. Create default → field true.
- PATCH `link_previews_enabled` false on a post with an `ok` preview (with a stored image
  file) → rows gone, image file gone, response `link_previews == []`. PATCH back to true →
  URL re-extracted, task enqueued.
- Edit (body change) keeping a failed preview's URL → row reset to pending and refetched via
  on_commit.
- `fetch_preview_for` increments `fetch_attempts` on success and failure.
- `keep_existing_on_failure=True` on an `ok` row + fetcher returning None → status stays ok,
  title/description/image untouched, `fetched_at` bumped, attempts incremented.
- Image replacement on refetch deletes the old file from storage; new file exists.
- Command: eligible failed row retried; `fetch_attempts >= max-attempts` row skipped; too-recent
  failed row skipped; stale ok row refreshed; fresh ok row untouched; summary line printed.

Frontend (vitest — invoke as `bun run test`, NOT bare `bun test`):
- settings default `linkPreviews: true`; SettingsPage renders the toggle and persists flips.
- createPost omits the field by default and appends `'false'` when disabled.
- revivePost defaults `link_previews_enabled` to true when absent.

## Gates (run all before finishing)

- `uvx ruff check server/` and `uvx ruff format --check server/` (ruff isn't on PATH bare;
  note pyproject sets fix=true, so bare `check` mutates — that's fine).
- `uv run python server/manage.py test apps`
- `cd app && bun run test && bunx tsc --noEmit && bun run check && bun run format:check`
