# 03 — Frontend (React / TypeScript)

Findings for `app/src/` (excluding vendored `components/ui/`). Security items cross-referenced in [01-security.md](01-security.md), marked 🛡️. Severities: 🔴 high · 🟠 medium · 🟡 low.

---

## Post components

### components/post/Post.tsx
- 🔴 **`:32-44`** 🛡️ ✅ — `FormatText` sanitizes, then a regex re-injects the captured URL into raw anchor HTML rendered via `dangerouslySetInnerHTML`; the post-sanitize URL is not re-escaped. *Fix:* sanitize the final HTML.
- 🟠 **`:47-66`** — `Post` is not `React.memo`'d and recomputes `mediaUrl`/`mimeType`/`mediaDuration` every render; in a long feed this re-runs `getMediaUrl`/`getMimeTypeFromPath`/`parseDurationString` per post on any parent update. *Fix:* memoize.
- 🟠 **`:28-45`** — `FormatText` does sanitize+regex work every render with no memoization. *Fix:* `useMemo` on `children`.
- 🟡 **`:103`** — `<img alt={mediaAltText}>` may be `undefined` → no alt attribute. *Fix:* fallback `''`.
- 🟡 **`:7`** — Relative import `'../../types/post'` while the rest uses the `@/` alias.

### components/post/create/CreatePost.tsx
- 🔴 **(whole file, 359 lines)** — God component: 11 `useState`/`useRef`, five file handlers, a 70-line `handleSubmit`. *Fix:* extract a `useCreatePostMedia` hook + split submit.
- 🔴 **`:201-202`** — Silent catch: generic `toast.error('Failed to create post')`, never logs the real `error`. *Fix:* log it.
- 🔴 **`:50,124-131,140`** — Six mutually-exclusive media states (`audioBlob`/`videoBlob`/`audioFile`/`videoFile`/`imageFile` + `mediaType`); `hasNoMedia` and the submit guard re-derive the same 5-term boolean. *Fix:* one discriminated-union state.
- 🟠 **`:75-122`** — `handleAudioFileChange`/`handleUploadFileChange`/`handleImageFileChange` duplicate the same read/validate/set/toast pattern. *Fix:* one parametrized handler.
- 🟠 **`:56,153`** — Forged synthetic event `handleSubmit({ preventDefault(){} } as React.FormEvent)`. *Fix:* decouple submit from the event.
- 🟠 **`:340-352,250,260`** — Inline arrow/JSX callbacks recreated every render over a large subtree → avoidable modal re-renders. *Fix:* memoize handlers.
- 🟠 **`:288-301`** — `audioInputRef` is rendered but no button triggers it (the Upload button uses `uploadInputRef`); likely dead input/handler. *Verify and remove.*
- 🟡 **`:18,42`** — `useState<SubmitStatus | ''>` redundantly adds `| ''` (already in `SubmitStatus`).
- 🟡 **`:160,165,177`** — `recording_${Date.now()}` filename construction duplicated 3×.
- 🟡 **`:93-95`** — `// TODO: Detect audio vs video` — `.webm` is always treated as audio, mis-categorizing webm video.

### components/post/create/AudioRecorder.tsx
- 🔴 **`:144,148,160`** ✅ — `console.log` debug statements inside per-sample normalization loops, shipped to prod. *Fix:* remove.
- 🔴 **`:179-182`** — `normalizeAudio` swallows errors (only `console.error`, returns original blob); failures invisible to the user. *Fix:* surface.
- 🔴 **`:218-222`** — `useEffect([autoStart, status])` calls `startRecording()` when `status==='idle'`; after reset returns to idle it can auto-restart; `startRecording` not in deps (stale closure). *Fix:* one-shot ref.
- 🔴 **`:120-122`** 🛡️ — `new AudioContext()` never `close()`d → leaks contexts across recordings. *Fix:* close in `finally`.
- 🟠 **`:286-320,357`** — If unmounted mid-recording without `stopRecording`, `getUserMedia` tracks are never stopped (mic stays on). *Fix:* stop `stream` tracks in `reset` before nulling.
- 🟠 **`:363-368`** — `biome-ignore useExhaustiveDependencies` with no justification on unmount cleanup that closes over `audioURL` (may revoke a stale URL). *Fix:* ref.
- 🟠 **`:370-375`** — `useImperativeHandle` with no deps array; handle + callbacks recreated each render. *Fix:* `useCallback` + deps.
- 🟡 **`:57-61`** — `formatTime` duplicated (see VideoRecorder/MediaPlayer).
- 🟡 **`:147,299,327`** — Magic numbers `0.8` (peak), `500` (delays).
- 🟡 **`:18,201`** — `React.FC` vs the React-19 `ref`-prop style in the same file; inconsistent.

### components/post/create/VideoRecorder.tsx
- 🔴 **`:68-72`** — `useEffect([autoStart,isRecording,videoURL])` calls `startRecording()` (not in deps); can re-trigger after `reset()`. *Fix:* one-shot guard ref.
- 🔴 **`:105-117`** 🛡️ — `handleFileChange` creates an object URL stored in `videoURL`; picking a second file overwrites the first without `revokeObjectURL` → leak. *Fix:* revoke previous first.
- 🔴 **`:190-205`** — `onstop` async IIFE has no try/catch; if `fixWebmDuration` throws, cleanup at :201-203 never runs. *Fix:* try/catch.
- 🟠 **`:131-135`** — `stopTimer()` doesn't null `timerRef.current` (unlike AudioRecorder). *Fix:* reset the ref.
- 🟠 **`:172-174`** — `videoRef.current.play().catch(…)` only logs. *Fix:* decide handling.
- 🟠 **`:153-179`** — Magic bitrate `2500000`/`1000000` and resolution literals. *Fix:* named presets.
- 🟡 **`:43-47`** — `formatTime` duplicated.
- 🟡 **`:49-56,101-103`** — `forwardRef` (vs the `ref`-prop style elsewhere); `useImperativeHandle` with no deps array.

### components/post/create/MediaPreview.tsx
- 🔴 **`:38-75`** 🛡️ — Object-URL effect only returns cleanup inside `if (source)` branches; switching media types leaves stale URLs in state un-reset/un-revoked. *Fix:* reset on every branch transition.
- 🔴 **`:157-161`** — `document.querySelectorAll('audio')` to pause others reaches outside the React tree. *Fix:* coordinate via context/state.
- 🟠 **`:90-183`** — Reimplements a full audio player (play/pause/seek/progress/error-map/time-format) duplicating `MediaPlayer.tsx` almost verbatim. *Fix:* reuse `AudioPlayer`.
- 🟠 **`:95,106,165`** — Magic `0.1` duration buffer, `50`ms interval (duplicated from MediaPlayer).
- 🟡 **`:265-269`** — `<img alt={imageFile.name}>` uses a filename as alt text.

### components/post/MediaPlayer.tsx
- 🔴 **`:194-222,438-466`** 🛡️ — `loadAudio`/`loadVideo` `createObjectURL` but never `revokeObjectURL` (cleanup only `removeAttribute('src')`) → leak per play/reload. *Fix:* track & revoke.
- 🔴 **`:116`** — `width: ${(currentTime/duration)*100}%` is `NaN%` when `duration===0`. *Fix:* guard zero.
- 🔴 **`:298,517`** — `document.querySelectorAll('audio'|'video')` global pause hack (duplicated). *Fix:* centralize.
- 🟠 **`:9`** — `RefObject<HTMLAudioElement>` prop type vs callers' `useRef<… | null>(null)`; inaccurate type. *Fix:* `RefObject<… | null>`.
- 🟠 **`:282-324`** — Convoluted Firefox-autoplay workaround calling `loadAudio()` in two branches (its own TODO at :291). *Fix:* simplify.
- 🟠 **(whole file, 602 lines)** — `AudioControls`/`AudioPlayer`/`VideoPlayer` share massively duplicated `handleError` switches, blob-fetch `loadX`, reset effects, try-again buttons. *Fix:* shared media-loading hook.
- 🟠 **`:148,418`** — `biome-ignore useExhaustiveDependencies` omits `initialDuration`; duration won't reset if it changes alone.
- 🟡 **`:125-129,399-403`** — `mimeType` prop declared but never used (dead prop).
- 🟡 **`:17-21`** — `formatTime` here is `m:ss` while recorders use `mm:ss`; inconsistent + duplicated.
- 🟡 **`:251-262,311`** — `handleTimeUpdate` in a 50ms interval captures a stale `duration` closure.

### components/post/EditPostModal.tsx
- 🔴 **`:42-47`** — `useEffect([post])` mirrors all of `post` into local state; any new `post` object identity from a parent re-render resets in-progress edits. *Fix:* key by `post.id` (remount) or reset only on open.
- 🟠 **`:49-60`** — `handleSubmit` catches, `console.error`s, and swallows — no user-facing toast on save failure. *Fix:* error UI.
- 🟡 **`:63-70`** — `handleKeyDown` attached to both `<form>` and each input → fires twice (bubbles). *Fix:* attach once.

### components/post/PostActions.tsx
- 🟠 **`:43-48`** — `navigator.clipboard.writeText(body)` not awaited / no error handling; shows success toast even on rejection. *Fix:* await + catch.
- 🟡 **`:5`** — Imports `toast` from `'sonner'` directly vs the app's `'@/components/ui/sonner'` wrapper elsewhere.
- 🟡 **`:58-71`** — Duplicate likes spans (responsive split renders identical value); Comment/Share buttons are non-functional placeholders with magic `0`.

### components/post/PostHeader.tsx
- 🟠 **`:19-26`** — `handleCopyLink` success path is only a `// You could add a toast` comment — silent UX. *Fix:* toast.
- 🟡 **`:37-38`** — `first_name[0]`/`last_name[0]` throws/renders `undefined` on empty names.
- 🟡 **`:48-73`** — `DropdownMenu` nested inside `TooltipTrigger`/`Tooltip` — fragile composition / a11y-focus conflict.

### components/post/PostMenu.tsx
- 🟡 **`:33-34`** — `canDelete`/`canEdit` are the identical expression. *Fix:* one `canModify`.
- 🟡 **`:42-45`** — `handleConfirmDelete` doesn't await `onDelete`; dialog closes with no error feedback on failure.
- 🟡 **`:51-59`** — `handleDownload` re-derives filename inline (duplicated with Post.tsx:51) with no error handling.

### components/post/DeleteConfirmationDialog.tsx
- 🟡 **`:37-42`** — Hardcoded destructive styling inline instead of `variant="destructive"`; risks design-system drift.
- 🟡 **`:38`** — `onConfirm` doesn't close the dialog; closing is an implicit parent contract.

### Likely-dead create components
- 🟡 **`AudioPostTab.tsx`, `VideoPostTab.tsx`, `TextPostTab.tsx`** appear unreferenced by `CreatePost.tsx` (which uses the `*Modal` variants). They also carry the forged-event `onSubmit: (e: React.MouseEvent)` smell. *Verify usage, then remove.* `AudioPostTab.tsx:43-58` additionally busy-polls `getStatus()` via `setInterval(…, 100)` to bridge an imperative ref — replace with a completion callback if kept.

---

## App-level components & pages

### App.tsx / main.tsx
- 🟠 **`App.tsx:15`** — `new QueryClient()` with no `defaultOptions` (implicit cache/refetch defaults). *Fix:* explicit `defaultOptions`.
- 🟡 **`App.tsx:17-38`** — No error boundary; any render error blanks the whole app.
- 🟡 **`main.tsx:1-5`** — Not wrapped in `<StrictMode>` (would surface the effect bugs above); non-null `getElementById('root')!` with no fallback.

### components/Feed.tsx
- 🟠 **`:49-52`** — `handleLike` is a stub that only `console.log`s with a TODO. *Fix:* remove/implement.
- 🟠 **`:70-88`** — `handleEditPost` is `async` with try/catch but doesn't `await editPost(...)`; rejections escape and the success toast fires on failure. *Fix:* await.
- 🟡 **`:78-81`** — Dead `posts.find`/`throw` guard (immediately swallowed, `post` unused).
- 🟡 **`:41-47`** — `handlePostCreated` only `console.error`s — no user feedback (inconsistent with delete/edit).
- 🟡 **`:32-60`** — Only `handleAddFilters` is `useCallback`'d; other child handlers recreated each render, defeating `Post` memoization.
- 🟡 **`:104-105`** — Redundant inline wrapper `onMatchModeChange`; inline `.map()` array breaks referential stability.
- 🟡 **`:144-145`** — Magic spacer `<div className="h-96">`.
- 🟡 **`:44,64,84`** — Catch `error` shadows the outer `usePosts` `error`.

### components/feed/FilterControls.tsx
- 🔴 **`:57-71`** ✅ — Event-listener leak: `addEventListener` and `removeEventListener` use **different** anonymous functions, so the `keyup` listener is never removed; also queries the DOM by id. *Fix:* one stored handler ref + a React `ref`.
- 🟠 **`:58`** — `document.getElementById(...) as HTMLInputElement` reaches into the DOM and casts (may not exist on first run). *Fix:* `useRef`.
- 🟠 **`:79`** — Magic `setTimeout(resolve, 300)` to "wait for scroll" — brittle timing hack.
- 🟡 **`:42-55,73-80`** — Mixed derived-state-in-ref with effect deps; `async` early-return.

### components/feed/TagFilterPopover.tsx
- 🟠 **`:151-161`** — `onOpenChange` runs a floating async IIFE (unhandled rejection; state updates after `await` with no unmount guard). *Fix:* proper async handler.
- 🟠 **`:101-109`** — Convoluted early-return submit condition. *Fix:* simplify/comment.
- 🟡 **`:178-180` vs `:127-146`** — Trigger count uses raw `selectedTags.length` while the body uses normalized tags; counts disagree on dupes.
- 🟡 **`:186,217`** — Scattered magic width/height strings.
- 🟡 **(whole, ~290 lines)** — Oversized; mixes fetching, normalization, pending state, dual mobile/desktop render. *Fix:* split.

### components/feed/ActiveFiltersList.tsx
- 🟡 **`:43,56`** — Inline arrows per chip per render. *Fix:* extract `FilterChip`.
- 🟡 **`:36-70`** — Absolute-positioned remove button coupled to magic padding/size values.

### components/GroundRulesModal.tsx
- 🟠 **`:16-21`** — `React.ReactNode` used but `React` not imported (relies on global types; fragile under `isolatedModules`). *Fix:* import the type.
- 🟠 **`:85`** — `onOpenChange={setIsOpen}` lets the user dismiss the "mandatory" rules without accepting. *Fix:* prevent close until accepted.
- 🟡 **`:56-75`** — Acceptance stored as a serialized array but only existence is read back (dead data); `localStorage` access without try/catch.
- 🟡 **`:103-128`** — Hardcoded `bg-gray-*`/`bg-green-600`/`text-red-500` bypass theme tokens; "I Accept" only *looks* disabled (no real `disabled`/`aria-disabled`).

### components/LoginModal.tsx & SignupModal.tsx
- 🟠 **`LoginModal:50`** — `await response.json()` on the error path with no try/catch (non-JSON 500 throws, masking the real failure). *Fix:* guard the parse.
- 🟠 **`SignupModal:60-71`** — Field errors are recovered by `JSON.parse(error.message)` — encoding structured errors inside an `Error.message` string is an anti-pattern. *Fix:* throw typed errors from the API client.
- 🟡 **Both** — Near-duplicate dialog scaffold, mobile-autofocus workaround (with a redundant `if (isMobile){…return}`), and error-to-form mapping. *Fix:* shared `AuthModal`. Untyped (`any`) parsed error payloads indexed as `errors.form[0]`. No client-side `password1===password2` check.

### components/Navbar.tsx
- 🟠 **`:58,123`** — Hardcoded GitHub URL duplicated in two places. *Fix:* a constant.
- 🟡 **`:42-172`** — Desktop nav and mobile dropdown duplicate the entire nav-item list. *Fix:* drive both from one config array.
- 🟡 **`:35`** — App name `"EchoSphere"` hardcoded (vs "webframework" elsewhere); no single source of truth.
- 🟡 **`:151,162`** — `text-black dark:text-white` literals bypass theme tokens.
- 🟡 **`:21-28`** — `handleLogout` swallows errors (only `console.error`).

### components/Profile.tsx
- 🔴 **`:14-60`** — Entire profile is hardcoded mock data ("John Doe", "248 Following", external sample media, `username='user1'`) shipping to `/profile` with no real data source. *Fix:* wire to API or gate behind a flag.
- 🟠 **`:15-60`** — The `posts` array and `new Date(Date.now()-…)` rebuild every render → "days ago" drifts, breaks memo stability. *Fix:* move out / `useMemo`.
- 🟠 **`:62-70`** — `handleLike`/`handleDelete` are `console.log` stubs.
- 🟡 **`:83,118-122`** — `username[0]` latent crash on empty string; `<Link to="#">` dead nav; hardcoded external URLs.

### components/PullToRefresh.tsx
- 🟠 **`:32-118`** — Touch-listener effect depends on `onRefresh`; an inline parent callback tears down/re-adds all four listeners every render. *Fix:* memoize/ref the callback.
- 🟡 **`:90-94`** — Default refresh does a full `window.location.reload()` (loses SPA state). *Fix:* prefer query invalidation.
- 🟡 **`:78,123-160`** — Imperative DOM style/class mutation; `transitionend` `once` listener can stack; magic numbers.

### components/settings/SettingsPage.tsx
- 🟠 **`:13-15`** — `useEffect` persists settings on every change **including initial mount**, writing just-read defaults back. *Fix:* skip initial write or persist in the change handlers.
- 🟠 **`:10-11`** — `getSettings()` called twice to seed two `useState` initializers (reads storage twice). *Fix:* single lazy init.
- 🟡 **`:57`** — `value as 'low' | 'high'` casts an untyped `RadioGroup` string.
- 🟡 **`:9-83`** — Local state mirrors persisted settings instead of deriving from one source. *Fix:* a `useSettings` hook.

### components/ThemeProvider.tsx
- 🟠 **`:65-71`** — `useTheme`'s `if (context === undefined)` guard can **never** fire because the context default is non-undefined; using it outside a provider silently returns the no-op default. *Fix:* default the context to `undefined`.
- 🟠 **`:33-47`** — System-theme effect reads `matchMedia` once but never subscribes to `change`; OS theme switches at runtime don't update. *Fix:* add a change listener + cleanup.
- 🟡 **`:49-55`** — `value` object recreated every render → all consumers re-render. *Fix:* `useMemo`.
- 🟡 **`:29-31,51`** — `localStorage.getItem(...) as Theme` unvalidated; inner `setTheme` shadows the state setter.

### components/ThemeToggle.tsx
- 🟡 **`:25-39`** — Three near-identical `DropdownMenuItem`s; could be data-driven.

### pages/
- 🟠 **`DebugPage.tsx:5`** 🛡️ — `MediaRecorder.isTypeSupported` called at render with no guard for environments where `MediaRecorder` is undefined → throws/blanks the page; the `/debug` route also ships to prod.
- 🟠 **`NotFound.tsx:8`** — `console.error('404 Error: …')` on every 404 render spams prod consoles for normal mistyped URLs. *Fix:* remove.
- 🟡 **`NotFound.tsx:12-19`** — Raw `<a href="/">` (full reload) instead of `<Link>`; hardcoded `bg-gray-*`/`text-blue-500` won't respect dark mode.
- 🟡 **`ProfilePage.tsx:1-17`** — Duplicates the page shell found in `Index.tsx`/`SettingsPage.tsx` (3 copies). *Fix:* a shared `PageLayout`.
- ✅ **`Index.tsx`** — Clean.

---

## Hooks

### hooks/useAuth.tsx
- 🔴 **`:42,51,28`** — `checkAuthStatus` depends on `authState.isAuthenticated`, so its identity changes on every auth flip and the `useEffect([checkAuthStatus])` re-fetches each change (risk of an extra round-trip/loop). *Fix:* functional `setAuthState(prev => …)`, drop the dep.
- 🟠 **`:30`** 🛡️ — `/auth/status/` fetch omits `credentials: 'include'`. *Fix:* add it.
- 🟠 **`:32,48-50`** — `data` from `response.json()` is implicit `any`; on error the state is left stale with only a log. *Fix:* type it; reset/expose error.
- 🟡 **`:19`** — `React.FC` typing without importing `React`.

### hooks/usePosts.ts
- 🔴 **`:52-73`** — Create/edit/delete patch the cache via `updatePostsCache` but never `invalidateQueries`; the client diverges from server-computed fields. *Fix:* invalidate or use returned authoritative data.
- 🟠 **`:44-50`** — Writes the tags cache from a `useEffect` via `setQueryData` — writing one query from another's render side-effect; races with `useTags`. *Fix:* `select`/derived query.
- 🟠 **`:52-73`** — No `onError`/rollback on any mutation; errors aren't returned (only `isMutating`). *Fix:* error handling/state.
- 🟡 **`:82-93,21-30`** — Unmemoized thin async wrappers; inconsistent return (`addPost` returns post, `editPost` discards); redundant `[...prev]` copy.

### hooks/useTags.ts
- 🟠 **`:18-31`** — `useTags` (`queryFn`+`ensureQueryData`) and `usePosts` (`setQueryData` in an effect) both own `POST_TAGS_QUERY_KEY` and race depending on mount order. *Fix:* one owner.
- 🟡 **`:30`** — `staleTime: 1000*60` duplicated with `usePosts.ts:41`.

### hooks/usePostFilters.ts
- 🟠 **`:42-56`** — Lower-cases every searched field per filter per post inside nested loops → O(posts×filters×fields) allocations. *Fix:* precompute lowercased fields once.
- 🟡 **`:60,118-119,136`** — `Map` used only for `.has()` (use a `Set`); tag-detection `startsWith('#')` duplicated; raw vs normalized token equality inconsistent.

### hooks/use-toast.ts
- 🔴 **`:6`** — `TOAST_REMOVE_DELAY = 1000000` (~16.7 min) → dismissed toasts are effectively never removed from memory. *Fix:* a realistic value.
- 🟠 **`:23,125-127`** — Module-level mutable singleton state (untestable, leaks across renders).
- 🟡 **`:15-21,138,170-178`** — `actionTypes` object only used as a type (dead runtime + an eslint-disable); pointless rest-spread; O(n) listener cleanup.

### hooks/use-mobile.tsx
- 🟡 **`:9-14,6-18`** — Breakpoint duplicated (`max-width:767px` vs `innerWidth<768`); `boolean|undefined` coerced with `!!`, hiding the "unmeasured" state.

---

## API client & lib utils

### lib/utils/fetch.ts
- 🔴 **`:38-68`** 🛡️ — No `credentials: 'include'` anywhere; session/CSRF break cross-origin. *Fix:* add it.
- 🔴 **`:25-34`** 🛡️ — `getCsrfToken` doesn't check `response.ok` and reads untyped `data.token`; caches `undefined` for an hour on failure. *Fix:* validate + refresh on 403.
- 🟠 **`:9,29`** — Module-global `csrfTokenCache` with a hardcoded 1-hour TTL that may exceed server token lifetime → stale-token 403s. *Fix:* configurable TTL + 403 refresh.
- 🟡 **`:64`** — `body as BodyInit` cast hides the union narrowing.

### lib/api/posts.ts
- 🔴 **`:46,58-61,115-121`** 🛡️ — Several `fetch`es bypass `getFetchOptions`/`credentials` and lack `response.ok` checks; the presign GET blindly `.json()`s and the S3 `PUT` isn't checked — a failed upload still proceeds to create the post. *Fix:* status checks everywhere.
- 🔴 **`:13,36-42`** — `signedUrlCache` is an unbounded module-level `Map` (a second hidden cache that desyncs from TanStack Query). *Fix:* bound it or drop it.
- 🟠 **`:199-208`** — `updatePost` returns `modified: new Date(...)` but `createPost`/`getPosts`/`transcribePost` don't, so `Post.modified` is sometimes a `Date`, sometimes a string — violates the declared type. *Fix:* normalize on every path.
- 🟠 **`:124,131`** — Magic default `media_type: 'audio'` in two branches silently mislabels video/image. *Fix:* derive correctly.
- 🟠 **`:201`** — `Object.fromEntries(Object.entries(data))` is a no-op clone. *Fix:* remove.
- 🟡 **`:50-55,73,93-99,160-162`** — DOM coupling via `window.location.origin`; untyped `as { url: string }` cast; commented-out debug/Safari dead code.

### lib/utils/audio.ts
- 🔴 **`:47-54`** — Re-encoding via `MediaRecorder` + `setTimeout(duration*1000 + 100)` is real-time (takes as long as the clip) and truncates the tail if the buffer hasn't flushed. *Fix:* encode the decoded buffer directly.
- 🟠 **`:10-15,28-43,51`** — `AudioContext` leaks if `decodeAudioData` rejects before the timeout; `MediaRecorder` has no `onerror` → the Promise can hang forever. *Fix:* close in `finally`, add `onerror`.
- 🟡 **`:67-75,121`** — Hard-to-read nested ternary; implicit `any[]`.

### lib/utils/media.ts
- 🔴 **`:30,46`** 🛡️ — Module-level `console.log` + `MediaRecorder.isTypeSupported` run at **import time**, throwing in non-browser/test/SSR. *Fix:* lazy functions; drop logs.
- 🟠 **`:29,45`** — `supportedVideoMimeType`/`supportedAudioMimeType` computed once at import and can be `undefined` with no fallback. *Fix:* lazy + handle empty.
- 🟡 **`:54-87,47`** — Dead defensive try/catch around non-throwing parse; possibly-unused `mimeTypes` export.

### lib/utils/browser.ts
- 🟠 **`:43-52`** — `isSafari` via `userAgentData` returns true for any macOS non-Chrome browser (Firefox-on-Mac misreported). *Fix:* feature detection / UA fallback.
- 🟡 **`:36`** — `/Macintosh/ && /iPad/` can never both be true (dead condition); pervasive brittle UA sniffing.

### lib/utils/file.ts
- 🟠 **`:6-18`** — `getFileExtension`'s `URL`-parse and fallback paths don't compose; a successful parse with no dot throws instead of using the fallback. *Fix:* one path-based parse.
- 🟡 **`:17,30-46`** — Throwing on "no extension" forces callers into try/catch for a common case; ogg/webm MIME guesses may mislabel.

### lib/utils/ui.ts
- 🔴 **`:10`** — `document.getElementsByTagName('header')[0].clientHeight` throws if no `<header>` exists (no null check despite guarding `window`/`element` above). *Fix:* guard the lookup.
- 🟡 **`:10`** — Magic `+ 16` header offset.

### lib/utils/settings.ts
- 🟠 **`:21-29`** — `getSettings` returns `JSON.parse(stored) as AppSettings` with no validation/merge; an older stored schema yields `undefined` for new keys. *Fix:* `{ ...defaultSettings, ...parsed }`.
- 🟡 **`:11-19`** — Default `normalizeAudio` frozen at import via UA sniffing.

### lib/constants.ts & utils/tags.ts & types/
- 🟡 **`constants.ts:1-5`** — `import.meta.env.VITE_*` cast `as string` with no validation; missing host silently becomes `''`.
- 🟡 **`utils/tags.ts:4,38-41`** — `HASHTAG_REGEX` excludes Unicode/emoji/hyphen tags (silently drops valid tags); display casing vs case-insensitive counting inconsistency. Also: two `utils` dirs (`src/utils` and `src/lib/utils`) — confusing structure.
- 🟠 **`types/post.ts:26,32`** — `head`/`likes`/`Author.avatar` are required but carry `// TODO: Implement`; consumers handle values the backend may not populate. *Fix:* mark optional until implemented.
- 🟡 **`types/post.ts:19-35`** — `created`/`modified` typed `Date` but the API returns ISO strings (only some paths convert); `signedMediaUrl` (client-injected) mixed into the server type — forces `as` casts. *Fix:* separate API DTO vs domain type.

### lib/api/auth.ts
- 🟠 **`:13-39`** — try/catch only `console.error`s then re-throws (double-logging, no recovery). *Fix:* enrich or drop.
- 🟡 **`:18-19`** — Throws `JSON.stringify(errors)` as an `Error` message, forcing callers to `JSON.parse` it. *Fix:* typed error object. No `login` here despite the split module boundary.
