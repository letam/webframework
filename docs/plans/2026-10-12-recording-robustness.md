# Recording robustness — implementation spec

Status: planned 2026-10-12. Pipeline: fable-5 spec → coding model implements unsupervised → fable-5 review against this document. This is item 1 of "Next up" in `docs/feature-backlog.md` (the whole open recording row under "Open UX bugs & small fixes", lines 272-283), built as one piece. Save this file as `docs/plans/2026-10-12-recording-robustness.md`.

Recording is the core input path of an audio/video product and the least-hardened thing in the app. This pass makes the two recorders (`AudioRecorder.tsx`, `VideoRecorder.tsx`) survive the ways real devices fail — permission denied, no device, device busy, device unplugged or muted mid-take, a browser that cannot record at all — and adds a one-tap "stop and post" from inside the recorder. It also fixes one concrete, desk-verifiable defect that very likely explains the "iPhone audio preview" complaint (see Findings F7).

Ship as **two commits** on one branch: (1) shared utilities + their unit tests; (2) recorders, composer, e2e, docs. Every gate in "Gates" passes after each commit.

---

## Findings (current behaviour, verified 2026-10-12 against `main` @ `5b2e0ae`)

The backlog note dated 2026-08-12 is stale: commit `da386a7` (2026-08-13) already added the once-per-mount auto-start guard, device release on unmount, and a three-way error split. What is still missing is narrower and listed here.

**F1 — Permission errors are branched, but incompletely, and reported twice.** `AudioRecorder.tsx:64-78` (`micErrorMessage`) and `VideoRecorder.tsx:46-60` (`cameraErrorMessage`) map `NotAllowedError|SecurityError`, `NotFoundError|DevicesNotFoundError`, `NotReadableError`; everything else (`AbortError`, `OverconstrainedError`, `NotSupportedError`, a `TypeError` from `navigator.mediaDevices` being undefined on an insecure http origin, a `ReferenceError` when `MediaRecorder` is undefined in a webview) gets "Unable to access microphone. Please check permissions and try again." — wrong advice for all of them. On failure both recorders *also* `toast.error` the same string (`AudioRecorder.tsx:423`, `VideoRecorder.tsx:259`) that they render inline — double reporting in a 300px dialog. Neither offers a way out other than "Try again", which for `NotAllowedError` fails instantly again because browsers cache the denial.

**F2 — A failure after `getUserMedia` resolves leaks the device.** In `AudioRecorder.startRecording` (`:347-348`) the stream is a local; if `new MediaRecorder(stream, {...})` throws (`NotSupportedError`), the `catch` at `:420` never stops the tracks — the browser's recording indicator stays on until the tab closes. `VideoRecorder` stores `streamRef` (`:204`) but its `catch` (`:256-261`) does not stop it either.

**F3 — Processing failure dead-ends the dialog.** `AudioRecorder.tsx:400-405`: on a finalize error it toasts and sets `status = 'idle'`. The `idle` status renders no status text and no buttons (`:473-553`), and auto-start will not re-fire (`hasAutoStartedRef`). The user sees an empty dialog.

**F4 — No interruption handling.** Neither recorder listens for `ended`/`mute`/`unmute` on the stream's tracks, nor for `MediaRecorder.onerror`. If a USB mic is unplugged, or Chrome's site permission is revoked mid-take, the UA stops the recorder itself; our `onstop` runs, attaches the partial take and closes the modal with no explanation. A track that the OS mutes (iOS call interruption) records silence with the UI still saying "Recording...". Timers are `setInterval` increments (`AudioRecorder.tsx:319-329`, `VideoRecorder.tsx:156-172`), so a backgrounded tab (throttled timers, or iOS freezing JS) shows a clock that is behind reality when the user returns.

**F5 — "Post during recording" is impossible today, by construction.** Both recorders render inside a Radix `Dialog` (`AudioRecorder.tsx:26`, `VideoRecorder.tsx:24`); the overlay blocks the composer's Post button and focus is trapped. The only flow is Stop → modal closes (`CreatePost.tsx:970-986` closes on capture) → preview → Post. The handoff is `onAudioCaptured(blob)` from inside the async `onstop` continuation (`AudioRecorder.tsx:372-407`); the blob exists only after the final `dataavailable` and `stop` events fire, which is asynchronous relative to `recorder.stop()`.

**F6 — `submitPost` reads media from React state** (`CreatePost.tsx:495`, `:555` via `prepareMediaFile` at `:387-431`), so it cannot be called synchronously after `setAudioBlob` — the closure would still see `null` and toast "Please enter some text or add media".

**F7 — `webm-duration-fix` is applied to every recording regardless of container, and throws on non-WebM input.** `AudioRecorder.tsx:392-393` and `VideoRecorder.tsx:232-235` call `fixWebmDuration(blob)` unconditionally. The library's `makeMetadataSeekable` (`app/node_modules/webm-duration-fix/lib/ebml/tools.js:185-196`) does `originalMetadata[originalMetadata.length - 1].dataEnd`; for an MP4 blob the EBML decoder yields no metadata elements, so this is `undefined.dataEnd` → `TypeError` → the `catch` toasts "Error processing audio recording" and the take is discarded (F3). Safari's `MediaRecorder` produces `audio/mp4` / `video/mp4` (it is the second entry in `audioMimeTypes`, `media.ts:35-42`). On desktop Safari the audio path is masked because `normalizeAudio` defaults on there (`settings.ts:17-21`) and the normalize branch does not call the fix. On **iPhone** `isDesktop()` is false, so `normalizeAudio` defaults off → every iPhone audio recording that comes out as `audio/mp4` is dropped. Desktop Safari **video** recordings hit the same throw. Whether current iOS Safari reports `audio/webm;codecs=opus` as supported (which would dodge this) cannot be verified at a desk; the fix below is correct either way.

**F8 — `convertWavToWebM` hardcodes an encoder the browser may not have.** `audio.ts:23-25` constructs `new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })` and `:37-41` runs `fixWebmDuration` on the result. The normalize path (`CreatePost.tsx:399-404`) then names the file `recording_*.webm` with type `audio/webm;codecs=opus` regardless of what came back. On a browser without WebM/Opus recording, the constructor throws `NotSupportedError`, `submitPost` lands in "Failed to create post", and the WAV that was perfectly uploadable never leaves the device. `normalizeAudio` defaults **on** for desktop Safari and Firefox. Also note `convertWavToWebM` re-encodes in real time (`:49-56`: it waits `duration + 100ms`), so "Compressing media..." takes as long as the clip — pre-existing, out of scope (see D6).

**F9 — `getAudioExtension` (`audio.ts:69-78`) maps `audio/wav` and `audio/mpeg` to `webm`.** Harmless today only because WAV never ships; with F8's fallback it would.

**F10 — Dead state.** `AudioRecorder` keeps `audioURL` (`:218, :291, :345, :396-397, :468-471`) and creates/revokes an object URL per take, but never renders it; the preview lives in `MediaPreview`. `submitStatus`/`isProcessing` props (`:204-205`) are never passed by `AudioRecorderModal`. `VideoRecorder.stopTimer` (`:168-172`) never clears the ref.

**F11 — Video idle state has no action.** `VideoRecorder.tsx:291-295` renders only an icon when `!isRecording && !videoURL && !errorMessage`. On iOS the auto-start effect does `fileInputRef.current.click()` (`:178-181`); if the browser refuses the programmatic click outside a gesture, or the user cancels the native camera, the dialog is left with no button.

**F12 — Server side: no concrete defect requiring a change.** Checked: `views.py:506-540` validates `content_type` with `ALLOWED_CONTENT_TYPE_RE` (`uploads/s3.py:31`, accepts `;codecs=` suffixes); `stream_post_media` (`views.py:1079-1131`) serves single ranges with `Accept-Ranges`/`Content-Range` and 302s to a presigned URL for R2; `tasks.py:23-35` lists `.m4a/.mp4/.webm/.wav` as Whisper-native so MP3 conversion only runs for `.mov` (iOS native camera); `serializers.py:15-27` `_MEDIA_MIME_TYPES` lacks `m4a`/`mov` and maps audio `.webm` to `video/webm`, but `mime_type` is only used as a truthiness gate (`Post.tsx:120, :289-298`) and never for playback or `<source type>`, so this is cosmetic. `convert_to_mp3` swallows ffmpeg failures (`convert_to_mp3.py:46-50`) — pre-existing, unrelated to recording. **No backend changes in this pass.**

**F13 — Test surface.** No recorder tests exist. `vitest.setup.ts:114-121` stubs `MediaRecorder` as `{ isTypeSupported: () => true }` (not constructable). `CreatePost.test.tsx:64-80` mocks `AudioRecorderModal` with a single "Use recording" button and `:59-62` mocks `@/lib/utils/audio` with `getAudioExtension: () => 'wav'`. Playwright runs Chromium only (`playwright.config.ts`, `ci.yml:130`); the local Playwright browser cache does not match the pinned `@playwright/test` build, so WebKit was not probed. `bun run lint` is exactly at the 8-warning ceiling; three of those are in the recorders (`AudioRecorder.tsx:283, :462`; `VideoRecorder.tsx:88` — effects missing `startRecording`/`reset`).

---

## Vocabulary

- **Take** — the Blob a recorder produces. Never appears in UI copy ("recording" is the user word).
- **Attach** — hand the take to the composer, which shows it in `MediaPreview` with the existing X to discard. The modal closes.
- **Post** (from the recorder) — attach, then submit the composer exactly as the composer's own Post button would.
- **Interruption** — the stream ended (`ended` on any track, or `MediaRecorder.onerror`) without the user pressing Stop. A **mute** is not an interruption; it is a transient device state shown inline.
- **Finishing** — the window between `recorder.stop()` and the take being handed off (final `dataavailable`, `stop`, duration fix / normalization).

---

## Design decisions (pinned)

Items marked **[PO]** are ones the product owner may want to override; the stated choice is the default and implementation proceeds with it.

- **D1 [PO] — "Post" lives inside the recorder dialog, as a third button next to Stop.** Not a non-modal recorder: that would need the imperative ref API removed in `9c9afb4` and a floating dialog over the composer on phones. The dialog's Post button stops the recorder, hands the take off with `action: 'post'`, and the composer submits once the take is in state (D8). Stop keeps today's behaviour (attach, return to composer to review).
- **D2 — Errors are inline only, with actions. No toasts for `getUserMedia`/processing failures.** The dialog is the surface the user is looking at; the inline message carries the recovery copy and two actions: **Try again** (hidden for the two kinds where retrying cannot help: unsupported browser, insecure context) and **Upload a file instead** (closes the dialog and opens the composer's existing upload picker).
- **D3 [PO] — An interrupted take is attached automatically and explained with a toast.** Never auto-posted (an interruption always downgrades `'post'` to `'attach'`), never silently attached, never silently dropped. The modal closes as it does for a normal Stop, so a toast (the composer is now visible) is the right surface. A zero-byte interrupted take shows an inline error instead.
- **D4 — A muted track pauses nothing.** The recorder keeps running, the clock keeps counting, the status line changes to "Microphone paused by your device" until `unmute`. Stopping on mute would truncate a take on every iOS call banner.
- **D5 [PO] — Backgrounding the tab does nothing to the recorder.** The browser decides whether capture continues; we only make the clock wall-clock-based so it is right when the user comes back. Auto-stopping on `visibilitychange` would end desktop takes whenever the user switches tabs to read something.
- **D6 [PO] — Keep the real-time WAV→(opus|aac) re-encode after normalization**, but choose the encoder from `supportedAudioMimeType` and fall back to uploading the WAV unchanged when there is none. Replacing the real-time re-encode (an encoder library, or uploading WAV always) is a separate decision with a size/time trade-off; not this pass.
- **D7 — Recorder dialogs ignore outside clicks.** `onInteractOutside` is prevented on both `DialogContent`s. The X and Esc still close (and discard) — explicit actions only. Rationale: on a phone the overlay is a few px from the Stop button, and a stray tap currently discards the take with no confirmation.
- **D8 — Stop-then-submit handoff uses a ref + effect in the composer, not a parameter threaded through `submitPost`.** `handleAudioCaptured(blob, 'post')` sets state and a `postAfterCaptureRef`; an effect keyed on `[audioBlob, videoBlob]` calls the latest `submitPost` through a ref. This keeps `submitPost`/`prepareMediaFile` untouched (the outbox and autosave paths that depend on them are not re-risked), adds no ESLint warning (effects over refs have no missing deps), and runs after React has committed the blob so every existing check in `submitPost` sees it.
- **D9 — Share only what both recorders need; keep two components.** Shared: error classification + copy, stream interruption watcher, WebM-only finalize, track teardown, time formatting (pure module `capture.ts`), and a wall-clock recording clock (hook). Not shared: the state machines, the level meter, the video preview, the iOS file-input branch, normalization. A combined `useMediaRecorder` hook would be a rewrite with more regression surface than this pass justifies.
- **D10 — Track stopping moves from "right after `recorder.stop()`" to the `onstop` handler** (and `reset()`). Stopping the source tracks before the recorder has delivered its final chunk is the classic cause of truncated/empty WebKit recordings; the cost is the recording indicator staying on for the finishing window, which is now visible as "Finishing recording...".
- **D11 — Non-WebM takes are never passed to `webm-duration-fix`.** `finalizeRecording(blob)` runs the fix only when the blob's base type is `audio/webm`, `video/webm`, `audio/x-matroska` or `video/x-matroska`; otherwise it returns the blob untouched and does not even import the library.
- **D12 — `OverconstrainedError` on video gets one automatic retry** with `{ video: { facingMode: 'user' }, audio: true }` before the error state. Cheap, mechanical, and the current constraints (`aspectRatio: 16/9`, ideal sizes) are exactly the kind some webcams reject.
- **D13 — No WebKit Playwright project in this pass [PO].** It would need `playwright install webkit` in CI and its fake-capture support is unverified. The manual checklist plus the `/debug` page (fixed to not crash without `MediaRecorder`) cover the WebKit-only questions.
- **D14 — Pause/Resume becomes an icon-only button** (`size="icon"`, `variant="outline"`, `aria-label` "Pause"/"Resume") so Pause · Stop · Post fit in the 327px inner width of the dialog on a 375px phone. "Stop Recording" becomes "Stop" — it is inside a dialog titled "Record Audio"; the word "Recording" adds width, not meaning.

---

## Copy (exact strings; the reviewer greps for these)

Dialog titles unchanged: `Record Audio`, `Record Video`.

### Status lines

| State | Audio | Video |
| --- | --- | --- |
| loading | `Initializing microphone...` (existing) | `Initializing camera...` (new — video had no loading state) |
| recording | `Recording...` (existing) | `Recording video...` (existing) |
| recording + any track muted | `Microphone paused by your device` | `Camera paused by your device` |
| paused | `Recording paused` (existing) | n/a |
| finishing | `Finishing recording...` | `Finishing recording...` |
| normalizing (audio, `normalizeAudio` on) | `Normalizing audio...` (existing; now shown immediately, the 500 ms delay and `showNormalizingMessage` state are removed) | n/a |

The clock (`MM:SS`) renders under the status line in recording, muted, paused and finishing states (frozen in finishing).

### Buttons

| Button | Where | Variant / size | Label |
| --- | --- | --- | --- |
| Pause / Resume | audio: recording, paused | `outline`, `icon` | `aria-label="Pause"` / `aria-label="Resume"`, same text in `title` |
| Stop | both: recording, paused | `destructive`, `default` | `Stop` (Square icon) |
| Post | both: recording, paused | default (primary), `default` | `Post` (lucide `Send` icon) |
| Start recording | video: idle | default (primary), `default` | `Start recording` (Video icon) |
| Try again | both: error, when `isRetryableCaptureError(kind)` | `outline`, `default` | `Try again` (Mic / Video icon) |
| Upload a file instead | both: error (always) | `ghost`, `default` | `Upload a file instead` |

In `finishing` and `normalizing` all buttons are hidden (the dialog's X remains).

### Error copy (`captureErrorMessage(kind, device)`)

| kind | microphone | camera |
| --- | --- | --- |
| `denied` | `Microphone access is blocked. Allow it for this site in your browser settings, then try again.` | `Camera access is blocked. Allow it for this site in your browser settings, then try again.` |
| `not-found` | `No microphone was found. Connect one and try again.` | `No camera was found. Connect one and try again.` |
| `in-use` | `Your microphone is in use by another app. Close it and try again.` | `Your camera is in use by another app. Close it and try again.` |
| `overconstrained` | `Your microphone couldn't be set up. Try again, or upload a file instead.` | `Your camera couldn't be set up. Try again, or upload a file instead.` |
| `insecure-context` | `Recording needs a secure connection (https). Open this page over https, or upload a file instead.` | same |
| `unsupported` | `Recording isn't supported in this browser. Try the latest Safari or Chrome, or upload a file instead.` | same |
| `unknown` | `Couldn't start the microphone. Try again, or upload a file instead.` | `Couldn't start the camera. Try again, or upload a file instead.` |
| `empty` | `Nothing was recorded. Try again.` | same |
| `disconnected-empty` | `Your microphone disconnected before anything was recorded. Reconnect it and try again.` | `Your camera disconnected before anything was recorded. Reconnect it and try again.` |
| `processing` | `Couldn't finish the recording. Try again.` | same |

### Toasts (`toast.info` from `@/components/ui/sonner`)

| Interruption | microphone | camera |
| --- | --- | --- |
| `ended` | `Microphone disconnected. The recording stopped and what was captured is attached.` | `Camera disconnected. The recording stopped and what was captured is attached.` |
| `error` (`MediaRecorder.onerror`) | `Recording stopped unexpectedly. What was captured is attached.` | same |

Removed toasts: `Unable to access microphone...`, `Unable to access camera or microphone...`, `Error processing audio recording`, `Error processing video recording` (all replaced by inline error states). `Error processing video file` (iOS file pick) stays.

---

## Shared module APIs

### `app/src/lib/utils/capture.ts` (new; pure, no React)

```ts
export type CaptureDevice = 'microphone' | 'camera'
export type CaptureAction = 'attach' | 'post'
export type RecordingStatus = 'idle' | 'loading' | 'recording' | 'paused' | 'finishing' | 'error'
export type CaptureErrorKind =
	| 'denied' | 'not-found' | 'in-use' | 'overconstrained'
	| 'insecure-context' | 'unsupported' | 'unknown'
	| 'empty' | 'disconnected-empty' | 'processing'
export type StreamInterruption = 'ended' | 'muted' | 'unmuted'

/** Pre-flight: why recording cannot start here, or null. Checked before getUserMedia. */
export const captureSupportError = (): CaptureErrorKind | null
//   !window.isSecureContext → 'insecure-context'
//   !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' → 'unsupported'
//   else null

/** Map a thrown value (getUserMedia or MediaRecorder constructor) to a kind. */
export const classifyCaptureError = (error: unknown): CaptureErrorKind
//   typeof window !== 'undefined' && !window.isSecureContext → 'insecure-context' (checked first)
//   not a DOMException (TypeError, ReferenceError, …) → 'unsupported'
//   NotAllowedError | PermissionDeniedError | SecurityError → 'denied'
//   NotFoundError | DevicesNotFoundError → 'not-found'
//   NotReadableError | TrackStartError | AbortError → 'in-use'
//   OverconstrainedError | ConstraintNotSatisfiedError → 'overconstrained'
//   NotSupportedError → 'unsupported'
//   anything else → 'unknown'

export const captureErrorMessage = (kind: CaptureErrorKind, device: CaptureDevice): string
export const isRetryableCaptureError = (kind: CaptureErrorKind): boolean
//   false only for 'unsupported' and 'insecure-context'
export const interruptionToast = (interruption: 'ended' | 'error', device: CaptureDevice): string

/** Attach ended/mute/unmute listeners to every track; call onChange('muted') immediately
 *  for any track already muted. Returns the detach function. */
export const watchStreamInterruptions = (
	stream: MediaStream,
	onChange: (event: StreamInterruption) => void
): (() => void)

export const stopStreamTracks = (stream: MediaStream | null | undefined): void

export const isWebmLike = (mimeType: string): boolean
//   /^(audio|video)\/(webm|x-matroska)(;|$)/i on the trimmed type

/** Run webm-duration-fix only for WebM/Matroska; otherwise resolve the same blob.
 *  The dynamic import lives inside the WebM branch. */
export const finalizeRecording = (blob: Blob): Promise<Blob>

export const formatRecordingTime = (seconds: number): string   // 'MM:SS', moved from both recorders
```

### `app/src/hooks/useRecordingClock.ts` (new)

```ts
export const useRecordingClock = (): {
	seconds: number
	start: () => void    // reset to 0 and begin counting
	pause: () => void    // freeze (accumulate elapsed, clear interval)
	resume: () => void   // continue from the frozen value
	reset: () => void    // pause + zero
}
```
Implementation: refs `startedAt: number | null`, `accumulatedMs: number`; `tick` is a `useCallback([], …)` that sets `seconds = Math.floor((accumulatedMs + (startedAt ? Date.now() - startedAt : 0)) / 1000)`; while running, a 250 ms `setInterval` calls `tick`; a `visibilitychange` listener (effect with deps `[tick]`) calls `tick` when the document becomes visible; the unmount cleanup clears the interval. No effect references anything but refs, `tick`, and setState — zero ESLint warnings.

### Recorder component props (both files)

```ts
// AudioRecorder.tsx
interface AudioRecorderProps {
	onAudioCaptured: (blob: Blob, action: CaptureAction) => void
	onUploadInstead?: () => void
	disabled?: boolean
	autoStart?: boolean
}
interface AudioRecorderModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onAudioCaptured: (blob: Blob, action: CaptureAction) => void
	onUploadInstead: () => void
}
// VideoRecorder.tsx — identical shape with onVideoCaptured
```
`submitStatus` and `isProcessing` are removed from `AudioRecorderProps`.

---

## File-by-file changes

### Commit 1 — shared utilities

**NEW `app/src/lib/utils/capture.ts`** — as specified above. Copy tables are plain `Record<CaptureErrorKind, Record<CaptureDevice, string>>` constants in this file so the component files contain no user-facing error strings.

**NEW `app/src/hooks/useRecordingClock.ts`** — as specified above. Hook only, no components (react-refresh rule).

**MOD `app/src/lib/utils/audio.ts`**
- `convertWavToWebM`: import `supportedAudioMimeType` from `@/lib/utils/media` and `finalizeRecording` from `./capture`. First line: `if (!supportedAudioMimeType) return wavBlob`. Construct `new MediaRecorder(destination.stream, { mimeType: supportedAudioMimeType })`; in `onstop` resolve `await finalizeRecording(new Blob(chunks, { type: supportedAudioMimeType }))`. Keep the function name; replace its doc comment with: "Re-encodes a WAV through the first MediaRecorder type this browser supports (WebM/Opus on Chromium and Firefox, MP4/AAC on Safari). Returns the WAV unchanged when there is no encoder — the server accepts WAV." The real-time stop timer stays.
- `getAudioExtension`: table becomes `audio/webm → webm`, `audio/mp4 → m4a`, `audio/ogg → ogg`, `audio/wav → wav`, `audio/mpeg → mp3`, default `webm`.

**MOD `app/src/pages/DebugPage.tsx:5`** — replace the unguarded `mimeTypes.filter((type) => MediaRecorder.isTypeSupported(type))` with `[...getSupportedVideoMimeTypes(), ...getSupportedAudioMimeTypes()]` from `@/lib/utils/media` (both already guard `typeof MediaRecorder`). This page is what the device checklist reads; it must not crash on the browsers the checklist is about.

Tests for this commit: see "Test plan" (capture, useRecordingClock, audio).

### Commit 2 — recorders, composer, e2e, docs

**MOD `app/src/components/post/create/AudioRecorder.tsx`**
- Delete `micErrorMessage`, `formatTime`, the `showNormalizingMessage` state and its 500 ms timeout, the `audioURL` state and its revoke effect, the `'ready'` status, the `submitStatus`/`isProcessing` props. Import from `capture.ts` and `useRecordingClock`.
- State: `status: RecordingStatus | 'normalizing'`, `errorKind: CaptureErrorKind | null`, `deviceMuted: boolean`. Refs: `mediaRecorderRef`, `streamRef: MediaStream | null`, `unwatchRef: (() => void) | null`, `chunksRef`, `stopActionRef: CaptureAction` (default `'attach'`), `interruptionRef: 'ended' | 'error' | null`, plus the existing meter refs and `hasAutoStartedRef`.
- `startRecording()`:
  1. `if (disabled) return`; `setErrorKind(null)`; `setDeviceMuted(false)`; `interruptionRef.current = null`; `stopActionRef.current = 'attach'`.
  2. `const unsupported = captureSupportError(); if (unsupported) { setErrorKind(unsupported); setStatus('error'); return }`.
  3. `setStatus('loading')`; `try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); streamRef.current = stream; … }`.
  4. `unwatchRef.current = watchStreamInterruptions(stream, handleInterruption)` where `handleInterruption`: `'muted'` → `setDeviceMuted(true)`; `'unmuted'` → `setDeviceMuted(false)`; `'ended'` → if `interruptionRef.current === null` set it to `'ended'`, then `if (recorder.state !== 'inactive') recorder.stop()` inside `try {}` (the UA may already have stopped it).
  5. Construct the recorder; meter setup unchanged except add `audioContext.resume().catch(() => {})` right after construction (iOS starts contexts suspended outside a gesture; the meter is best-effort, so this is a no-op elsewhere).
  6. `recorder.onerror = () => { if (interruptionRef.current === null) interruptionRef.current = 'error'; try { if (recorder.state !== 'inactive') recorder.stop() } catch {} }`.
  7. `recorder.onstop` — see "onstop contract" below.
  8. `recorder.start(); clock.start()`; the existing Safari-desktop 500 ms delay before `setStatus('recording')` stays.
  9. `catch (error)`: `console.error('Error accessing microphone:', error)`; `unwatchRef.current?.(); unwatchRef.current = null; stopStreamTracks(streamRef.current); streamRef.current = null; setErrorKind(classifyCaptureError(error)); setStatus('error')`. **No toast.**
- `stopRecording(action: CaptureAction)`: only when status is `recording`/`paused`; `stopActionRef.current = action; clock.pause(); stopMeter(); setStatus('finishing'); recorder.stop()`. Do **not** stop tracks here (D10).
- **onstop contract** (both recorders implement this shape):
  ```
  onstop:
    unwatchRef.current?.(); unwatchRef.current = null
    stopStreamTracks(streamRef.current); streamRef.current = null
    teardownMeter()                                   // audio only
    const interruption = interruptionRef.current
    const action = interruption ? 'attach' : stopActionRef.current
    (async () => {
      const raw = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? recorder.mimeType })
      if (raw.size === 0) { setErrorKind(interruption === 'ended' ? 'disconnected-empty' : 'empty'); setStatus('error'); return }
      try {
        let take = raw
        if (getSettings().normalizeAudio) { setStatus('normalizing'); take = await normalizeAudio(raw) }   // audio only
        else take = await finalizeRecording(raw)
        if (mediaRecorderRef.current !== recorder) return     // torn down (X / unmount) while processing
        if (interruption) toast.info(interruptionToast(interruption, 'microphone'))
        onAudioCaptured(take, action)
        setStatus('idle')
      } catch (error) {
        console.error('Error processing audio recording:', error)
        if (mediaRecorderRef.current !== recorder) return
        setErrorKind('processing'); setStatus('error')
      }
    })()
  ```
  `normalizeAudio`'s own catch currently returns the raw blob; change it to `return finalizeRecording(audioBlob)` so a failed normalization still gets a seekable WebM.
- `reset()` (unmount + Try-again path): additionally `unwatchRef.current?.()`, `stopStreamTracks(streamRef.current)`, `clock.reset()`, `interruptionRef.current = null`, `setDeviceMuted(false)`, `setErrorKind(null)`. Keep the existing "detach handlers before stopping" order.
- Render: `StatusMessage` takes `status`, `seconds`, `deviceMuted`, `errorKind` and renders the copy table above (error text via `captureErrorMessage(errorKind, 'microphone')`). The mic ring renders in `recording`, `paused`, `finishing`. Footer:
  - error: `Try again` (only if `isRetryableCaptureError(errorKind)`) + `Upload a file instead` (`onClick={onUploadInstead}`, rendered only when the prop is provided).
  - recording/paused: Pause/Resume icon button (`autoFocus` when recording, as today) · `Stop` (`onClick={() => stopRecording('attach')}`) · `Post` (`onClick={() => stopRecording('post')}`).
  - loading, finishing, normalizing, idle: no buttons.
- `AudioRecorderModal`: `DialogContent className="sm:max-w-[425px] min-h-[300px] flex flex-col"` (was `h-[300px]`), add `onInteractOutside={(e) => e.preventDefault()}`, pass `onUploadInstead` through.

**MOD `app/src/components/post/create/VideoRecorder.tsx`**
- Replace `isRecording` boolean + `errorMessage` with `status: RecordingStatus`, `errorKind`, `deviceMuted`; same refs as audio (no meter). Delete `cameraErrorMessage`, `formatTime`, the timer helpers (use `useRecordingClock`). Keep `videoURL` and its revoke effect, the iOS file-input branch, `handleFileChange` (which calls `onVideoCaptured(file, 'attach')`).
- `startRecording()` mirrors audio with: `setStatus('loading')` before `getUserMedia`; device word `'camera'`; the D12 relaxed retry:
  ```
  let stream: MediaStream
  try { stream = await getUserMedia({ video: videoConstraints, audio: true }) }
  catch (error) {
    if (classifyCaptureError(error) !== 'overconstrained') throw error
    stream = await getUserMedia({ video: { facingMode: 'user' }, audio: true })
  }
  ```
  The preview `play()` stays; the `catch` stops tracks and sets the error state exactly as audio. In `onstop`'s `finally`, keep `videoRef.current.srcObject = null`; keep `setVideoURL(URL.createObjectURL(take))` before `onVideoCaptured(take, action)`.
- Render:
  - `idle`: the Video icon **plus** a `Start recording` button (`onClick={startRecording}`) centred in the black box (F11).
  - `loading`: spinner + `Initializing camera...` over the black box.
  - `recording`: `<video>` preview (unchanged attributes), status line (`Recording video...` or `Camera paused by your device`), clock, then `Stop` · `Post` (no pause).
  - `finishing`: preview frozen, spinner + `Finishing recording...`, clock, no buttons.
  - `error`: message + `Try again` (if retryable) + `Upload a file instead`, over the black box as today (keep the `text-white/80` styling).
- `VideoRecorderModal`: `min-h-[420px]` (was `h-[420px]`), `onInteractOutside` prevented, `onUploadInstead` passed through.

**MOD `app/src/components/post/create/CreatePost.tsx`**
- Import `type CaptureAction` from `@/lib/utils/capture`.
- Replace `handleAudioCaptured`/`handleVideoCaptured` (`:304-313`):
  ```ts
  const postAfterCaptureRef = useRef(false)
  const handleAudioCaptured = (blob: Blob, action: CaptureAction = 'attach') => {
  	setAudioBlob(blob); setAudioFile(null); setMediaType('audio'); setIsAudioModalOpen(false)
  	if (action === 'post') postAfterCaptureRef.current = true
  }
  const handleVideoCaptured = (blob: Blob, action: CaptureAction = 'attach') => {
  	setVideoBlob(blob); setVideoFile(null); setMediaType('video'); setIsVideoModalOpen(false)
  	if (action === 'post') postAfterCaptureRef.current = true
  }
  const uploadInsteadOfRecording = () => {
  	setIsAudioModalOpen(false); setIsVideoModalOpen(false); uploadInputRef.current?.click()
  }
  ```
- Directly after `handleSubmit` (`:597-599`), the latest-ref + effect (D8):
  ```ts
  const submitPostRef = useRef(submitPost)
  submitPostRef.current = submitPost
  useEffect(() => {
  	if (!postAfterCaptureRef.current || (!audioBlob && !videoBlob)) return
  	postAfterCaptureRef.current = false
  	void submitPostRef.current(false)
  }, [audioBlob, videoBlob])
  ```
- Modals (`:970-986`): `onAudioCaptured={handleAudioCaptured}` / `onVideoCaptured={handleVideoCaptured}` (drop the inline wrappers that closed the modal — the handlers do it now) and `onUploadInstead={uploadInsteadOfRecording}` on both.
- `prepareMediaFile` normalize branch (`:399-404`):
  ```ts
  setSubmitStatus('compressing')
  const encoded = await convertWavToWebM(blob)
  file = new File([encoded], `recording_${Date.now()}.${getMediaExtension(encoded.type, 'audio')}`, { type: encoded.type })
  ```
  Everything else in `submitPost`, `queuePost`, autosave wiring and outbox wiring is untouched. (Autosave already writes the blob on attach and `resetComposer` clears it on success; the attach→post sequence serialises on the same IndexedDB store exactly as a fast manual Post does today.)

**MOD `app/src/__tests__/components/CreatePost.test.tsx`** — see Test plan (mock changes).

**NEW `app/src/__tests__/helpers/mediaCapture.ts`**, **NEW `app/src/__tests__/components/AudioRecorder.test.tsx`**, **NEW `app/src/__tests__/components/VideoRecorder.test.tsx`**, **NEW `app/e2e/recording.spec.ts`** — see Test plan.

**MOD `docs/feature-backlog.md`** — annotate, do not delete (house style):
- Under the recording row (line ~274, before the ⚠️ sizing note) add: `✅ Shipped 2026-10-12 (<commit>) — spec in \`docs/plans/2026-10-12-recording-robustness.md\`. Still open: that plan's device-only checklist (iPhone/Safari behaviour that cannot be verified at a desk).`
- "Next up" item 1 (line 44): append ` ✅ 2026-10-12 — built; device checklist outstanding.`

**NEW `docs/plans/2026-10-12-recording-robustness.md`** — this document, with the deviation log filled in by the implementer.

**No changes** to `MediaPreview.tsx`, `composerDraft.ts`, `outboxDb.ts`, `outbox.ts`, `useComposerDraft.ts`, anything under `server/`.

---

## Test plan

### Mocking strategy

- `vitest.setup.ts` stays as is. Recorder tests install their own constructable fake via `vi.stubGlobal('MediaRecorder', FakeMediaRecorder)` (vitest mirrors stubs onto `window` in jsdom).
- `webm-duration-fix` is mocked per test file: `vi.mock('webm-duration-fix', () => ({ default: vi.fn(async (blob: Blob) => blob) }))`; tests import the mock to assert call counts.
- `getUserMedia` is installed with `Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: fn } })`.
- jsdom gaps stubbed in the helper: `AudioContext` (minimal: `createMediaStreamSource → { connect }`, `createAnalyser → { fftSize, getByteTimeDomainData() {} }`, `resume → Promise`, `close → Promise`), `HTMLMediaElement.prototype.play/pause` (`vi.fn().mockResolvedValue(undefined)` / `vi.fn()`), `URL.createObjectURL`/`revokeObjectURL`.
- `isSecureContext` is forced with `Object.defineProperty(window, 'isSecureContext', { configurable: true, value })` in the tests that need it.

**`app/src/__tests__/helpers/mediaCapture.ts`** (not a test file; Vitest's default include only runs `*.test.*`):
```ts
export class FakeMediaStreamTrack extends EventTarget { kind; readyState = 'live'; muted = false; stop = vi.fn(() => { this.readyState = 'ended' }); end() {…dispatch 'ended'}; mute() {…}; unmute() {…} }
export const makeFakeStream = (kinds: ('audio'|'video')[] = ['audio']) => ({ tracks, getTracks, getAudioTracks, getVideoTracks })
export class FakeMediaRecorder {
	static instances: FakeMediaRecorder[]; static isTypeSupported = () => true
	static chunkType = 'audio/webm;codecs=opus'; static emitChunks = true
	state: 'inactive'|'recording'|'paused'; stream; mimeType; ondataavailable; onstop; onerror
	start(); pause(); resume()
	stop()   // state = 'inactive'; queueMicrotask: emit one dataavailable (Blob(['chunk'], { type: mimeType ?? chunkType })) if emitChunks, then onstop
	fail()   // calls onerror with { error: new DOMException('x', 'UnknownError') }, then stop()
}
export const installCaptureFakes = (opts?: { getUserMedia?: typeof navigator.mediaDevices.getUserMedia }) => { … returns { getUserMedia, reset } }
```

### `app/src/__tests__/lib/utils/capture.test.ts`

1. `classifyCaptureError` table: each DOMException name above → expected kind; `new TypeError()` → `unsupported`; `new DOMException('', 'FooError')` → `unknown`; any error with `window.isSecureContext = false` → `insecure-context`.
2. `captureSupportError`: `mediaDevices` undefined → `unsupported`; `MediaRecorder` undefined → `unsupported`; insecure → `insecure-context`; both present and secure → `null`.
3. `captureErrorMessage`: every `(kind, device)` cell equals the copy table (snapshot-free: literal `expect(...).toBe('…')` for all 20 cells, so a copy change is a visible diff).
4. `isRetryableCaptureError`: false for `unsupported`, `insecure-context`; true for the rest.
5. `watchStreamInterruptions`: dispatching `ended`/`mute`/`unmute` on a track calls `onChange` with `ended`/`muted`/`unmuted`; a track already `muted` at attach time triggers `muted` synchronously; the returned function detaches (no calls after).
6. `isWebmLike`: true for `audio/webm;codecs=opus`, `video/webm`, `video/x-matroska;codecs=…`; false for `audio/mp4;codecs=mp4a.40.2`, `audio/wav`, `''`.
7. `finalizeRecording`: for a `audio/mp4` blob resolves the **same object** and the `webm-duration-fix` mock is not called; for `audio/webm` the mock is called once with the blob.
8. `formatRecordingTime(0) === '00:00'`, `(65) === '01:05'`, `(3600) === '60:00'`.

### `app/src/__tests__/hooks/useRecordingClock.test.ts` (fake timers)

1. `start` then advance 3 000 ms → `seconds === 3`.
2. `pause`, advance 5 000 → still 3; `resume`, advance 2 000 → 5.
3. `reset` → 0 and stays 0 after advancing.
4. Wall-clock catch-up: `start`, then `vi.setSystemTime(now + 60_000)` without running intervals, dispatch `visibilitychange` with `document.visibilityState` stubbed to `'visible'` → `seconds === 60`.
5. Unmount clears the interval (`vi.getTimerCount()` returns 0 after unmount).

### `app/src/__tests__/lib/utils/audio.test.ts`

1. `getAudioExtension` table (webm, mp4→m4a, ogg, wav, mpeg→mp3, `audio/flac` → webm default).
2. `convertWavToWebM` returns its input unchanged (same object) when `supportedAudioMimeType` is undefined — `vi.mock('@/lib/utils/media', () => ({ supportedAudioMimeType: undefined }))`; `AudioContext` must not be constructed (stub it with a `vi.fn()` and assert not called).

### `app/src/__tests__/components/AudioRecorder.test.tsx`

Render `AudioRecorder` (default export) with `autoStart`, `onAudioCaptured = vi.fn()`, `onUploadInstead = vi.fn()`; mock `@/components/ui/sonner` like CreatePost.test does (`toast` with `info`, `error`, `success`). Each case waits with `waitFor`/`findByText`.

1. `NotAllowedError` → shows the denied microphone copy, `Try again` and `Upload a file instead` buttons; `toast.error`/`toast.info` not called.
2. `NotFoundError` → not-found copy. `NotReadableError` → in-use copy. `AbortError` → in-use copy.
3. `mediaDevices` undefined and `isSecureContext = false` → insecure copy; **no** `Try again` button; `Upload a file instead` present and clicking it calls `onUploadInstead`.
4. `getUserMedia` resolves, `MediaRecorder` constructor throws `new DOMException('', 'NotSupportedError')` → unsupported copy **and** every fake track's `stop` was called (F2).
5. Happy path: status shows `Recording...`, clock visible; click `Stop` → `Finishing recording...` with no buttons → `onAudioCaptured` called once with `(Blob of type 'audio/webm;codecs=opus', 'attach')`; track `stop` called; the duration-fix mock called once.
6. Post: click `Post` → `onAudioCaptured(blob, 'post')`.
7. Pause/Resume: click the `Pause` button (by `aria-label`) → `Recording paused` and `FakeMediaRecorder.instances[0].state === 'paused'`; click `Resume` → `Recording...`.
8. Interruption — ended: dispatch `end()` on the fake track while recording → recorder state `inactive`, `onAudioCaptured(blob, 'attach')`, `toast.info` called with the microphone `ended` string. Variant: `Post` was clicked and then `end()` fires before `onstop` — still `'attach'`.
9. Interruption — ended with no data: `FakeMediaRecorder.emitChunks = false`, `end()` → inline `disconnected-empty` copy, `Try again` shown, `onAudioCaptured` not called, no toast.
10. Mute: `track.mute()` → `Microphone paused by your device`; `unmute()` → `Recording...`; `onAudioCaptured` not called.
11. `onerror` (`fail()`) → `onAudioCaptured(blob, 'attach')` + `toast.info` with the `error` string.
12. Non-WebM take: `FakeMediaRecorder.chunkType = 'audio/mp4;codecs=mp4a.40.2'`, `normalizeAudio` off → `onAudioCaptured` receives a blob of that type and the duration-fix mock is **not** called (F7).
13. Processing failure: duration-fix mock rejects → inline `Couldn't finish the recording. Try again.`, `Try again` present, no toast, `onAudioCaptured` not called.
14. `Try again` after an error calls `getUserMedia` a second time (exactly 2 calls total) and reaches `Recording...`.
15. Unmount while recording: tracks stopped, `onAudioCaptured` never called even after the fake recorder's queued `onstop` would have fired.
16. Empty take on normal Stop (`emitChunks = false`) → `Nothing was recorded. Try again.`

### `app/src/__tests__/components/VideoRecorder.test.tsx`

`isIOS` is false under jsdom's UA; no mocking of `browser.ts` needed.

1. `NotAllowedError` → camera denied copy; no toast.
2. `OverconstrainedError` on the first call, success on the second → `getUserMedia` called twice, second call's `video` constraint equals `{ facingMode: 'user' }`, status reaches `Recording video...`.
3. `OverconstrainedError` twice → overconstrained camera copy.
4. `autoStart={false}` → idle shows `Start recording`; clicking it calls `getUserMedia`.
5. Loading: `getUserMedia` pending → `Initializing camera...` visible.
6. Stop → `Finishing recording...` → `onVideoCaptured(blob, 'attach')`; `Post` → `'post'`.
7. Ended → attach + camera `ended` toast; muted → `Camera paused by your device`.
8. Non-WebM take (`video/mp4`) bypasses the duration fix.
9. Unmount while recording stops both tracks and never calls back.

### `app/src/__tests__/components/CreatePost.test.tsx` (modifications)

- `vi.mock('@/lib/utils/audio', …)` becomes `async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/utils/audio')>()), convertWavToWebM: mockConvertWavToWebM })` so `getAudioExtension` is real (the existing `.webm` / opus assertions still hold because the mock conversion returns an opus blob).
- The `AudioRecorderModal` mock gains a second button `Post recording` that calls `onAudioCaptured(new Blob(['recording'], { type: 'audio/wav' }), 'post')`, and accepts/ignores `onUploadInstead`.
- New cases:
  1. "posts straight from the recorder": click `Record Audio` → `Post recording` → `onPostCreated` called with `expect.objectContaining({ media_type: 'audio' })`; `toast.error` not called; the recorder dialog button is gone.
  2. "posting from the recorder with text includes the text": type `Caption` first, then as above → `text: 'Caption'`.
  3. "a failed recorder post keeps the take": `onPostCreated` rejects with a non-TypeError → `toast.error('Failed to create post')` and `Voice recording` still visible in the preview.
  4. "normalize path names the file from the encoder's type": `normalizeAudio: true`, `mockConvertWavToWebM` resolves a `audio/mp4;codecs=mp4a.40.2` blob → queued/created file name matches `/^recording_\d+\.m4a$/` and type equals that string.
  5. "normalize path uploads WAV when the encoder is absent": `mockConvertWavToWebM` resolves the input WAV → file name `/\.wav$/`, type `audio/wav`.

### `app/e2e/recording.spec.ts` (Chromium; needs Django on :8000 like the rest of the e2e suite)

```ts
test.describe('Recording from the composer', () => {
	test.use({
		permissions: ['microphone'],
		launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
	})
	test('stops and posts from the dialog', …)
})
test.describe('Recording without microphone permission', () => {
	test.use({
		permissions: [],
		launchOptions: { args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] },
	})
	test('explains the denial inline and offers upload', …)
})
```
Both `beforeEach` set the ground-rules localStorage like `offline-posts.spec.ts`.
1. Goto `/`; click `Record Audio`; `dialog = page.getByRole('dialog', { name: 'Record Audio' })`; expect `dialog.getByText('Recording...')`; expect `dialog.getByText('00:01')` (timeout 5 s); click `dialog.getByRole('button', { name: 'Post', exact: true })`; expect dialog hidden; expect `page.getByText('Post created successfully!')` visible (timeout 15 s); expect `[data-composer-input]` to have value `''`.
2. Goto `/`; click `Record Audio`; expect `dialog.getByText('Microphone access is blocked', { exact: false })`; expect `Try again` and `Upload a file instead` buttons visible; expect no `[data-sonner-toast]` element.

---

## Manual device checklist (cannot be verified at a desk — do **not** plan fixes for these in this pass)

Record the result of each against the build in the deviation log or a follow-up note.

1. **iPhone Safari, audio.** Open `/debug`; note which `audio/*` types are listed. Record 5 s → the composer preview plays and shows a finite duration, scrubbing works → Post → feed playback works. If the listed type is `audio/mp4`, confirm the take is now kept (F7 regression).
2. **iPhone Safari, incoming call mid-recording.** Expect either `Microphone paused by your device` then recovery after the call, or the `ended` toast with the partial take attached. Note which.
3. **iPhone Safari, video.** Open `Record Video`: does the native camera open automatically, or only after `Start recording`? Cancel the native camera → confirm the dialog shows `Start recording`. Record → `.mov` attaches → Post → feed playback (poster + play).
4. **iPhone Safari, background during audio recording** (switch apps 30 s, return): is the take still running, paused, or ended? Is the clock correct on return?
5. **iPhone, level meter** animates while recording (AudioContext `resume()`).
6. **macOS Safari, audio with `Normalize audio` on (default) and off.** Both produce a playable preview and a successful post; note "Compressing media..." duration vs clip length with it on; note the uploaded extension (`.webm`/`.m4a`/`.wav`).
7. **macOS Safari, video** record → preview → post → feed playback (F7 for `video/mp4`).
8. **macOS Safari, feed playback of a long (>5 min) audio post backed by R2** — seeking past the 60 s mark works (the flagged `signed_url` TTL question from the quality audit; unchanged here).
9. **Desktop Chrome / Firefox, unplug a USB mic mid-take** → `ended` toast, partial take attached.
10. **Desktop Chrome, revoke the site's microphone permission mid-take** (site info → reset) → same as 9.
11. **Desktop Chrome, background the tab 2 min mid-take** → clock correct on return, take continues.
12. **Android Chrome** audio + video record/preview/post; incoming call during audio.
13. **Firefox** permission denial copy, `Try again` after allowing.

---

## Gates (both commits)

```bash
cd app && bun run typecheck      # TS 7 — never bunx tsc
cd app && bun run lint           # must stay ≤ 8 warnings; the three recorder warnings may move lines but must not multiply
cd app && bun run test           # Vitest — never bare `bun test`
cd app && bun run check          # Biome
cd app && bun run test:e2e       # commit 2; Django on :8000
```
No server changes, so the Python gates are unaffected (run them anyway before the PR).

ESLint discipline: no new `useEffect` may reference `startRecording`, `reset`, `submitPost` or any other per-render function directly; go through a ref (D8 pattern) or `useCallback([])`. Biome: keep the existing `biome-ignore lint/correctness/useExhaustiveDependencies` comments on the auto-start and unmount effects. Formatting: tabs, single quotes, no semicolons, ES5 trailing commas.

---

## Non-goals / explicitly out of scope

- iPhone `.mov` re-encode, shorts, server-side volume normalization (backlog: deferred, need devices).
- Replacing the real-time WAV re-encode (D6) or changing the `normalizeAudio` default.
- A non-modal / inline recorder, or composer keyboard shortcuts reaching into the dialog.
- Auto-stop on `visibilitychange` (D5); a confirmation on X/Esc while recording.
- A WebKit Playwright project (D13).
- Server changes: serializer `_MEDIA_MIME_TYPES` (`m4a`, `mov`, audio `.webm`) — cosmetic; `convert_to_mp3` swallowing ffmpeg errors; `signed_url` presign TTL; the `.webm`-means-audio upload heuristic in `handleUploadFileChange`.
- Kept-on-purpose limitations stay: presigned PUT accepting non-media bytes, per-process throttles, signed-URL caching.
- `MediaPreview.tsx` is untouched; the autosave (`composerDraft.ts`, `useComposerDraft.ts`) and outbox (`outbox.ts`, `outboxDb.ts`) contracts are untouched — only the WAV-fallback file name/type in the normalize path can differ, and both stores carry `File`s opaquely.

---

## Acceptance criteria (what the reviewer checks)

1. Every string in the Copy section appears verbatim in `capture.ts` (errors/toasts) or the recorder JSX (status/buttons); none of the four removed toasts remain in `AudioRecorder.tsx`/`VideoRecorder.tsx`; no `toast.error` is called on a `getUserMedia` or processing failure.
2. `classifyCaptureError` and `captureSupportError` cover every name listed, in the listed precedence; `isRetryableCaptureError` is false only for `unsupported` and `insecure-context`, and the `Try again` button is absent exactly then.
3. A `MediaRecorder` constructor failure stops the acquired stream's tracks (test A4).
4. `onstop` stops tracks and only then processes; no `track.stop()` remains immediately after `recorder.stop()` in `stopRecording` (D10).
5. `finalizeRecording` is the only call site of `webm-duration-fix` in `src/` (grep: exactly one `import('webm-duration-fix')`), and non-WebM blobs bypass it.
6. `convertWavToWebM` uses `supportedAudioMimeType` and returns the WAV when it is undefined; `prepareMediaFile` derives the file name and type from the encoded blob.
7. Track `ended` / `onerror` mid-take → partial take attached with `action 'attach'` and the matching `toast.info`; zero-byte interrupted take → `disconnected-empty` inline; `mute`/`unmute` → status line only.
8. `Post` in either dialog results in `onPostCreated` (or the outbox path) being invoked with the recording, with no "Please enter some text or add media" toast; a failed submit leaves the take attached.
9. The `Record Video` idle state has a `Start recording` button; both dialogs show a loading line before permission resolves; both dialogs show `Finishing recording...` with no buttons between Stop and handoff.
10. Clock is wall-clock based (`useRecordingClock`), survives a simulated 60 s gap (test 4).
11. Both `DialogContent`s prevent `onInteractOutside`; heights are `min-h-*`.
12. `AudioRecorder` no longer has `audioURL`, `submitStatus`, `isProcessing`, `showNormalizingMessage`, `'ready'`; `DebugPage` does not call `MediaRecorder.isTypeSupported` unguarded.
13. All new tests listed above exist and pass; `CreatePost.test.tsx`'s existing cases still pass with the updated mocks; `bun run lint` reports ≤ 8 warnings; e2e `recording.spec.ts` passes in CI.
14. `docs/feature-backlog.md` row and "Next up" item are annotated as specified; this plan is saved at the stated path with the deviation log filled in.
15. No files under `server/` changed.

---

## Deviation log

Deviations from this spec found necessary during implementation are recorded here by the implementing/judging models, one bullet each: what the spec said, what was done instead, why.

- The spec calls for two commits and a commit hash in the backlog annotation. Both phases were implemented and gated as working-tree changes; the annotation says `working-tree changes; commit pending`, because the user explicitly prohibited all git writes.
- The spec uses `vi.stubGlobal('MediaRecorder', FakeMediaRecorder)`. The unchanged `vitest.setup.ts` defines `MediaRecorder` as non-configurable but writable, so `vi.stubGlobal` throws `Cannot redefine property: MediaRecorder`. Tests replace only its value on `window` and `globalThis` with `Object.defineProperty`, then restore it.
- The clock pseudocode tests `startedAt` for truthiness. The implementation checks `startedAt.current !== null`, because zero is a valid start time under fake timers and must count elapsed time.
- The watcher pseudocode forwards every track's `unmute` as `unmuted`. It instead emits `muted` while any other track is still muted, so the pinned “any track muted” status remains correct for video streams with separate camera and microphone tracks.
- The startup sequence has no cancellation check around pending permission or preview promises, and the Safari delay sets recording state unconditionally. Both recorders now invalidate pending starts on reset, stop late-acquired streams, and ignore stale continuations; the Safari delay also checks recorder identity and state. Otherwise closing during permission acquisition leaks devices, and a delayed callback can overwrite an interruption state.
- The video error overlay originally sits absolutely inside a fixed 16:9 box. The error content now participates in layout and the error box can grow, because the pinned longer error copy plus two default-size buttons can exceed 180px and would be clipped by `overflow-hidden`.

- Acceptance criterion 7 says every zero-byte interrupted recording uses `disconnected-empty`, but the detailed `onstop` contract assigns that kind only to `ended` and assigns `empty` to recorder errors. Both recorders follow the detailed contract, with tests for empty `onerror` recordings, because a recorder error does not establish that the device disconnected.

Device-only verification: all 13 manual checklist items remain outstanding; no device results are claimed. The backlog annotations retain this follow-up.

- The spec puts both e2e cases in `app/e2e/recording.spec.ts`, each describe block with its own `launchOptions`. Playwright refuses `launchOptions` inside a describe ("forces a new worker"), so the file did not load at all. The denied-permission case moved to `app/e2e/recording-denied.spec.ts`; each file sets its options at the top level.
- The spec's `finalizeRecording` destructures `{ default: fixWebmDuration }` from the dynamic import, as `main` did. Under the Vite dev server that `default` is the CommonJS exports object, not the function, so every WebM take failed with `fixWebmDuration is not a function` — caught by the e2e run, invisible to the unit tests because they mock the module. `finalizeRecording` now accepts either shape. The identical import on `main` means recording was already broken under `bun dev`. A production build of this branch was checked separately (a WebM take finalizes and attaches), so both shapes are exercised.
- Review round (2026-10-12), applied after the judge's "fix-then-ship":
  - The spec relied on the recorder's unmount to cancel a pending handoff, but Radix keeps `DialogContent` mounted for its 200 ms exit animation, so X/Esc during finishing or normalizing could still attach — and, for a take stopped with Post, publish — the recording. Both modals now render the recorder only while `open`. `RecorderModalClose.test.tsx` covers it with a dialog stand-in that never unmounts its content (jsdom has no animations, so the real dialog cannot reproduce the window); the test fails without the fix.
  - `bun run lint` now reports 5 warnings, so the ceiling in `app/package.json` dropped from 8 to 5.
  - The spec said to keep the `biome-ignore` comments on the auto-start and unmount effects. They were already unused suppressions on `main` and are removed; `bun run check` goes from 5 warnings to 1.
  - The unmount cleanup re-arms auto-start, so adding `<StrictMode>` later does not leave both dialogs blank. The video error state is vertically centred, and the video clock uses `tabular-nums` like the audio one.
  - Left open from the review: the interruption handler closes over `recorder` before its declaration (unreachable today); a UA that delivers the recorder's `stop` before the track's `ended` would attach silently and honour a pending Post (device checklist items 9 and 10 decide); a recorder Post while the composer is locked by an outbox load attaches without posting and says nothing; no test yet for recorder Post on the outbox path; `normalizeAudio` never closes its `AudioContext` (pre-existing).
- PR 19 review (2026-10-18), two fixes:
  - The spec kept `VideoRecorder`'s `videoURL` and its revoke effect. The composer closes the dialog in the same update that hands a take off, and the recorder renders only while `open`, so it unmounted before that effect could install its cleanup: every take's object URL, and the blob behind it, stayed alive for the life of the page (the iOS file pick too). The URL was never visible, since `MediaPreview` shows the take, so `videoURL` is removed rather than revoked, as F10 did for audio. The `<video>` element is now always `muted`, since it only ever shows the live camera.
  - A recorder Post while an outbox Edit holds the composer lock is no longer dropped. The composer submits once the load commits. If the load rolls back, the outbox kept or already published the loaded post, so the request is dropped with the toast `Your recording is attached but wasn't posted.` and the take stays attached. Removing the take cancels a pending request. This closes the matching item under "Left open from the review". `MediaPreview`'s remove button gains `aria-label="Remove attachment"`.

Validation note: the implementing model's sandbox could not bind Vite's port, so it ran no browser tests. The full e2e suite was then run outside the sandbox (26 passed, 2026-10-12, and again after the review fixes) against a scratch Django on :8001 with its own database, using a settings shim that adds `localhost:5174` to `CORS_ALLOWED_ORIGINS`. Without that shim a local e2e run cannot reach Django at all: Playwright serves on 5174 outside CI, and settings only allow 5173.


Rebase onto `main` (2026-10-28, PRs 22 and 21):

- `finalizeRecording` delegates to main's `webmDuration.ts` resolver and best-effort repair. Both import shapes work; WebM and Matroska are repaired, and MP4 passes through. A repair failure logs its cause and keeps the original take. Processing-error tests inject a failure at the finalization boundary and retain their retry, no-handoff, and no-toast assertions.
- The normalize re-encode uses `assembleRecording` with the browser's supported audio MIME type, so an empty result still rejects. The WAV fallback and extension mapping remain.
- Dialog outside-press guards cover loading, recording, paused, finishing, and normalizing states. Main's idle/error dismissal remains available. The audio dialog keeps its extra timer/button spacing, and cancelling the iOS native camera closes the video dialog.
- Main's composer focus handling, toolbar wrapping, menu focus restoration, and keyboard clearance remain alongside recorder Post. Tests from both branches are retained; modal fakes now provide event-capable tracks and a secure context for capture pre-flight.
