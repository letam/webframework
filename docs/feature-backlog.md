# Feature Backlog

A prioritized roadmap of everything still wanted for wut.sh / webframework.dev,
consolidated on 2026-07-09 from ~280 scattered notes (Things exports and vault notes,
2022–2026). Items already shipped were dropped; what remains is ordered by how often it
was asked for, how well it fits the product, and rough effort.

Priority key: **P1** = asked for repeatedly, core to the product. **P2** = clear value,
asked for once or twice. **P3** = exploratory / someday.

---

**Build-out status (updated 2026-07-09).** The whole P1 block and most of P2 were built
out in a single push — six feature commits (`da97de9` → `fc919ab`), part of 18 unpushed
commits on `main` awaiting a push. Shipped work is marked **✅** inline with its commit;
sub-items that were deliberately deferred are called out under each section. Nothing is
removed here — shipped rows are *annotated, not deleted*, so the original request text
stays traceable. P3 and the UX / ops lists near the bottom are untouched.

Still shipped-but-not-yet-done at a glance: sharing with *selected users*, richer
reactions, shorts / iPhone re-encode / volume normalization, and self-hosted Whisper — all
called out below. (Auto-save draft composer was on this list until 2026-08-04.)

**Update 2026-08-04.** Four more rows shipped since and are annotated in place: rich text,
feed keyboard shortcuts, and two of the UX bugs. The ops half of this file grew a
**Tech debt & pins to unwind** section — production now runs a Django *release candidate*,
which is a dated pin rather than a permanent one — and the ops list is re-ordered so the
one thing blocking error visibility (`SENTRY_DSN`) sits at the top.

**Update 2026-08-12.** A triage pass re-checked the *open* rows against the code rather than
against this file's description of them, and found four sized wrong — corrections are
annotated inline below (⚠️), in the same not-deleted style as the shipped rows. The habit
worth keeping: a row describes the work as understood on the day it was written, and drifts
as the code moves under it. Re-read the code before sizing anything here. Django is also no
longer on a release candidate as of `23d45ef` — see Tech debt & pins.

---

## Next up (ranked 2026-08-12)

Above all three, and not a feature: **`SENTRY_DSN`** (Ops backlog). Until it is on, anything
these three break is invisible.

1. **Recording robustness pass** — the whole open recording row under "Open UX bugs & small
   fixes", built as one piece. It is the core input path of an audio/video product and the
   least-hardened thing in the app; see that row for what is actually missing.
2. **`file_size` + orphaned-media cleanup + the Fly cron, as a single pass** — these are one
   problem wearing three hats (knowing what is really in R2), and the storage-usage display
   falls out of it nearly free at the end. See the Ops backlog "Scheduled jobs" row and
   "Display storage usage".
3. **Feed perf — measure before building** — one React Profiler session either closes the
   "feed feels heavy" row or names a specific fix. Cheapest available resolution of a
   months-old unknown.

Deprioritized on evidence in this pass: offline / local-first (see the correction on that
section), self-hosted Whisper (pure cost saving; the OpenAI path works), richer reactions
(this file's own "only if it doesn't clutter" is the right call). Still correctly deferred:
shorts, iPhone re-encode, and volume normalization — all three need real device testing, so
there is nothing to gain by starting them at a desk.

---

## P1 — Post privacy  ✅ Shipped 2026-07-09 (da97de9)

The single most-repeated request (six-plus notes, May–Nov 2025). The fullest spec:

- Visibility levels per post: **private** (author only), **public** (everyone), and
  **link-visible** (anyone holding the post's share token).
- Share tokens can be **regenerated** to revoke access for everyone holding the old link.
- Later: share drafts/posts with selected users.

> **✅ Shipped 2026-07-09 (da97de9).** Visibility levels public / unlisted (= link-visible)
> / private, with a rotatable `share_token` (`POST /api/posts/<id>/share-token/`). The
> feed, `/p/<id>` detail, media streaming, OG, and stats all gate on `is_visible_to`;
> 404-never-403; the token is never serialized to non-authors. Composer gained a
> visibility picker; the `/p/<id>` share page streams media through the gated endpoint +
> token. **Still open:** sharing with *selected users* (the "Later" item).

Design notes: visibility belongs on the composer (small, not in the way — default
public) and on the post menu for existing posts. The feed, detail page (`/p/<id>`),
media streaming, and OG endpoints all need to respect it; media served from R2 via
presigned URLs already goes through the serializer, so gating is server-side only.

## P1 — Drafts  ✅ Shipped 2026-07-09 (da97de9)

Recurring alongside privacy ("button for draft mode", "auto-submit as draft; select
multiple to publish", "on iPhone automatically post as draft"). Minimum shape:

- A post can be saved as **draft** instead of published; drafts are visible only to the
  author (a special case of privacy above — build them together).
- Drafts list (Profile tab or filter) with publish / bulk-publish.
- Optional toggle: auto-save composer content as a draft (the iPhone note was about not
  losing a recording when the page refreshes).

> **✅ Shipped 2026-07-09 (da97de9).** `is_draft` + a publish action (author-only;
> publishing bumps `created` so cursor pagination is unchanged), a Draft button in the
> composer, and a Profile **Drafts** tab with publish-all. Built together with privacy as
> planned.
>
> **✅ Auto-save shipped 2026-08-04 (b785a68)** — the iPhone "don't lose a recording on
> refresh" note. The composer persists its text, visibility and attachment to IndexedDB
> (localStorage cannot hold a Blob) and restores them on the next mount behind a
> "Restored your unsaved draft" strip with Discard / Keep; a Settings toggle turns it off,
> default on. Keyed per user, so a shared device never hands over someone's unposted words.
> Media saves immediately and text debounces, because the tab may not survive another
> 600ms. Note this saves *locally* rather than creating a server-side draft row — the note
> was about not losing work, and real draft posts would fill the Drafts tab with fragments.

## P2 — Views and richer reactions  ✅ View counts shipped 2026-07-09 (56f0380)

"Reactions, views, comments" recur as a trio; likes and comments shipped in Phase 2.

- **View counts** per post (server-side, debounced per session; show on detail page
  and/or hover card).
- Possibly extend like → small set of reactions. Only if it doesn't clutter the action
  row; the notes never specified emoji sets.

> **✅ View counts shipped 2026-07-09 (56f0380).** `PostView`, unique per viewer (hashed
> anonymous session keys), fed by a throttled beacon (`POST /api/posts/views/`, 120/min)
> off an IntersectionObserver dwell timer with a batched keepalive flush; an Eye counter
> in the action row; also recorded + shown on the `/p/<id>` share page. **Still open
> (deliberately deferred):** richer reactions beyond like.

## P2 — Profile upgrades  ✅ Shipped 2026-07-09 (dd29a53)

From "webframework: mement.app: profile with pinned posts. weeklies. monthlies.":

- **Pinned posts** at the top of a profile.
- **Weeklies / monthlies**: automatic time-bucketed views of a user's posts.
- **Avatar upload** (identity-gradient fallbacks already exist).

> **✅ Shipped 2026-07-09 (dd29a53).** Pin ≤3 published posts (`POST/DELETE
> /api/posts/<id>/pin/`, `?pinned=true` scope); an All · Weeks · Months timeline grouping
> on the profile; and avatar upload (`User.avatar` + a 512² JPEG pipeline, rendered
> everywhere incl. Navbar, Profile, and author hover cards). Identity-gradient fallbacks
> stay for users without an avatar.

## P2 — Search & filter power tools  ✅ Shipped 2026-07-09 (bbe5dc6)

From the Nov 2025 notes (multi-term filtering already shipped):

- **Saved filters**, plus recently-used / frequently-used filter suggestions.
- Google-like search operators (e.g. `author:`, quoted phrases, `-exclusion`).
- An "advanced" toggle below the filter box for the above.
- **Export data** button (dovetails with the offline/local-first work below).

> **✅ Shipped 2026-07-09 (bbe5dc6).** Operator grammar in `src/utils/filterQuery.ts`
> (`"phrase"`, `author:`, `-exclusion`); saved + recently-used filter sets in localStorage
> behind a Bookmark popover; an operator hint shown on input focus; and a Settings
> "Export my posts" JSON download (the export-data button). Note the export ships here
> rather than waiting on the offline / local-first work below.

## P2 — Media polish  ✅ Mostly shipped 2026-07-09 (fc919ab)

- **Video thumbnails**: capture on upload (ffmpeg already in prod image), display in
  feed, allow replacing with a custom image. Duration capture already ships.
- **Audio waveform** player: SoundCloud-style wave as the seek bar; load audio bytes
  only on first play.
- **Photo optimization**: serve a compressed rendition by default; tap opens a modal
  with a "view original" button. (Also noted as "decrease quality of image before
  upload".)
- **Shorts**: optional 30/60-second cap for quick clips; re-encode oversized iPhone
  video to a smaller resolution before upload.
- **Normalize recording volume** across browsers (an earlier pass existed; Safari was
  the pain point).

> **✅ Mostly shipped 2026-07-09 (fc919ab).** A `process_post_media` background task (via
> `on_commit`) generates: video posters (ffmpeg → `Media.thumbnail`, `preload=none`) with
> a custom-poster PATCH on the edit modal; a ≤120-peak audio waveform (JSONField) driving
> a SoundCloud-style drag-seek bar with a brand-gradient played edge; and ≤1600px image
> renditions (small originals skipped) with a lightbox "View original". **Still open
> (deliberately deferred — they need device testing):** shorts / duration cap, iPhone
> re-encode-before-upload, and cross-browser volume normalization.

## P2 — Transcription upgrades  ✅ Auto-transcribe shipped 2026-07-09 (10fcf8d)

- **Auto-transcribe toggle**: per-user (or per-post) option to transcribe media as soon
  as a post is created, instead of pressing the button.
- **Self-hosted Whisper** (whisperX / faster-whisper) as an alternative backend to the
  OpenAI API.

> **✅ Auto-transcribe toggle shipped 2026-07-09 (10fcf8d).** Per-user Settings toggle;
> `usePostHandlers` kicks off transcription right after a media post is created
> (`getSettings` now merges defaults). **Still open (deliberately deferred):** the
> self-hosted Whisper backend.

## P3 — Offline / local-first

A long-running thread ("work offline", "post offline + sync", "save to client db by
default", import/export, even a fully client-side encrypted variant). Big lift; stage it:

1. Read-only offline: service worker + cached feed (re-enable the PWA plugin that was
   parked "until ready to release").
2. Offline composer: queue posts in IndexedDB, sync on reconnect.
3. Import/export of one's own data (ties into the export button above).

> **⚠️ Correction 2026-08-12 — stage 1 is not a re-enable.** There is no parked PWA plugin to
> turn back on: nothing in `app/vite.config.ts` or `app/package.json` references vite-plugin-pwa,
> Workbox, or a service worker. Whatever was parked is gone from the tree, so stage 1 is a
> from-scratch add and must be sized as one.
>
> **The priority also dropped.** Composer autosave (shipped 2026-08-04, `b785a68`) already
> answers the concrete pain this thread kept circling — not losing a recording to a refresh.
> Stages 1 and 3 remain the genuinely large and optional parts.
>
> **✅ Stage 2 shipped 2026-08-20** (branch `feature/offline-posts`, spec + deviation log
> in `docs/plans/2026-08-20-offline-posts.md`): IndexedDB outbox with auto-sync on
> reconnect, media support (100 MB cap), an always-visible sync-status indicator, an
> auto-sync toggle for local-first drafts, and a Settings default (auto / local /
> remember-last). Server-side idempotency via `Post.client_uuid`. Stages 1 and 3 remain.

## P3 — Federation / cross-posting

"Turn the app into a social media node": cross-post to other platforms (API, MCP, or
browser automation), share/export a post elsewhere, "let your fans back up your
content". Start with the simplest: per-post "cross-post" hook + webhooks; evaluate
ActivityPub only if the node idea gets serious.

## P3 — Everything else worth keeping

- **Link previews** ✅ Shipped 2026-07-09 — YouTube (title/channel/description, click-to-play
  embed), X/tweet quote cards, and generic OG cards, each with the source's publication date
  when available; server-side fetch with SSRF guarding and re-hosted thumbnails. Settings has
  both an author-side "Create link previews" toggle (per-post flag) and a reader-side "Show
  link previews" toggle (client-only render gate). Extended 2026-07-10 with dedicated
  Hacker News (Firebase API: points/comments/author/date, comment links via parent walk),
  Reddit (oEmbed: title/author/subreddit — the only unauthenticated door Reddit leaves open),
  and ChatGPT share cards (og:title + UUID-timestamp date), each with brand marks.
  Specs: docs/plans/2026-07-09-link-previews.md, docs/plans/2026-07-10-link-preview-sources.md.
  The server-rendered `/p/<id>` share page renders cards for all six kinds too (2026-07-10,
  docs/plans/2026-07-10-share-page-link-previews.md) — that work also fixed a pre-existing prod
  bug (stale CSP style hash left the share page unstyled in production) and added a CSP hash
  regression test.
- **Rich text** ✅ bold/italic shipped 2026-07-11 (0c0c247) — markdown-lite (`**bold**`,
  `*italic*`) in the composer and post body. **Still open:** a full rich-text editor, and
  only if genuinely needed.
- **Magic-link sign-in**; registration via a shared signup code that refreshes daily;
  password-strength check when creating a superuser.
- **Moderation** — content filtering ("censorship") pass; refresh community rules;
  ground-rules memo with countdown.
- **Keyboard shortcuts** ✅ feed shortcuts shipped 2026-07-12 (887a45a) — j/k navigation,
  l/o/n, `/` to search, `gg`, `?` for a help dialog, Esc, via a `useFeedKeyboard` hook.
  **Still open:** composer shortcuts.
- **Ephemeral mode** — optional auto-clearing of posts (hourly/daily/weekly, per user).
- **Post folders / Things-clone mode** — tags + folders + export; save lists (plus a
  browser extension to add items).
- **Display storage usage** to the user; show file size of media.

  > **⚠️ Correction 2026-08-12 — this is a migration, not a display task.** `Media`
  > (`server/apps/blogs/models.py`) carries duration, waveform, thumbnail, transcript and
  > alt text, but no size. `FileField.size` costs an R2 round-trip per file, so any total
  > across a user's media means a stored `file_size` column plus a backfill over existing
  > rows. Build it in the same pass as orphaned-media cleanup below — same question, same
  > walk over the same objects.
- **WebRTC live chat / P2P**; wake-word voice control; Apple Watch input. (Parked —
  revisit only if the core is done.)

## Open UX bugs & small fixes (from the notes, still unverified against current build)

- Pull-to-refresh with a mouse; PWA "open post" should stay in the same view.
- Feed feels heavy — profile with React Profiler.
- Can't scroll when the gesture starts on the post dropdown; darken behind tags popover.
  ✅ Shipped 2026-07-10 (11588d6).
- Mobile: full-width posts without card chrome; match x.com/LinkedIn content widths
  (~600px container; detailed measurements in the vault note `web-framework.md`).
  ✅ Shipped 2026-07-10 (c6f318a).
- Dark mode as the default theme.
  ✅ **Resolved 2026-08-12 — no work needed; closing the row.** `app/src/App.tsx` mounts
  `<ThemeProvider defaultTheme="system">`, so a user whose OS is dark already lands in dark.
  Hard-defaulting to dark would *override* the OS preference for light users, which is worse
  than what ships. Reopen only if the ask was specifically "dark even when the OS says light".
- Recording: graceful mic/camera permission denial; behavior on incoming call;
  "Post" during recording should stop the recording and submit; iPhone audio preview;
  Safari media quirks.

  > **⚠️ Sizing note 2026-08-12 — handled, but undifferentiated.** Denial does not crash: both
  > recorders catch it and toast. But each has exactly one message for every failure —
  > `AudioRecorder.tsx:389` ("Unable to access microphone. Please check permissions.") and
  > `VideoRecorder.tsx:213` — so a denied permission, no attached device, and a camera already
  > held by another app all read identically, and none of the three suggest a way out. The work
  > is branching on the `getUserMedia` error name (`NotAllowedError` / `NotFoundError` /
  > `NotReadableError`) with recovery copy per case, then the rest of this row. **This is item 1
  > in "Next up" — build the whole row at once.**

## Ops backlog

- **`SENTRY_DSN` is unset — the one remaining gap in error visibility.** As of 2026-08-03
  stderr carries every error correctly, but Fly's log retention is short and
  `/log/server-errors.log` lives on the *container* filesystem — wiped on every deploy. Until
  Sentry is on, "what broke last Tuesday" has no answer. See
  `docs/reports/2026-08-logging-and-deploy.md`; verify the wiring with `just fly-check-logging`.

  The two halves are **not** equally easy, and there is no runbook for either — `docs/deploy-fly.md`
  does not mention Sentry, and the variable names appear only in `server/.env.example`,
  `app/.env.development.local.sample`, and one CLAUDE.md line. Write the runbook while doing it.

  - **Backend: genuinely one secret, no code.** `fly secrets set SENTRY_DSN='...'`, read at
    `server/config/settings.py` (`sentry_sdk.init`, PII off, `traces_sample_rate` from
    `SENTRY_TRACES_SAMPLE_RATE`, default 0.0). `SENTRY_FRONTEND_INGEST_FOR_CSP` is also a
    *backend* runtime variable — it extends CSP `connect-src` — so it is a normal secret too.
  - **Frontend: needs a Dockerfile change first.** `VITE_SENTRY_DSN` is inlined by Vite at
    *build* time, and the `build-frontend` stage passes no `VITE_*` through — no `ARG`/`ENV`
    pair, and `.dockerignore` drops `app/.env`. Setting it as a Fly secret would silently do
    nothing: Fly secrets are runtime env, and the bundle is already built by then. It needs an
    `ARG VITE_SENTRY_DSN` + `ENV` in that stage and a `--build-arg` at deploy. A build arg is
    the right mechanism rather than a build secret, because a frontend DSN is public by design —
    it ships to every browser in the bundle either way.
  - **Same root cause, checked and benign:** `app/.env.production.sample` sets
    `VITE_UPLOAD_FILES_TO_S3=true`, but no `app/.env.production` exists and the build passes no
    `VITE_*`, so prod builds with that flag unset. Not a bug — `UPLOAD_FILES_TO_S3`
    (`app/src/lib/constants.ts`) only chooses *who* does the PUT: unset means the browser posts
    multipart to Django, which then writes to R2 through the storage backend. Media still lands
    in R2 either way, which is why this has never shown up as a failure. The tradeoff is that
    every upload streams through a 512 MB VM instead of going browser→R2 direct. Revisit if
    large-video uploads start timing out; turning it on means adding the `VITE_*` build plumbing
    described above, so it rides along with frontend Sentry.
- **Periodic DB backups** — Litestream for SQLite-on-Fly was the noted choice. Less urgent than
  this row used to read: checked 2026-08-04, Fly is already taking **automatic daily snapshots**
  of `myapp_data` (`fly volumes snapshots list vol_rnyo00280l69x504 -a webframework`), so there
  is a real net. What it does not cover: retention is **5 days**, so corruption noticed a week
  late is unrecoverable; the copies live at the same provider as the volume; and the restore
  path has never been exercised. Litestream buys continuous replication off-provider — worth it
  before the data matters more than it does today, not urgent while it doesn't.
- Serve compressed media by default; check staticfiles cache-control on Fly.
- Scheduled jobs on Fly (cron) — e.g. orphaned-media cleanup (a known gap: presigned
  PUTs rejected at post-create are never deleted from R2). Link preview refresh is ready to
  schedule with `uv run python server/manage.py refresh_link_previews`.

  > **Sizing note 2026-08-12.** The asymmetry in that sentence is real and easy to misread:
  > `refresh_link_previews` exists and only needs a schedule, but there is **no cleanup command
  > to schedule** — `server/apps/*/management/commands/` holds only `refresh_link_previews` and
  > `init_users`. So this row is two unequal halves: wire up Fly cron (small), and write the
  > cleanup command (not small — it has to diff R2 keys against `Media.s3_file_key` and delete
  > only what no row claims, which is exactly the walk `file_size` needs). Until it exists the
  > orphans accumulate silently and you pay for them; nothing surfaces the size of the pile.
  > **This is item 2 in "Next up", together with `file_size`.**
- External uptime monitoring (beyond `/healthz/`).
- **Postgres** — not a task, a standing option. SQLite-on-volume is fine at this scale, but it
  pins the app to the single machine that owns the volume, so it is what a second machine (or
  managed backups) would have to trade away first. `admin/configs/fly-postgres.toml` is ready.
- Email: `tam@wut.sh`, `tam@webframework.dev`.

## Tech debt & pins to unwind

Each of these is waiting on someone else to ship; the work is a few lines once it lands.
Recorded because the cost of forgetting is silent.

- **TS 6 / TS 7 alias split** in `app/package.json` — collapse back to a single `typescript`,
  simplify the `typecheck` script, and delete the CLAUDE.md section once typescript-eslint
  accepts TS 7. See CLAUDE.md, "Two TypeScript versions".

  Nothing automated watches for that upstream release, and the one alarm this repo did have
  failed silently. The deleted `test_drf_compat` scanned `rest_framework/**.py` for the bare
  string `cc_delim_re`, so it matched DRF 3.18's *comment* explaining the symbol's
  replacement and stayed green long after the shim was dead — the shim was found dead by
  reading release notes instead (23d45ef). **Write an expiry alarm to assert on a real
  import or call — parse with `ast`, the way `server/apps/blogs/tests/test_logging.py`
  does — never on a substring.** Its docstring had hardened against a false *alarm* while
  leaving the false *negative* open, which is the worse direction: a silent alarm means the
  dead code survives and nobody looks again.
- **`/log/server-errors.log` is ephemeral on Fly, and staying that way.** Making it persistent
  was considered and declined 2026-08-03: it would need conditional dev/prod path logic for a
  file that now duplicates stderr and still would not give durable history. Sentry is the
  answer to what that change was reaching for.
