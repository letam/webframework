# Auto-transcribe toggle — implementation spec

Status: implemented 2026-07-09 (P2 of docs/feature-backlog.md).

A client setting that starts transcription automatically when an audio/video post is
created, instead of requiring the per-post Transcribe button. Frontend-only: the
existing `POST /api/posts/<id>/transcribe/` endpoint (author-gated, throttled, 202 +
background task) already does everything needed, and the post card already polls while
`transcript_status === 'pending'` (Post.tsx).

Self-hosted Whisper (whisperX/faster-whisper) is explicitly out of scope — it needs GPU
infra that doesn't fit the 512MB Fly VM; revisit as an ops project.

## Changes

1. `src/lib/utils/settings.ts`: `AppSettings` += `autoTranscribe: boolean`, default
   `false` (add to `defaultSettings`; stored settings without the key fall back to the
   default via the existing spread-merge in `updateSettings` — verify `getSettings`
   merges defaults for missing keys; if it doesn't (it currently returns the stored
   object as-is), fix it to `{ ...defaultSettings, ...stored }` so new keys get
   defaults).
2. Settings page (`src/components/settings/SettingsPage.tsx`): add a toggle following
   the existing settings-row idiom —
   label "Auto-transcribe recordings", description "Start transcription automatically
   when you post audio or video. Requires being signed in." Persist via
   `updateSettings({ autoTranscribe })`.
3. Post-create hook (wherever `addPost` success is handled — `usePostHandlers` /
   `usePosts.addPost`): after a successful create, when ALL of:
   - `getSettings().autoTranscribe`
   - the requester is authenticated (`useAuth().isAuthenticated`)
   - `newPost.media?.media_type` is `'audio'` or `'video'`
   - `newPost.media.transcript_status` is empty (not already pending/done)

   call `transcribePost(newPost.id)` and apply the returned post to the caches (same
   cache-update path the manual Transcribe button uses), which flips
   `transcript_status` to `'pending'` and lets the existing polling UI take over.
   On failure: `toast.error('Auto-transcription failed to start')` — the post itself
   already succeeded and must not be affected.

## Tests

- settings: default false; toggling persists; `getSettings` returns defaults for keys
  missing from stored JSON.
- create flow (vitest, mocked API): with the setting on + authed + audio media,
  `transcribePost` is called once after create and caches get the pending post; with
  the setting off, or anonymous, or text/image posts, it is not called; a transcribe
  failure toasts but leaves the created post intact.
