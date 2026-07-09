# Feature Backlog

A prioritized roadmap of everything still wanted for wut.sh / webframework.dev,
consolidated on 2026-07-09 from ~280 scattered notes (Things exports and vault notes,
2022–2026). Items already shipped were dropped; what remains is ordered by how often it
was asked for, how well it fits the product, and rough effort.

Priority key: **P1** = asked for repeatedly, core to the product. **P2** = clear value,
asked for once or twice. **P3** = exploratory / someday.

## P1 — Post privacy

The single most-repeated request (six-plus notes, May–Nov 2025). The fullest spec:

- Visibility levels per post: **private** (author only), **public** (everyone), and
  **link-visible** (anyone holding the post's share token).
- Share tokens can be **regenerated** to revoke access for everyone holding the old link.
- Later: share drafts/posts with selected users.

Design notes: visibility belongs on the composer (small, not in the way — default
public) and on the post menu for existing posts. The feed, detail page (`/p/<id>`),
media streaming, and OG endpoints all need to respect it; media served from R2 via
presigned URLs already goes through the serializer, so gating is server-side only.

## P1 — Drafts

Recurring alongside privacy ("button for draft mode", "auto-submit as draft; select
multiple to publish", "on iPhone automatically post as draft"). Minimum shape:

- A post can be saved as **draft** instead of published; drafts are visible only to the
  author (a special case of privacy above — build them together).
- Drafts list (Profile tab or filter) with publish / bulk-publish.
- Optional toggle: auto-save composer content as a draft (the iPhone note was about not
  losing a recording when the page refreshes).

## P2 — Views and richer reactions

"Reactions, views, comments" recur as a trio; likes and comments shipped in Phase 2.

- **View counts** per post (server-side, debounced per session; show on detail page
  and/or hover card).
- Possibly extend like → small set of reactions. Only if it doesn't clutter the action
  row; the notes never specified emoji sets.

## P2 — Profile upgrades

From "webframework: mement.app: profile with pinned posts. weeklies. monthlies.":

- **Pinned posts** at the top of a profile.
- **Weeklies / monthlies**: automatic time-bucketed views of a user's posts.
- **Avatar upload** (identity-gradient fallbacks already exist).

## P2 — Search & filter power tools

From the Nov 2025 notes (multi-term filtering already shipped):

- **Saved filters**, plus recently-used / frequently-used filter suggestions.
- Google-like search operators (e.g. `author:`, quoted phrases, `-exclusion`).
- An "advanced" toggle below the filter box for the above.
- **Export data** button (dovetails with the offline/local-first work below).

## P2 — Media polish

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

## P2 — Transcription upgrades

- **Auto-transcribe toggle**: per-user (or per-post) option to transcribe media as soon
  as a post is created, instead of pressing the button.
- **Self-hosted Whisper** (whisperX / faster-whisper) as an alternative backend to the
  OpenAI API.

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

- **Link previews** — YouTube first, then generic OG-card previews.
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
