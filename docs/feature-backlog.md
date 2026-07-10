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

Still shipped-but-not-yet-done at a glance: sharing with *selected users*, auto-save
draft composer, richer reactions, shorts / iPhone re-encode / volume normalization, and
self-hosted Whisper — all called out below.

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
> planned. **Still open:** the optional auto-save-composer-as-draft toggle (the iPhone
> "don't lose a recording on refresh" note).

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

## P3 — Federation / cross-posting

"Turn the app into a social media node": cross-post to other platforms (API, MCP, or
browser automation), share/export a post elsewhere, "let your fans back up your
content". Start with the simplest: per-post "cross-post" hook + webhooks; evaluate
ActivityPub only if the node idea gets serious.

## P3 — Everything else worth keeping

- **Link previews** ✅ Shipped 2026-07-09 — YouTube (title/channel/description, click-to-play
  embed), X/tweet quote cards, and generic OG cards; server-side fetch with SSRF guarding and
  re-hosted thumbnails. Spec: docs/plans/2026-07-09-link-previews.md.
- **Rich text** — bold/italic in the composer (was marked ASAP once); full rich-text
  editor only if genuinely needed.
- **Magic-link sign-in**; registration via a shared signup code that refreshes daily;
  password-strength check when creating a superuser.
- **Moderation** — content filtering ("censorship") pass; refresh community rules;
  ground-rules memo with countdown.
- **Keyboard shortcuts** for composer and feed actions.
- **Ephemeral mode** — optional auto-clearing of posts (hourly/daily/weekly, per user).
- **Post folders / Things-clone mode** — tags + folders + export; save lists (plus a
  browser extension to add items).
- **Display storage usage** to the user; show file size of media.
- **WebRTC live chat / P2P**; wake-word voice control; Apple Watch input. (Parked —
  revisit only if the core is done.)

## Open UX bugs & small fixes (from the notes, still unverified against current build)

- Pull-to-refresh with a mouse; PWA "open post" should stay in the same view.
- Feed feels heavy — profile with React Profiler.
- Can't scroll when the gesture starts on the post dropdown; darken behind tags popover.
- Mobile: full-width posts without card chrome; match x.com/LinkedIn content widths
  (~600px container; detailed measurements in the vault note `web-framework.md`).
- Dark mode as the default theme.
- Recording: graceful mic/camera permission denial; behavior on incoming call;
  "Post" during recording should stop the recording and submit; iPhone audio preview;
  Safari media quirks.

## Ops backlog

- **Periodic DB backups** — Litestream for SQLite-on-Fly was the noted choice.
- Serve compressed media by default; check staticfiles cache-control on Fly.
- Scheduled jobs on Fly (cron) — e.g. orphaned-media cleanup (a known gap: presigned
  PUTs rejected at post-create are never deleted from R2).
- External uptime monitoring (beyond `/healthz/`).
- Email: `tam@wut.sh`, `tam@webframework.dev`.
