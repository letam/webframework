# Quality & security audit — remediation plan (2026-08-13)

A full-codebase audit run on 2026-08-13: four independent reviewers (backend quality,
security, frontend quality, tests/CI/tooling), each told to **verify every claim against
the actual code** and to skip the items already tracked in `docs/feature-backlog.md`. The
headline findings were then re-verified by hand against the current tree before landing here.

This file is the **defect/debt** companion to `docs/feature-backlog.md` (which is
feature-focused). Same not-deleted discipline: items are annotated as they land (✅ / ⚠️),
never removed, so the original finding stays traceable.

## How the findings cluster

The reviewers converged on one theme, stated four ways: **the code reliably answers "is this
person allowed to see this?" and does not reliably answer "what happens on the failure path,
the teardown path, or the 100,000th request?"** Every P0 is a control that is correct inside
Django/React and bypassed, stranded, or unrecoverable just outside it — the visibility gate
that the Fly proxy serves media *around*; the `on_commit` discipline undone by a storage
delete inside the transaction; the composer autosave that exists to protect a recording and
deletes it on the one path where it's needed.

Two findings were independently reported by two reviewers each (the cookieless-session /
view-beacon resource leak, and the `SECRET_KEY` handling), which is why they rank where they do.

## Severity key

- **P0** — live exposure or user-visible data loss. Do first.
- **P1** — real defect or debt worth fixing soon.
- **P2** — worthwhile cleanup / hardening.

Effort: **S** < 1h · **M** ~half-day · **L** multi-day.

Items needing a **user action** (a key rotation or a deploy) are tagged 🔑 — the code change
lands on this branch; the operational step is the user's.

---

## Tier 0 — Security & privacy

### P0-a · Media is served around the visibility gate 🔑 · M ✅
`admin/configs/fly-sqlite.toml:52-54` (and `fly-preview.toml:56-58`) map `guest_path =
'/data/uploads'` to `url_prefix = '/media/'`. Prod runs `USE_LOCAL_FILE_STORAGE=True` with
media on that volume, so **Fly's proxy serves every media byte directly — Django, and
therefore `Post.is_visible_to()`, is never invoked.** Private/unlisted/draft media is
fetchable by URL by anyone; link-preview images are at the fully-enumerable
`/media/link_previews/<pk>.jpg`, defeating the purpose-built gated `link_preview_image` view.
The app already knows media should be gated — `stream_post_media` and `link_preview_image`
exist for exactly this — the proxy just serves the same bytes past them.
- Fix: delete the `/media/` `[[statics]]` block from both configs so `/media/` falls through
  to Django; serve **all** media only via the gated views. This also touches
  `MediaSerializer` (stop shipping raw `file`/`mp3_file` URLs; the SPA only needs them for
  mime/extension derivation — give it a `mime_type`/extension field instead) and `thumbnail`
  serving (`get_thumbnail` returns a raw `storage.url()` — thumbnails need a gated endpoint
  too, or they 404 once `/media/` stops being served).
- Verify at runtime before/after (private post's media URL must 404 without gate). Land on
  the branch only; **deploy is a user step** and must be paired with the config change.

### P0-b · Cookieless requests mint unbounded session + view rows (DoS + view inflation) · M
Found by two reviewers. `_viewer_key_for_request` (`server/apps/blogs/views.py:133-143`)
calls `request.session.save()` for any cookieless request, so the "dedupe" key
(`sha256(SECRET_KEY:session_key)`) is fresh every time. `post_detail` (`:1002`) records a view
on every HTML GET with **no throttle**, and the `views` beacon (`:634-658`) accepts 50 ids per
call. Nothing purges sessions (`clearsessions` appears nowhere). Measured: 5 cookieless
`GET /p/<id>/` → 5 session rows + 5 PostView rows. On a 512 MB VM with SQLite on the volume
this is a fill-the-disk primitive, and it's partly happening already via OG crawlers (which
never send the cookie back), so shared-link view counts track crawler fan-out.
- Fix: for unauthenticated requests, derive the viewer key from an **existing** `session_key`
  only; if none, either skip recording or key on a hash of `(client-ip, user-agent, day)` —
  never mint a session just to count a view. Add a throttle to `post_detail` (the
  `apps.ratelimit` decorator fits). Add `clearsessions` to `start-prod.sh` before gunicorn,
  and/or set `SESSION_COOKIE_AGE` down from two weeks.

### P0-c · Anonymous throttles are bypassable via `X-Forwarded-For` (`NUM_PROXIES` unset) · S
`REST_FRAMEWORK` (`server/config/settings.py`) sets no `NUM_PROXIES`, so DRF's `get_ident`
buckets on the **entire client-supplied XFF string**. Fly appends the real IP rather than
replacing the chain, so the attacker controls the prefix → a different bucket per request →
the `anon` 300/h and `views` 120/min limits never trip. This is the ceiling-remover for P0-b.
The sibling `apps/ratelimit.get_client_ip` (`:53-61`) has the same shape: it trusts
`X-Forwarded-For`'s first entry when `Fly-Client-IP` is absent, which partitions the
login/signup/presign limiters (including login brute-force protection).
- Fix: set `'NUM_PROXIES': 1` in `REST_FRAMEWORK`; in `get_client_ip` trust `Fly-Client-IP`
  then fall back to `REMOTE_ADDR`, dropping the XFF branch (or gate it behind an explicit
  `TRUSTED_PROXY` setting). `transcribe` is unaffected — it's `UserRateThrottle`, keyed on the
  authenticated user.

### P1-a · Presign endpoint requires no auth and sets no size condition 🔑 · M · ✅ (size condition) · ⚠ FLAG (auth policy)
`server/apps/uploads/views.py:33-70` is `@require_POST` + `@rate_limit(...)` with no auth
check; anonymous callers get a key under `post/audio/<anon-id>/`. `generate_presigned_put_url`
passes only Bucket/Key/ContentType — no `ContentLength` — so `MAX_MEDIA_UPLOAD_BYTES` is only
checked *after* the bytes are in R2 (via `head_object` at post-create), and never at all if no
post is created. Ceiling is 30 keys/hour/IP, and the IP is spoofable (P0-c).
- Fix: require `request.user.is_authenticated` (or, to keep anonymous posting, a short-lived
  server-issued composer token). Add a size condition to the presign so R2 rejects oversized
  bodies at the edge. Decide the anonymous-posting policy first — this may be a product call.

### P1-b · Link-preview SSRF guard is validate-then-connect (DNS-rebinding) · M ✅
`server/apps/blogs/link_previews.py:215-310` resolves + validates the host, then lets `httpx`
resolve it **again** at connect time. A 0-TTL name that alternates public IP ↔
`169.254.169.254`/`127.0.0.1` passes the check and connects internal. Reachable
unauthenticated (anonymous post body → `fetch_link_previews`), and the fetched title/desc
render on the post, so it's not blind. P1 not P0 only because Fly has no metadata service —
the reachable targets are the app's own `localhost:8000` and the 6PN network.
- Fix: resolve once, then connect to the validated IP literal with an explicit `Host` header
  (custom `httpx` transport/resolver); re-pin on each redirect hop.

### P1-c · `SECRET_KEY` handling: baked into the image, and a real value in the samples 🔑 · S ✅
Two reviewers, two related defects. (1) `check_and_create_env_file()`
(`server/config/settings.py:72-115`) writes `/code/.env` with a fresh `get_random_secret_key()`
during the Docker `build-backend` stage, and `Dockerfile:112` carries it into the image — so
prod may run on an **image-baked key that rotates every rebuild** (logging out every session on
deploy) and sits in a registry-readable layer; `docs/deploy-fly.md`'s claim that the app
"cannot boot without a SECRET_KEY" is false. (2) A working literal
`SECRET_KEY=i!c#...qt68` is committed in all three `server/.env*` samples, and
`build-prod.sh` `cp`s the production sample into place.
- Fix: skip `check_and_create_env_file()` when `SECRET_KEY` is already in the env (and/or gate
  on DEBUG); clean up `.env` in the final Docker stage; replace the sample literals with a
  placeholder + generation hint; make `build-prod.sh` refuse an empty/sample key. **User
  action:** confirm a `SECRET_KEY` Fly secret is set (`fly secrets list`) and rotate it.

### P2 cluster · security hardening · S each
- Anonymous account has an empty-but-"usable" password (`init_users`); call
  `set_unusable_password()` + data migration.
- Streaming-redirect presigned URLs live 3600s (`s3.py`), outliving token rotation / a flip to
  private. Lower the **redirect** TTL to ~60s (safe — browser follows immediately). ⚠️ Be
  cautious lowering `signed_url` (used directly as a media `src`): Safari range requests re-hit
  the URL during playback, so a too-short TTL breaks long media. Investigate before changing.
- `AWS_DEFAULT_ACL = 'public-read'` (`settings.py:579`) — inert on R2 today but a declared
  intent to make objects world-readable next to a privacy model that depends on the opposite.
  Remove it / set `private`.

---

## Tier 1 — User-facing data-loss & correctness bugs

### P0-d · A failed post silently wipes the composer + saved draft, then toasts success · S
`Feed.handlePostCreated` (`app/src/components/Feed.tsx:62-68`) catches the create error and
returns normally, so `CreatePost.submitPost` (`create/CreatePost.tsx:327-334`) treats a
rejected upload as success: clears text, clears media, `clearStoredDraft()`, "Post created
successfully!". The one thing autosave exists to protect — an unposted recording — is deleted
on the exact path where it's needed (offline, 413, 500).
- Fix: drop the try/catch in `handlePostCreated` (rethrow); `submitPost` already toasts on
  catch. Check `Profile.tsx` for the same wrapper shape.

### P0-e · Closing the record dialog leaves camera/mic live and discards the take · S
Both recorders render inside a Radix `Dialog` that unmounts on close; neither stops its
`MediaStream` on unmount. `VideoRecorder` has no unmount effect and its `reset()` is only
reachable via a `useImperativeHandle` that `VideoRecorderModal` never wires a ref to (dead
code). `AudioRecorder`'s unmount effect calls `reset()`, which nulls the recorder without
`.stop()` and never stops tracks. Camera/mic stay acquired until GC; an in-progress take is
dropped without firing `onstop`.
- Fix: add an unmount effect to both that stops the recorder if active and always
  `track.stop()`s every stream track; ideally flush a completed take or warn on
  close-while-recording.

### P1-d · Denied/absent mic → infinite `getUserMedia` retry loop · S
`AudioRecorder`'s auto-start effect fires on `status === 'idle'` and the failure path sets
`status` back to `'idle'`, so a rejected `getUserMedia` immediately retries forever (prompt/
toast spam, likely "Maximum update depth"). (Distinct from the backlog's error-*message*
differentiation row — this is the loop.) `VideoRecorder` is unaffected.
- Fix: a terminal `'denied'`/`'error'` status or a `hasAutoStartedRef` so auto-start runs at
  most once per mount. Fold in the backlog's per-error-kind messaging while here.

### P1-e · Edit modal loses edits — on save failure, and on background refetch · S
Same swallow-and-resolve as P0-d: `usePostHandlers.handleEditPost` (`:63-87`) catches, toasts,
resolves → `EditPostModal.handleSubmit`'s `await onSave` succeeds → `onOpenChange(false)`
closes the dialog and drops the edit. Separately, `EditPostModal`'s `useEffect(..., [post])`
(`:43-49`) re-seeds from the prop, and `post` is a fresh object after any refetch
(`refetchOnWindowFocus` on, `staleTime: 60s`) — so a like/view/transcription-poll while the
modal is open reverts in-progress typing.
- Fix: rethrow from the `usePostHandlers` catches (they already toast) — applies to
  visibility/publish/delete too; key the seed effect on `[post.id]` (or `key={post.id}` +
  drop the effect).

### P1-f · Composer autosave correctness — empty doesn't clear, and the `'anon'` key races · S/M ✅
`useComposerDraft.ts:95` returns early when `isEmpty`, so deleting all text/media never clears
the stored draft — the last non-empty draft is resurrected on next mount behind "Restored your
unsaved draft". And `draftKeyForUser(null)` is the shared `'anon'` slot; `useAuth` has no
loading state, so the key is `'anon'` before `/auth/status/` resolves and again after logout,
and the *write* side is unguarded — the docstring's "never hands one person's unposted words
to another" is violated on a shared device.
- Fix: clear the draft on the non-empty→empty transition; add `isAuthLoading` to `useAuth` and
  `enabled: !isAuthLoading`; on `userId → null`, clear rather than rewrite.

### P1-g · `MediaRecorder` evaluated at module scope crashes the whole app · S ✅
`app/src/lib/utils/media.ts:25-46` calls `MediaRecorder.isTypeSupported(...)` in two top-level
`const`s, and `Post.tsx` imports `parseDurationString` from the same module — so every feed
render pulls it in. On a browser/webview without `MediaRecorder`, module eval throws before
React mounts: a blank page the error boundary can't catch. Also ships two `console.log`s.
- Fix: make both lazy / guarded by `typeof MediaRecorder !== 'undefined'`; delete the logs.

### P1-h · `PullToRefresh` reloads the whole SPA from inside modals · M ✅
`app/src/components/PullToRefresh.tsx:41-108` binds touch handlers to `window`, guarded only by
`scrollY <= 0`. Radix dialogs lock body scroll at 0 and portal outside the subtree, so a
downward drag inside any dialog (record, image preview, tag popover) is read as a pull and past
100px calls `window.location.reload()` — blowing away the TanStack cache and SPA.
- Fix: scope listeners to the content element; bail when
  `target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')`; pass an `onRefresh`
  that invalidates the posts query instead of reloading.

### P1-i · Transcription/enqueue failures are unrecoverable · S–M
A post whose transcription worker dies is stranded at `transcript_status='pending'`
(`views.py:810-814`) — the transcribe action reads `pending` as "in flight" and no-ops, so the
UI spins forever and nothing can move it. The deploy runbook says the worker only runs while
the machine is awake, so this is expected, not hypothetical. Symmetrically, `_enqueue_*`
helpers swallow every exception (correct for the request) but there's no compensating sweep:
`refresh_link_previews` filters `failed`/`ok` and never `pending`, and `process_post_media`
writes no status, so a dropped enqueue leaves media without poster/waveform forever.
- Fix: treat `pending` older than ~15 min (via `media.modified`) as retryable in the
  transcribe action; add `status='pending'` (with an age filter) to `refresh_link_previews`;
  consider a `reprocess_media` command for rows missing `duration`/`thumbnail`.

### P1-j · Filtered feed yanks the viewport to the top on every loaded page · S ✅
`FilterControls.tsx:47-61` smooth-scrolls to the filter label whenever `filteredPostCount`
changes while a filter exists; infinite scroll changes that count continuously, so scrolling
filtered results repeatedly throws you back to the top.
- Fix: depend the effect on the filter *set* (`filters`/`matchMode`), not the result count.

---

## Tier 2 — Resource & performance

### P1-k · `stream_post_media` buffers the whole requested range into memory · S ✅
`views.py:915-918` does `file.read(end - start)` into one `bytes` for the 206 path. Browsers
open media with `Range: bytes=0-`, which resolves to the whole file, so one playback start
allocates the full file (100 MB cap) in RAM — twice briefly, since `HttpResponse` retains it —
on a 512 MB / 2-worker VM. Two concurrent viewers of a 60 MB video can OOM the machine.
- Fix: `FileResponse` over a bounded wrapper, or cap the served slice (e.g.
  `end = min(end, start + 4 MiB)`) and return the shorter `Content-Range`; clients request the
  next range. Django 4.2+ `FileResponse` also handles `Range` natively.

### P1-l · `MediaPlayer` downloads the whole file and leaks object URLs · M ✅
`MediaPlayer.tsx` (audio ~326-354, video ~543-600) fetches the entire file into a Blob, pins
it in a ref for the component's life, and `createObjectURL`s on every play with **zero**
`revokeObjectURL` in the file. In an infinite feed every `Post` stays mounted, so played media
accumulates (full file in heap + one leaked URL per play), and it defeats the backend's range
support (nothing streams). Also a redundant 20 Hz `setInterval` duplicates the native
`onTimeUpdate` and reads a stale `duration`.
- Fix: track and revoke URLs; drop blob refs on unmount; prefer `src = mediaUrl` and let the
  element range-request (keep the blob path only for the Firefox-autoplay workaround). Delete
  the interval.

### P1-m · Autosave rewrites the whole media Blob to IndexedDB on every keystroke · S ✅
`useComposerDraft.ts:94-108` skips the debounce when media is attached — correct for media
changes — but `text` is in the dep array, so typing a caption on a 40 MB video queues one
full-file IndexedDB write per character.
- Fix: split into two effects — `[media]` writes immediately, `[text, visibility, mediaType]`
  debounces and reuses the already-stored blob.

---

## Tier 3 — Build / deploy / CI integrity

_Theme: every gate guards the dev path; the path to production is unguarded._

### P1-n · The production image installs deps CI never tested · M ✅
`Dockerfile:68-71` builds the frontend with `npm install --legacy-peer-deps` and no lockfile
(`app/package.json` is all caret ranges; `--legacy-peer-deps` also masks the TS6/TS7 peer
conflict) while CI gates on `bun.lock`. Backend `Dockerfile:44` runs `uv pip compile
pyproject.toml` and ignores the committed `uv.lock`, re-resolving floating deps
(`environs`, `httpx`, the stub package). The green frontend job describes a different artifact
than Fly runs.
- Fix: frontend → install bun, `COPY app/bun.lock`, `bun install --frozen-lockfile`; backend →
  `COPY uv.lock pyproject.toml` + `uv sync --frozen --no-dev` (or `uv export --frozen`).

### P1-o · `build-prod.sh` runs unguarded destructive steps · S ✅
No `set -euo pipefail`; the sequence `migrate → collectstatic → npm run build → rm -rf
"$STATIC_APP_DIR" → mv app/dist ...` will `rm -rf` the served directory even if the build
failed, then `mv` fails and the script exits 0 — leaving the site with no frontend. Three
`sed -i` lines target lovable/gpteng markers that no longer exist (dead).
- Fix: `set -euo pipefail`; build into a temp dir, swap only on success; delete the dead seds.

### P1-p · `test_csp_hashes` scrapes `settings.py` as text — the pattern this repo renounced · S ✅
`tests/test_csp_hashes.py:20-45` regex-matches hash literals in the settings **source file**
and ignores the captured `tag`, so a `<style>` hash allowlisted only under `script-src`
passes, and a hash left visible in a comment keeps the test green while prod CSP blocks the
asset. This is the exact `test_drf_compat` substring failure mode, and the sibling
`test_logging.py` already shows the AST-based fix.
- Fix: read the resolved `settings.CONTENT_SECURITY_POLICY['DIRECTIVES']` and key on `tag`
  (`script-src` vs `style-src`).

### P1-q · Load-bearing behavior with no test · S–M ✅ (backend auth) · ⚠ FLAG (e2e) · ↪ #P1-b (SSRF)
- ✅ No test POSTs valid credentials to `/auth/login/`, asserts logout clears the session, or hits
  `/auth/csrf/` at all — the backbone of every write path (`apps/auth/tests.py`). **Done** — see
  status log.
- ⚠ **FLAGGED for the user** — a product/infra decision, not a silent code change. The e2e suite is
  structurally unable to test authed/write flows: browser origin is the Vite dev server, API is
  another origin, and the fetch wrapper never sets `credentials`, so session/CSRF cookies are never
  stored or sent — CI even provisions `e2e_admin` creds no spec uses. The two fixes have different
  security postures: running e2e against the Django origin (same-origin) changes nothing in prod;
  adding `credentials: 'include'` + `CORS_ALLOW_CREDENTIALS` loosens CORS for real and needs a
  deliberate call on allowed origins. Left for the user to choose.
- ↪ **Moved to P1-b.** The SSRF guard's redirect-revalidation and size cap are untested, and the
  fake httpx client can't express the bug (it ignores `follow_redirects`). These tests are written
  alongside the P1-b guard fix so they exercise the fixed code, not the current broken shape: a
  302-to-link-local test, a `MAX_REDIRECTS` test, and an oversized-body test.

### P2 cluster · tooling & CI coherence · S each
- `black`/`isort` are documented as a ruff alternative but are misconfigured (line-length 88 vs
  99, isort would rewrite a migration ruff excludes) and would turn CI red. Pick one — recommend
  deleting `[tool.black]`/`[tool.isort]` + the CLAUDE.md lines (ruff's `I` covers imports).
- Pyright is documented as the type checker, configured twice with conflicting scope
  (`pyrightconfig.json` wins entirely and has no excludes), and runs nowhere. Resolve the
  config collision; decide gated-or-editor-only and make the docs match.
- `djangorestframework-stubs[compatible-mypy]` sits in `[project.dependencies]` → mypy + stubs
  ship in the prod image. Move to the dev group.
- `bun run test:coverage` fails — `@vitest/coverage-v8` isn't installed. Add it or drop the
  script/doc line.
- `"test": "vitest"` is watch mode but CLAUDE.md says "run once"; set `"test": "vitest run"` and
  have CI call `bun run test`.
- Playwright traces/reports are produced and discarded — add `upload-artifact` on failure and a
  `~/.cache/ms-playwright` cache.
- `.github/workflows/fly-deploy.yml` deploys the root `fly.toml` (no `--config`) — the config
  CLAUDE.md says never to deploy. Point it at `admin/configs/fly-sqlite.toml` or delete it.
- `just` covers only the backend; add `typecheck`/`lint`/`check`/`test-app` and a `verify`
  recipe chaining exactly what CI runs.
- `sys/mkdir-error-log` prints its fatal error to stdout (`2>&1 echo` mis-ordered) and targets
  a path Django doesn't log to — fix or delete.
- `server/.env.example` omits `TASKS_IMMEDIATE`, the Sentry vars, `DB_CONN_MAX_AGE`, and the
  cache-size vars — add them commented with defaults.

---

## Tier 4 — Cleanup & debt

### P2 backend · S each
- `sync_link_previews` (`link_previews.py:809-822`, called from the viewset's atomic blocks)
  deletes the image from storage inside the caller's transaction — a rollback resurrects the row
  pointing at a deleted file. Collect names, delete via `transaction.on_commit()` (the pattern
  the same file already uses for enqueues).
- `Media.pk` is force-set to `Post.pk` in `create()`, leaving a dead two-phase-insert branch in
  `Media.save()` and a latent `IntegrityError` if a `SET_NULL`-orphaned media row's id is
  reused. Delete the dead branch + document the coupling, or decouple (migration).
- `_flatten_to_rgb` exists in three copies (`utils/media_processing.py`, `users/views.py`,
  `link_previews.py`) and has already drifted. Promote one to `apps/blogs/utils/images.py`.
- Dead code / inert config: `settings_production.py` (self-declared "NOT USED", generates a key
  at import), the double `LOGGING` assignment (`settings.py:61` shadowed by `:346`),
  `PostSerializer` subclassing `HyperlinkedModelSerializer` for nothing, `PostCreateSerializer`
  declaring a `media` field it always pops, `apps/auth/` not in `INSTALLED_APPS` (its
  `models`/`migrations` are inert — a migration there would silently never run),
  `apps/uploads/` missing `__init__.py`.
- No index backs the feed's `('-created', '-id')` ordering — add
  `models.Index(fields=['-created', '-id'])` (one migration; cheap now, cheaper than later).

### P2 frontend · S each (unless noted)
- Delete dead composer code: `AudioPostTab`/`VideoPostTab`/`TextPostTab` (~190 lines, imported
  by nothing) and the recorder ref API (`useImperativeHandle`, `forwardRef`, unused props) that
  only they used — the dead API is what made P0-e's cleanup bug look wired-up.
- `FormatText` (`Post.tsx:50-85`) sanitizes then rewrites the sanitized HTML with regexes, and
  calls `DOMPurify.sanitize` with no allow-list. Linkify/hashtag on raw text, then sanitize once
  with explicit `ALLOWED_TAGS`/`ALLOWED_ATTR`. (M)
- `useAuth` fetches `/auth/status/` twice per signed-in load (callback identity churn) and has
  no `else` on `if (response.ok)` — errors read as logged-out silently. Stable callback + an
  `isLoading` flag (also needed by P1-f).
- `VideoRecorder.onstop` awaits a dynamic import + `fixWebmDuration` with no try/catch → an
  unhandled rejection silently loses the take. Wrap + fall back to the unfixed blob.
- File inputs never reset `e.target.value`, so re-picking the same file after clearing does
  nothing (the fix already exists at `Profile.tsx:278`).
- Filter / tag index / "Publish all drafts" silently operate on the loaded page-prefix while
  presenting as complete. At minimum label the scope honestly; durable fix is server-side
  `search`/`tag` params (L).
- `TagFilterPopover` re-seeds pending selections on every parent render (dep identity churn),
  discarding in-progress ticks. Seed only on the open transition.
- Strict-mode-off nullability: `getMimeTypeFromPath(post.media.file || s3_file_key)` can pass
  `undefined` into a `string` param (throws in render); the resulting `mimeType &&` guards are
  vacuous; `getFileExtension` throws from a click handler with no catch; `normalizeAudio` ships
  `// DEBUG` logs. Type `Media.file` as `string | null`, safe helper signatures, drop the
  guards, wrap the download, delete logs.
- App-authored `<img>` omits `alt` when alt text is absent → screen readers announce the URL.
  `alt={mediaAltText ?? ''}`.
- No `fetch` sets `credentials`, so the SPA only works same-origin despite CORS advertising a
  split origin. Set `credentials: 'include'` (dovetails with the e2e fix in P1-q) or drop the
  misleading CORS origins.

---

## Execution order

Roughly top-to-bottom, but grouped so each commit is coherent and independently reviewable:

1. **Throttle identity** (P0-c) — smallest, and a prerequisite for P0-b being effective.
2. **Session/view resource leak** (P0-b).
3. **Frontend data-loss trio** (P0-d, P0-e, P1-d) — highest user-visible value, all small.
4. **Media-gate** (P0-a) — largest security item; needs runtime verification; deploy is a user
   step. Do after the small wins so the branch already has value if this one needs discussion.
5. **`SECRET_KEY` + env samples** (P1-c) — code lands here; rotation is a user step.
6. Remaining P1s, then P2 clusters, committing per logical group.

Items requiring a user decision before implementing are flagged inline (presign auth policy;
`signed_url` TTL; anything 🔑 that implies a deploy or key rotation). Everything else proceeds
on this branch.

## Status log

_(updated as items land)_

- **2026-08-13 · P0-c ✅** (`a131a5c`) — Added `apps/throttling.py` with a `FlyClientIpMixin`
  that keys DRF throttles on `apps.ratelimit.get_client_ip` (Fly-Client-IP → REMOTE_ADDR).
  Pointed the default anon/user throttles, `TranscribeRateThrottle`, and the post-views scoped
  throttle at the IP-keyed classes; set `NUM_PROXIES=1` as defense in depth. Dropped the
  spoofable `X-Forwarded-For` branch from `get_client_ip` (also fixes the plain-Django
  login/signup/presign limiters). All 228 backend tests pass.
- **2026-08-13 · P0-d + P1-e ✅** — `Feed.handlePostCreated` no longer swallows the create
  error; the rejection now reaches `CreatePost.submitPost`, which keeps the composer text and
  saved draft and toasts the failure instead of falsely clearing them. `usePostHandlers.
  handleEditPost` rethrows after toasting so `EditPostModal` keeps the dialog (and the
  in-progress edit) open on save failure. `EditPostModal` now seeds its form on the open
  transition (`[open]`) rather than on every `post` object identity change, so a background
  refetch (like/view/transcription poll) no longer reverts in-progress typing. Added a hook
  test for the edit rethrow. `handleChangeVisibility`/`handlePublishPost` were left toasting
  without a false success and retain no user-typed state; delete closes its confirm
  optimistically with no typed-content loss — so only the edit path needed the rethrow. 164
  frontend tests pass; typecheck + lint (8/8 warnings) green.
- **2026-08-13 · P0-b ✅** — `_viewer_key_for_request` no longer calls `request.session.save()`:
  authenticated → `u:<id>`, anon-with-cookie → session-hash, cookieless → a per-day
  `(client-ip, user-agent)` fingerprint hash. Cookieless crawlers therefore dedupe instead of
  minting a session + view row per hit. Added a `@rate_limit('post_detail', 120/60s)` guard to
  the HTML detail view (each GET records a view), and a `clearsessions` step on boot in
  `start-prod.sh` to drain the accumulated backlog. Rewrote the anon view-count test into two
  (cookieless-fingerprint + existing-session), asserting no `Session` row is created. 229 tests
  pass. The IP-keyed throttles from P0-c are what bound this now that the session mint is gone.
- **2026-08-13 · P0-e + P1-d ✅** — Both recorders now release the capture devices on unmount.
  `AudioRecorder.reset` (already run by its unmount effect) now detaches the recorder handlers,
  stops an active recorder, and `track.stop()`s every stream track — previously only the manual
  Stop button did, so closing the dialog mid-record left the mic hot. `VideoRecorder` had **no**
  unmount effect at all; added one, and gave its `reset` the same handler-detach + explicit-stop
  treatment (it already stopped tracks). For the retry loop, both auto-start effects now take a
  `hasAutoStartedRef` guard so a denied/absent device can't re-fire `getUserMedia`; `AudioRecorder`
  additionally lands in a terminal `'error'` status (not `'idle'`, which the effect would retry).
  Both recorders now map the `getUserMedia` rejection to a per-kind message (blocked / not-found /
  in-use) and render a "Try again" affordance instead of a dead, empty dialog. Typecheck clean,
  lint 8/8 (a new `eslint-disable` on the video cleanup effect's dep-array line keeps the budget),
  Biome clean, 164 frontend tests pass.
- **2026-08-13 · P0-a ✅** 🔑 — Media no longer serves around the visibility gate. New gated
  `serve_media_thumbnail` view (`/api/posts/<id>/media/thumbnail/`, mirrors `link_preview_image`:
  `is_visible_to` + token, `private, max-age=86400`, JPEG); `MediaSerializer.get_thumbnail` now
  returns that endpoint's absolute URL (token appended for unlisted) instead of a raw
  `storage.url()`. Dropped `file`/`mp3_file`/`s3_file_key` from the serializer output entirely —
  they resolved to `/media/` URLs the proxy served past the gate — and replaced them with derived
  `mime_type`/`extension` fields (module helpers `_media_mime_type`/`_media_extension` mirror the
  SPA's `getMimeTypeFromPath`). SPA rewired: `Post.tsx` reads `media.mime_type` for its render gate,
  `PostMenu.tsx` builds the download filename from `media.extension`, and the `Media` type drops the
  raw paths. **Refinement vs. the plan's "delete the `/media/` block":** deleting it outright would
  404 avatars (public, ungated, served from `/media/avatars/`) — so instead the `[[statics]]` block
  is *narrowed* to `guest_path='/data/uploads/avatars'` / `url_prefix='/media/avatars/'` in
  `fly-sqlite.toml`, `fly-preview.toml`, **and** the reference `fly.toml`. Everything else under
  `/media/` now falls through to Django. Runtime-verified with `DEBUG=False`: `/media/post/...` and
  `/media/link_previews/...` resolve to the SPA `index` shell (never file bytes), only
  `/api/posts/<id>/media/thumbnail/` reaches the gated view; the extended
  `test_media_stream_and_mime_type_are_gated` proves the thumbnail endpoint 404s without a token and
  streams the bytes with one. Full backend suite (229) green, typecheck/lint 8-8/Biome/164 frontend
  tests green, Ruff clean. **Deploy is a user step** and must ship the config change with the code.
- **2026-08-13 · P1-c ✅** 🔑 — `check_and_create_env_file()` no longer fabricates a production
  secret. Two guards: it returns early if `SECRET_KEY` is already in the environment (Fly secret,
  the Docker build's dummy key, or CI), and it only bootstraps an `.env` in the repo-root/dev
  layout (`server/` child dir present). Its prod-writing branch is gone, so a keyless prod boot now
  fails loudly at `SECRET_KEY = env('SECRET_KEY')` — runtime-verified with the local `server/.env`
  moved aside: `environs.EnvError: Environment variable "SECRET_KEY" not set`. This makes
  `docs/deploy-fly.md`'s "cannot boot without a SECRET_KEY" claim true (it was false before), so no
  doc edit was needed. Dockerfile production stage gained a defensive `rm -f /code/.env` (belt-and-
  suspenders: the build no longer writes one, and `.dockerignore` already excludes `server/.env`).
  Replaced the committed working literal `SECRET_KEY=i!c#…qt68` in all three `server/.env*` samples
  with `REPLACE_WITH_A_GENERATED_SECRET_KEY` + a `get_random_secret_key()` generation hint.
  `build-prod.sh` now generates a real key when it creates an `.env` from the sample (via
  delete-line + `printf`, not `sed`, so key-special chars stay literal) and refuses to build on an
  empty/placeholder/old-literal `SECRET_KEY`. 229 backend tests green, Ruff clean, `bash -n` clean.
  **User action:** confirm a `SECRET_KEY` Fly secret is set (`fly secrets list`) and rotate it —
  the previously image-baked key should be considered compromised. Rotation and deploy are user
  steps.
- **2026-08-13 · P1-g + P1-j ✅** (`f865097`) — `media.ts` no longer evaluates `MediaRecorder`
  at module scope: both `getSupported*MimeTypes()` return `[]` when `MediaRecorder` is undefined,
  so a webview without it can render the feed (which imports `parseDurationString` from the same
  module) instead of throwing before React mounts. Deleted the two stray `console.log`s. For P1-j,
  `FilterControls` now scrolls to the filter label on a change to the filter *set* — a
  `JSON.stringify({ matchMode, filters })` signature compared against a ref — rather than on
  `filteredPostCount`, so infinite-scroll page loads no longer yank a filtered view back to the
  top. Dropped the now-unused `filteredPostCount` prop from `FilterControls` and `Feed`. (Biome's
  `useExhaustiveDependencies` forbids trigger-only deps, so the signature is read inside the effect
  body, not just listed.) Typecheck/lint/Biome/164 tests green.
- **2026-08-13 · P1-f ✅** (`e3e5dcf`) — Closed all three cross-user autosave leaks. `useAuth` now
  exposes `isAuthLoading` (true until the first `/auth/status/` resolves, cleared in a `finally` so
  a failed check can't hang it), and the composer gates autosave on `!isAuthLoading` so a signed-in
  user's words are never written to the shared `'anon'` slot during the pre-resolve window where
  `userId` reads `null`. The save effect now (a) erases the stored draft on a real non-empty→empty
  transition so clearing the composer no longer resurrects the last draft, and (b) detects a
  logout (`userId` non-null → null) with content still present, clears the anon slot, and blocks
  further writes (via an `anonWriteBlocked` ref honoured by both the save and the on-hide flush
  effects) until the composer is emptied. Clear and write share the one save effect so they cannot
  race. Typecheck/lint (8/8)/Biome/164 tests green.
- **2026-08-13 · P1-h ✅** (`ac81b48`) — `PullToRefresh` no longer reloads the SPA from inside a
  modal. Bound the touch listeners to the content element instead of `window`, so touches inside a
  portaled Radix overlay never reach them; added a belt-and-suspenders guard that ignores a
  gesture whose touchstart target sits inside `[role="dialog"]`/`[data-radix-popper-content-wrapper]`.
  `Index` now passes an `onRefresh` that `invalidateQueries(['posts'])` — a soft refetch in place
  of the `window.location.reload()` fallback that discarded the TanStack cache. Also fixed a
  latent bug the soft path exposed: `finishGesture` reset the pull distance only on the
  below-threshold branch, so a custom `onRefresh` left the content pinned at the pull distance —
  it now springs back before firing. Typecheck/lint (8/8)/Biome/164 tests green. This closes the
  P1 frontend-correctness cluster (P1-f/g/h/j all ✅).

- **2026-08-13 · P1-k ✅** (`7af153b`) — `stream_post_media` no longer buffers a whole range into
  RAM. The 206 path now returns a `StreamingHttpResponse` over a new `_iter_file_range` generator
  that seeks once and yields 64 KiB blocks, so a `Range: bytes=0-` on a 100 MB file holds one block
  in memory instead of the full file (twice, with `HttpResponse` retaining its copy) — the OOM two
  concurrent viewers could trigger on the 512 MB VM. Same bytes, `Content-Range`, `Content-Length`,
  and `Accept-Ranges` as before; only the response type changed. The three range tests now join
  `response.streaming_content` rather than reading `.content`, and a new
  `test_range_response_streams_rather_than_buffering` asserts `response.streaming` is `True`.
  Preferred streaming over capping the served slice: it bounds memory to O(block) while preserving
  exact response semantics, so no client has to re-request a truncated range.

- **2026-08-13 · P1-l ✅** (`40235df`) — `MediaPlayer` no longer downloads the whole file or leaks
  object URLs. Root cause of the blob path was the Firefox-autoplay workaround: `await fetch()`
  before `play()` drops the transient user activation, so Firefox blocked playback and the code
  compensated by pre-fetching a Blob and playing an object URL — which pinned the full file in a
  ref for the component's life (every `Post` stays mounted in the infinite feed) and leaked one
  `createObjectURL` per play with no `revokeObjectURL` anywhere. Replaced both players with the
  streaming path: set `src = mediaUrl` and call `play()` synchronously inside the click handler,
  which preserves activation *and* streams via the backend's range support (now genuinely used).
  Removed the blob refs, the object-URL logic, the `isLoaded` state, the browser sniffing
  (`isDesktop`/`isFirefox`), and the redundant 20 Hz `setInterval` that duplicated `onTimeUpdate`
  off a stale `duration`. Try-Again handlers `removeAttribute('src')` + `load()`. Added a test that
  clicking play sets a non-`blob:` `src` containing the endpoint and never calls `fetch`.

- **2026-08-13 · P1-m ✅** — Autosave no longer rewrites the media Blob on every keystroke. The
  P1-f consolidation had left a single save effect that wrote the full record immediately whenever
  `media` was truthy — including on `text` changes — so typing a caption on a 40 MB video queued one
  full-file IndexedDB write per character. Kept the effect unified (splitting media- and text-writes
  into two effects, as the plan sketched, would reintroduce the clear/write race P1-f closed) and
  instead added a `previousMedia` ref to distinguish "media just changed" from "only text changed":
  a new/swapped recording still lands immediately, but a text/visibility/mediaType edit now
  debounces and, when a recording is already attached, calls a new `updateComposerDraftFields` that
  reads the record and writes it back reusing the persisted Blob — the in-memory take is never
  re-serialized. New helper degrades to a text-only put when no record exists yet and no-ops when
  storage is unavailable; three unit tests cover the reuse, the empty-store fallback, and the
  no-throw contract. Typecheck/lint (8/8)/Biome/167 tests green. This closes the P1 media
  resource/performance cluster (P1-k/l/m all ✅).

- **2026-08-13 · P1-p ✅** — `test_csp_hashes` no longer scrapes `settings.py` as a flat text blob.
  The old `setUp` regex-collected every `'sha256-…'` literal in the source into one set and checked
  membership ignoring the `tag`, so a `<style>` hash allowlisted only under `script-src` passed, and
  a hash left in a comment kept a since-changed block green while prod CSP blocked the asset — the
  same failure mode as the retired `test_drf_compat` substring check. Replaced it with an AST walk
  (`allowlisted_hashes_by_directive`) that buckets each hash under the directive key it actually sits
  below, and keyed the per-block assertion on the tag (`script`→`script-src`, `style`→`style-src`).
  Read from the source AST rather than `settings.CONTENT_SECURITY_POLICY['DIRECTIVES']` on purpose:
  the resolved dict is built once at import from the ambient `DEBUG`, so a dev running the suite with
  `DEBUG=True` (this machine) gets the debug branch — `'unsafe-inline'`, zero hashes — and a
  resolved-settings test would silently check nothing. The AST sees the production `else` branch
  whatever `DEBUG` is. Added a scan-guard test (script-src ≥1, style-src ≥3) mirroring
  `test_logging`. Verified: 3 script + 9 style hashes, disjoint; 7 tests pass under `DEBUG=True`.

- **2026-08-13 · P1-o ✅** — `build-prod.sh` no longer runs its destructive steps unguarded. Added
  `set -euo pipefail`, so a failed `npm run build` (or any earlier step) aborts instead of falling
  through to `rm -rf "$STATIC_APP_DIR"` and leaving the site with no frontend while exiting 0. The
  frontend swap now stages the new build first and replaces the served directory with two renames on
  one filesystem, so the live directory is never removed before a good build exists to take its
  place. Guarded the two greps that legitimately may not match (`read` on a non-interactive stdin,
  the `SECRET_KEY` lookup) with `|| true` so `set -e`/`pipefail` surface the script's own error
  messages rather than aborting silently. Deleted the three dead `sed` lines that stripped
  lovable.dev / gpteng.co / "DO NOT REMOVE" markers no longer present in the built shell. `bash -n`
  clean (no Docker daemon available to run the script end to end).

- **2026-08-13 · P1-n ✅** — The production image now installs the dependency sets CI locked and
  tested, not a fresh resolution. Frontend build stage moved off `node:22-alpine` +
  `npm install --legacy-peer-deps` (no lockfile; the flag also masked the deliberate TS6/TS7 peer
  split) onto `oven/bun:1`, copying `app/bun.lock` and running `bun install --frozen-lockfile` +
  `bun run build` — the same bun/lockfile CI's `oven-sh/setup-bun` job uses. Backend stage replaced
  `uv pip compile pyproject.toml` (which re-resolved the floating ranges) with `COPY uv.lock` +
  `uv export --frozen --no-dev --no-emit-project -o requirements.txt` feeding the existing
  `pip install`, so the production system site-packages the final stage copies are exactly the locked
  versions; `--frozen` fails the build on lock drift. Dropped the now-unused `NODE_*` args; added
  `USER root` to the bun stage so WORKDIR/COPY/install are user-agnostic across bun tag variants.
  Verified the two frozen-install commands the image runs: `uv export --frozen …` produces 57 hashed
  pins with the lock in sync, and `bun install --frozen-lockfile --dry-run` resolves clean. The full
  image build could not be run — the Docker daemon is down on this host — so the image-level mechanics
  (base image, `USER root`, WORKDIR) are reasoned, not built; a CI/Fly build is the remaining proof.

- **2026-08-13 · P1-q partial ✅ (backend auth tests)** — Added the four missing auth-endpoint tests
  the plan named as the backbone of every write path (`apps/auth/tests.py`): `test_csrf_returns_a_token`
  (GET `/auth/csrf/` → 200 with a non-empty `token`), `test_login_success` (valid JSON creds → 200
  echoing the bare `user_id`, then `/auth/status/` shows `is_authenticated` with the right id/username),
  `test_login_wrong_password_leaves_session_anonymous` (400 and the session stays anonymous — the
  security-relevant negative), and `test_logout_clears_session` (POST logout flips `/auth/status/` back
  to anonymous). Before this, the login happy path had zero coverage — only the failed attempts the
  rate-limit tests drive — and logout/CSRF had none. 12 auth tests pass.
  - ⚠ **FLAGGED, left for the user** — the e2e authed-flow gap is a product/infra decision, not a
    silent change. The e2e browser runs on the Vite origin while the API is another origin and the
    fetch wrapper sets no `credentials`, so session/CSRF cookies are never sent (CI even provisions
    `e2e_admin` creds no spec uses). Same-origin e2e (run against the Django origin) changes nothing in
    prod; `credentials: 'include'` + `CORS_ALLOW_CREDENTIALS` genuinely loosens CORS and needs a
    deliberate allowed-origins call. Not deciding this autonomously.
  - ↪ **Moved to P1-b (task #11).** The SSRF redirect-revalidation / size-cap tests are written with
    the guard fix so they exercise fixed code, not the current broken shape (the fake httpx client
    can't even express `follow_redirects`). This closes the P1 build/CI-integrity cluster
    (P1-n/o/p ✅, P1-q backend ✅; e2e flagged, SSRF tests tracked under P1-b).

- **2026-08-13 · P1-b ✅** — The link-preview SSRF guard no longer validates a hostname and then lets
  httpx re-resolve it at connect time (DNS rebinding). `_url_is_safe` became `_resolve_pinned_target`,
  which resolves the name once, fails closed if *any* resolved address is non-public, and returns the
  concrete IP to connect to plus the original hostname. `_safe_get` now connects to that pinned IP
  literal (`httpx.URL(url).copy_with(host=ip)`) while carrying the hostname as the `Host` header and
  the `sni_hostname` request extension — so vhost routing and TLS certificate verification still use
  the real name (verified end-to-end against a live host: pinned-IP + SNI → 200, IP without the SNI
  override → cert failure, confirming verification binds to the hostname). Each redirect hop is
  re-resolved and re-pinned, and relative `Location`/`og:image` links resolve against the logical URL,
  not the IP. The httpx mechanics were checked against the pinned versions (httpx 0.28.1 / httpcore
  1.0.9): `_prepare` only auto-fills `Host` when absent so the explicit header wins, and
  `connection.py` uses `sni_hostname or origin.host` as the TLS `server_hostname`. Rewrote the test
  fake to record the connect URL + `Host` + `sni_hostname` and to drive redirect chains, and added the
  three tests the plan named (now against the fixed guard): a 302-to-link-local that must refuse the
  second hop without connecting to it, a `MAX_REDIRECTS` cap, and an oversized-body drop — plus the
  anti-rebinding assertion that the connection targets the resolved IP, not the name. 238 backend
  tests pass; ruff clean.

- **2026-08-13 · P1-a size condition ✅ · auth policy ⚠ FLAGGED** — The presign now signs the exact
  upload size so R2 rejects an oversized body at the edge, instead of `MAX_MEDIA_UPLOAD_BYTES` being
  checked only *after* the bytes land (via `head_object` at post-create) — and never at all when no
  post follows. `generate_presigned_put_url` gained an optional `content_length`; when present it is
  added to `Params['ContentLength']`, which boto3 signs into `X-Amz-SignedHeaders`, so R2 edge-enforces
  the exact byte count. `get_presigned_url` now requires `content_length` in the JSON body and validates
  it (a real `int`, not a bool; `0 < n <= MAX_MEDIA_UPLOAD_BYTES`) before signing, returning 400
  otherwise. The frontend sends `content_length: data.media.size`; the browser sets the matching
  `Content-Length` from the Blob body automatically, so the signed value and the actual PUT agree. Tests
  added to `PresignUploadTests`: non-integer/boolean size, zero/negative/over-ceiling size, a
  ceiling-exact size signed through to the signer, plus the missing-`content_length` 400 and
  `content_length` threaded into every 200-path payload. 241 backend tests pass; ruff clean; frontend
  typecheck clean.
  - ⚠ **FLAGGED, left for the user — the auth-policy half is a product decision.** The endpoint is still
    `@require_POST` + `@rate_limit` with no auth check: anonymous callers get a key under
    `post/audio/<anonymous-id>/`. Requiring `request.user.is_authenticated` would harden it but **break
    documented anonymous posting** (CLAUDE.md: anonymous user, `AnonymousPostAuthorTests`). Keeping
    anonymous posting means a short-lived server-issued composer token instead — a real feature, not a
    reversible tweak. Not deciding this autonomously. The size condition above is orthogonal and lands
    regardless of which way the auth call goes.
