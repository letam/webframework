# Offline posts — implementation spec

Status: complete 2026-08-20 — all four phases plus a post-review hardening round landed
on `feature/offline-posts`. Pipeline: fable-5 spec → gpt-5.6-sol implementation per
phase → fable-5 review. This is stage 2 of the "Offline / local-first" item in
`docs/feature-backlog.md` (queue posts in IndexedDB, sync on reconnect); stage 1 (service
worker / PWA shell) is explicitly not a prerequisite and stays out of scope.

Composing a post while offline currently fails with a generic "Failed to create post"
toast and the words sit in the composer until the user notices. This feature adds an
**outbox**: posts composed offline are queued on the device and sent automatically when
the connection returns, with the sync state always visible. A later phase turns the same
machinery into a local-first mode — a toggle that holds every new post on the device
until the user explicitly sends it — and a Settings option that picks the default for
that toggle.

Built in four phases, one commit each (plus a backend commit in phase 1). Each phase
lands with its tests and passes all gates before the next begins.

1. **Phase 1** — text-only offline posting: backend idempotency key, outbox storage +
   sync engine, composer offline branch, queued-post cards above the feed, navbar sync
   indicator.
2. **Phase 2** — media posts offline (audio/video/image blobs in the outbox, both upload
   paths at sync time).
3. **Phase 3** — auto-sync toggle in the composer (local-first mode), per-card
   "Post now", "Post all", edit-back-into-composer.
4. **Phase 4** — Settings default for the toggle: always on / always off / remember last.

## Vocabulary

"Draft" is already double-booked in this codebase: server-side draft posts
(`is_draft`, the Drafts tab) and the composer autosave ("Save unfinished posts",
"Restored your unsaved draft"). The offline queue must not add a third meaning, so:

- **Outbox** — the IndexedDB store of posts waiting to leave the device. Code-level
  term (`outbox.ts`, `OutboxEntry`); never appears in UI copy.
- **Queued** (UI) — an outbox entry waiting for a connection while auto-sync is on.
- **On this device** (UI) — an outbox entry held locally because auto-sync is off.
- **Sync** — the act of sending outbox entries to the server. A synced draft post is
  *not* "live", so batch toasts say "Synced", not "Posted".
- An outbox entry may itself be a draft (`isDraft: true`): it syncs into the Drafts tab.

## Design decisions (pinned)

These were weighed deliberately; do not re-litigate them during implementation.

- **Separate IndexedDB database** `post-outbox` (object store `entries`, keyPath `id`),
  not a second store inside `composer-drafts`. The autosave DB's versionless-open +
  self-repair logic (`composerDraft.ts`, commit b785a68) is deliberate and battle-tested;
  extending its upgrade path risks the most sensitive shared surface for zero user
  benefit. The outbox DB copies the same idioms (versionless open, one-shot repair bump,
  degrade-to-no-op reads) with one deliberate difference: **enqueue must report
  failure** (return `false` / throw) rather than silently no-op — if the device can't
  store the post, the composer must keep the content and say so. Autosave may lose a
  best-effort snapshot silently; the outbox holds the only copy of the post.
- **Queued posts render as their own cards above the feed, not injected into the
  TanStack Query cache.** Fake ids would collide with server posts (`prependUniquePost`
  dedupes by numeric `post.id`), corrupt every `setQueriesData` cache surgery
  (`isPostsQueryKey` matches on shape), trip per-card side effects (view tracking,
  transcription polling), and pollute the tags-cache rebuild. A dedicated `OutboxList`
  between the composer and the filter row keeps server truth and local state cleanly
  apart. Feed filters and keyboard navigation deliberately skip outbox cards.
- **Hybrid submit path.** Online submits are unchanged (spinner in composer, content
  kept on failure). The outbox engages only when (a) `navigator.onLine` is false at
  submit, (b) the online submit fails with a network-level `TypeError`, or (c) phase 3's
  local mode is on. HTTP failures with a reachable server (400/5xx on a live submit)
  keep today's behavior. This preserves the existing UX exactly and avoids fighting the
  zero-config QueryClient (`networkMode: 'online'` pauses offline mutations silently —
  the outbox path never goes through `useMutation`).
- **Idempotency via `client_uuid`.** Every outbox entry's `id` (`crypto.randomUUID()`)
  is sent as `client_uuid` on create. The server stores it on `Post` with a conditional
  per-author unique constraint and returns the existing post (200) on replay. This makes
  crash recovery (`sending` entries found at load revert to `queued` and are re-sent)
  and multi-tab double-flushes harmless.
- **`created` is sync time, not compose time.** The codebase already treats `created`
  as publication time (publish deliberately bumps it). The queued card shows the local
  compose time; the server post timestamps when it actually lands. Documented, accepted.
- **Sequential FIFO flush.** Entries send one at a time, oldest first, preserving the
  order the user wrote them and avoiding throttle bursts (anon 300/h, presign 30/h/IP).
- **Auth is a first-class problem.** `/auth/status/` fails when offline, so
  `isAuthenticated: false, userId: null` can mean "anonymous" *or* "unknown". `useAuth`
  gains an `isAuthResolved: boolean` (false until the first `response.ok` status
  fetch). Entries record who composed them (`author: number | 'anon' | 'unknown'`) and
  both display and flush are gated on that — a queued post from user A must never be
  shown to, or posted as, user B (same bug class as autosave commits e3e5dcf/e4fa6c2).
- **Compose-time settings snapshot.** `link_previews_enabled` and auto-transcribe
  intent are captured at enqueue (mirroring what `handleAddPost` would have done at
  submit time), not re-read at sync — the post behaves as it would have when written.
- **Phase 3's toggle is a live app mode, not a per-entry property.** `syncMode:
  'auto' | 'local'`. While `local`, nothing auto-flushes and new entries show
  "On this device"; flipping to `auto` releases the whole queue. Per-entry "Post now"
  works in either mode. Phase 4's setting only decides the mode's value at app start.

## Backend (phase 1, own commit)

### Model + migration 0026

`server/apps/blogs/models.py`, on `Post`:

```python
client_uuid = models.UUIDField(null=True, blank=True, default=None, editable=False)
```

Constraint alongside the existing `unique_nonempty_s3_file_key` precedent
(models.py:74-82):

```python
models.UniqueConstraint(
    fields=["author", "client_uuid"],
    condition=Q(client_uuid__isnull=False),
    name="unique_author_client_uuid",
)
```

Per-author scope: all anonymous posts share one author row, so anon replays dedupe among
themselves; UUID collisions across users are not a real risk, but scoping keeps one
user's uuid from blocking another's. Works on both SQLite and Postgres (house precedent).

### Serializer + view

- `PostCreateSerializer`: add `client_uuid` (write; `UUIDField(required=False,
  allow_null=True)` semantics via the model field). Do **not** add it to the read
  serializer — the client never needs it back and it stays private metadata.
- `PostViewSet.create` (views.py): after the auth gate resolves the author (anonymous
  user looked up by username, or `request.user`) and **before** `_validate_media_payload`
  (an s3 replay would otherwise 400 with "already attached" before dedupe can win):
  if `client_uuid` is present and a `Post` with `(author, client_uuid)` exists, return
  it serialized with **200** (a fresh create keeps 201). Also wrap the create in
  `IntegrityError` handling: on the unique-constraint race, re-fetch and return 200.
- Anonymous creates may carry `client_uuid`; all other anonymous gates are unchanged
  (public + published only, else 401).

### Backend tests (`server/apps/blogs/tests/`)

- Create with `client_uuid` stores it; response is 201.
- Replay with same uuid + same author returns 200, the same post id, and creates no
  second row — including the s3_file_key variant (replay must not 400).
- Same uuid, different authors → two posts.
- Anonymous replay dedupes.
- Invalid uuid string → 400.
- Without `client_uuid`, two identical creates still make two posts (no accidental
  dedupe).

## Frontend architecture

### New files

| File | Contents |
| --- | --- |
| `app/src/lib/utils/outboxDb.ts` | `OutboxEntry` type, IndexedDB CRUD, load-time recovery. Mirrors `composerDraft.ts` idioms. No React. |
| `app/src/lib/outbox.ts` | Singleton reactive store + sync engine: subscribe/snapshot, enqueue, flush, retry, remove, sync mode (phase 3). No React; deps injected. |
| `app/src/lib/api/errors.ts` | `export class ApiError extends Error { constructor(message: string, public status: number) }` |
| `app/src/hooks/useOutbox.ts` | `useSyncExternalStore` over the outbox store; also exports the display-filter helper. Hook only — no components (react-refresh lint). |
| `app/src/hooks/useOnlineStatus.ts` | `useSyncExternalStore` over `online`/`offline` events + `navigator.onLine`. |
| `app/src/components/OutboxProvider.tsx` | Component only. Wires window listeners, auth context, and `useQueryClient` into the engine; renders `children`. Mounted in `App.tsx` inside the auth + query providers. |
| `app/src/components/feed/OutboxList.tsx` | The strip: visible entries newest-first, phase 3 header row. |
| `app/src/components/post/OutboxCard.tsx` | One queued post card. |
| `app/src/components/SyncStatusIndicator.tsx` | Navbar pill. |

### Modified files

`useAuth.tsx` (`isAuthResolved`), `CreatePost.tsx` (offline branch; phase 3 toggle),
`Feed.tsx` (mount `OutboxList`), `Navbar.tsx` (indicator in the right cluster, before
`<ThemeToggle/>`), `App.tsx` (provider), `posts.ts` (`client_uuid` param, `ApiError`),
`usePosts.ts` (extract `applyCreatedPostToCaches`), `types/post.ts`
(`client_uuid?: string` on `CreatePostRequest`), `settings.ts` + `SettingsPage.tsx`
(phase 4).

### `OutboxEntry`

```ts
export type OutboxAuthor = number | 'anon' | 'unknown'
export type OutboxStatus = 'queued' | 'sending' | 'failed'

export interface OutboxEntry {
	id: string // crypto.randomUUID(); doubles as the server client_uuid
	createdAt: number // Date.now() at enqueue; shown on the card
	author: OutboxAuthor
	status: OutboxStatus
	attempts: number // consecutive server-side failures; network failures don't count
	lastError: string | null // user-facing reason line when status === 'failed'
	text: string
	visibility: PostVisibility | null // null → omit from the request
	isDraft: boolean
	linkPreviewsEnabled: boolean // snapshot of settings.linkPreviews at enqueue
	autoTranscribe: boolean // snapshot of settings.autoTranscribe && isAuthenticated
	mediaType: 'audio' | 'video' | 'image' | null // null → text post
	media: Blob | null // phase 2; already-converted final bytes
	mediaName: string | null
}
```

`author` at enqueue: `userId` when authenticated; `'anon'` when `isAuthResolved` and
not authenticated; `'unknown'` when auth never resolved (offline app start). An
`'unknown'` entry was composed by whoever holds the device's session, so it syncs as
whatever the session resolves to once we're back online.

### Display and flush predicates

- Visible (and countable in the indicator) when: authenticated → `author === userId ||
  author === 'unknown'`; unauthenticated → `author === 'anon' || author === 'unknown'`.
- Flush-eligible: visible **and** the session identity is verified. `refreshAuthStatus()`
  returns whether it succeeded, and the engine reads auth through a snapshot getter that
  `useAuth` updates synchronously when the status response lands — *before* React commits
  the new state — so a pass that runs right after a refresh resolves gates on the fresh
  identity, not the previous render's. The `online` event marks the identity stale
  (`authRefreshNeeded`); the next pass (and any backoff retry) must complete a successful
  refresh before anything is sent. Other triggers refresh only when `isAuthResolved` is
  still false. A pass that cannot verify identity sends nothing and schedules a backoff
  retry. A login or logout (identity change with `isAuthResolved` already true) triggers
  a flush pass of its own, since it changes which entries are visible.

### Sync engine (in `lib/outbox.ts`)

Module singleton, same shape as `viewTracking.ts`. The provider injects dependencies
once on mount (`queryClient`, getters for auth state, `refreshAuthStatus`) and keeps
them fresh via a ref-style setter. Public API (exact names matter for tests):

```ts
subscribeOutbox(cb: () => void): () => void
getOutboxSnapshot(): { entries: OutboxEntry[]; flushing: boolean; syncMode: SyncMode }
loadOutbox(): Promise<void> // reads IDB, repairs 'sending' → 'queued', notifies
enqueuePost(input: EnqueueInput): Promise<boolean> // false = storage failed
flushOutbox(): Promise<void> // full eligible pass, FIFO; latched if a pass is running
flushEntry(id: string): Promise<void> // manual per-entry send, ignores syncMode
retryEntry(id: string): Promise<void> // failed → queued (attempts reset), then flushEntry
removeEntry(id: string): Promise<'removed' | 'sending'> // refuses while the send is in flight
```

A flush request that arrives while a pass holds the lock (manual retry, the backoff
timer, an enqueue) is never dropped: its ids are latched and the still-queued ones are
replayed when the running pass ends.

Flush pass, per entry (oldest `createdAt` first, strictly sequential):

1. Mark `sending` (memory + IDB).
2. Build `CreatePostRequest`: `text`, `client_uuid: entry.id`, `visibility` only when
   non-null, `is_draft` from `isDraft`, `link_previews_enabled` from the snapshot,
   media reconstructed as `new File([entry.media], entry.mediaName, { type:
   entry.media.type })` when present (phase 2). Call `createPost` directly (not
   `useMutation`).
3. **Success (200 or 201)**: delete the entry, then `applyCreatedPostToCaches(
   queryClient, post)` — the extracted body of `addPostMutation.onSuccess` in
   `usePosts.ts` (scope-aware prepend + tags-cache rebuild), exported as a module-level
   function taking `queryClient` and reused by the mutation itself. If
   `entry.autoTranscribe` and the entry has audio/video media and the current session is
   authenticated, fire `transcribePost(post.id)` and on failure show the existing
   'Failed to start transcription' toast copy used by `usePostHandlers`.
4. **Failure taxonomy**:
   - `TypeError` (network): back to `queued`, `attempts` unchanged, abort the pass,
     schedule a retry (below).
   - `ApiError` 403: `clearCsrfTokenCache()` and retry this entry once immediately; a
     second 403 → `failed`, `lastError: "Couldn't post this. Try again."`.
   - `ApiError` 401: `failed`, `lastError: 'Sign in to post this.'`.
   - Other `ApiError` < 500 (400/404/413…): `failed`,
     `lastError: 'The server rejected this post.'`.
   - `ApiError` 429/5xx: `attempts + 1`; under 5 → back to `queued` and continue the
     pass with the next entry; at 5 → `failed`,
     `lastError: 'The server had trouble with this post. Try again in a bit.'`.
5. After the pass: one batch toast if anything synced — `'Synced 1 queued post.'` /
   `` `Synced ${n} queued posts.` ``. If anything newly failed:
   `toast.error('A queued post couldn't be sent. It's still on this device.')` (once
   per pass, not per entry).

Triggers: provider mount after `loadOutbox()` resolves; the window `online` event
(mark identity stale, then flush — the pass performs the refresh); `isAuthResolved`
flipping true; any identity change (login/logout); after `enqueuePost` when
online (covers the TypeError-fallback case where the connection blips back); manual
retry/flush calls; phase 3's mode flip to `auto`. Backoff for network-failed passes
while `navigator.onLine` claims true — including a pass aborted because the identity
check itself failed: 15s → 30s → 60s → 120s → 300s cap, reset by
success, a real `online` event, or a manual action. When `navigator.onLine` is false,
no timer — wait for the event. Recovery: `loadOutbox` reverts any `sending` entry to
`queued` (the create may have landed; `client_uuid` makes the re-send safe).

Multi-tab: each tab holds its own in-memory mirror; concurrent flushes are safe
(server dedupe + idempotent delete), stale mirrors self-heal on their next flush
attempt. Accepted v1 limitation, noted in Non-goals.

### `ApiError` plumbing (`posts.ts`)

`createPost`'s failure paths currently throw bare `Error`s with the status discarded.
Change only the create pipeline: presign failure, S3 PUT failure, and the final POST
throw `ApiError` with the **same messages as today** (existing tests assert messages)
plus the status. `client_uuid`, when present on `CreatePostRequest`, is appended to the
FormData in both the direct and S3 branches. Everything else in `posts.ts` is untouched.

## Phase 1 — text-only offline posting

### Composer (`CreatePost.tsx`)

In `submitPost`, before the network path:

- If `!navigator.onLine`: skip the doomed request. If media is attached, show
  `toast.error("You're offline — media posts can't be queued yet.")` and keep state
  (temporary guard, lifted in phase 2). Otherwise enqueue.
- Online path unchanged. In its catch: `error instanceof TypeError` → same enqueue
  branch (media guard included). Any other error keeps today's behavior.

Enqueue branch: build the entry from composer state + settings snapshot + auth
(`author` per the rules above; `visibility` only when authenticated, mirroring the
current request-building), `await enqueuePost(...)`. On `true`: reset the composer,
`clearStoredDraft()`, `toast("Queued — will post when you're back online.")` (for
`isDraft` entries: `toast('Queued — will save to drafts when you're back online.')`).
On `false`: keep state, `toast.error("Couldn't save this post on this device.")`.

The Draft button gets the same treatment (it funnels through `submitPost(true)`).

### Outbox strip (`OutboxList` in `Feed.tsx`)

Rendered between `<CreatePost/>` and the filter controls; nothing when no visible
entries. Cards newest-first, `animate-rise-in` entrance. Each `OutboxCard`:

- Same visual shell as a feed post (bg-card, border, rounded) but slightly muted; not
  part of feed keyboard navigation.
- Author line mirrors the feed: avatar + username when authenticated, the feed's
  anonymous presentation otherwise. Relative compose time from `createdAt`.
- Post text styled like a post body (`whitespace-pre-wrap`).
- Status chip in the `PostHeader` "Draft"-pill idiom (rounded-full border px-1.5
  py-0.5 text-[11px] text-muted-foreground): `Queued` / `Posting…` / `Couldn't post`
  (destructive-tinted) — plus the existing `Draft` pill when `isDraft`.
- `status === 'failed'`: reason line (`lastError`) + a ghost `Retry` button.
- Always: a `Remove` action. Removing discards the only copy, so confirm with the same
  `AlertDialog` pattern the post-delete menu uses; dialog copy:
  title `Remove queued post?`, body `It hasn't been posted and will be gone from this
  device.`, confirm `Remove`. Toast after: `Removed.`

### Navbar sync indicator (`SyncStatusIndicator`)

Compact, non-interactive pill in the Navbar right cluster (before `<ThemeToggle/>`),
lucide 16px icons, chip idiom, `aria-label` = tooltip text. Rendered on all pages that
render Navbar. Counts use the visible-entry predicate. States, first match wins:

| State | Visual | Tooltip / aria-label |
| --- | --- | --- |
| Offline, n > 0 | `WifiOff` + count | `You're offline — 1 post queued. It'll go out when you're back online.` / `` `You're offline — ${n} posts queued. They'll go out when you're back online.` `` |
| Offline, none | `WifiOff` | `You're offline. New posts will be queued on this device.` |
| Flushing | `Loader2` spin + count | `Sending queued posts…` |
| Any failed | `TriangleAlert` + failed count | `Some queued posts couldn't be sent.` |
| Online, n > 0 (pre-flush lull) | `Cloud` + count | `` `${n} queued.` `` |
| Idle, empty | hidden | — |

Phase 3 adds a local-mode row (below). Singular/plural strings are built explicitly —
no `(s)`.

### Phase 1 frontend tests

- `outboxDb.test.ts` (fake-indexeddb idioms from `composerDraft.test.ts`: `import
  'fake-indexeddb/auto'` first, fresh `IDBFactory` per test, `vi.spyOn(Date, 'now')`,
  never fake timers): CRUD round-trip, `sending` → `queued` recovery, enqueue returns
  false when IDB is unavailable, list sorted by `createdAt`.
- `outbox.test.ts` (mock `createPost`/`transcribePost`, inject a real `QueryClient`):
  success removes + prepends via `applyCreatedPostToCaches`; TypeError → still
  `queued`, pass aborted; 401/400 → `failed` with pinned copy; 403 → CSRF cache
  cleared + one retry; 5 consecutive 5xx → `failed`; author gating (user A's entries
  don't flush as user B; `anon` doesn't flush while authenticated; `unknown` flushes as
  whoever resolved); FIFO order; batch toast counts.
- `CreatePost` tests: offline submit enqueues + clears composer + toast; offline with
  media keeps state + guard toast; online submit path untouched; TypeError fallback
  enqueues.
- `OutboxCard` / `OutboxList` render states + retry/remove flows;
  `SyncStatusIndicator` state table.
- `useAuth` test for `isAuthResolved` (false on fetch reject, true after ok).
- Check the `vi.mock('@/lib/api/posts')` factories (`usePosts.test.tsx`,
  `usePostHandlers.test.tsx`, `SettingsPage.test.tsx` and friends) — they enumerate
  every export by hand and throw on new ones. `ApiError` deliberately lives in
  `api/errors.ts` to keep those factories untouched; keep it that way.

### Phase 1 e2e (`app/e2e/offline-posts.spec.ts`)

Follow `composer-draft.spec.ts` patterns. Simulate offline by aborting backend calls
with a pathname-anchored predicate —
`page.route(url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'),
route => route.abort())` — never bare `'**/api/**'` globs (they also match the Vite dev
server's own module URLs like `/src/lib/api/posts.ts`, so the app never loads) and
never `context.setOffline` (it severs the Vite dev server too). Trigger reconnect by
unrouting the same predicate and `page.evaluate(() => window.dispatchEvent(new
Event('online')))` — the engine listens to the event, so no real connectivity change
is needed.

- Compose text offline → card with `Queued` chip appears, composer clears, navbar
  shows the offline indicator; reload → card still there (IDB persistence); unroute +
  dispatch `online` → card disappears, post appears in the feed.

## Phase 2 — media posts offline

Lifts the phase-1 media guard.

- **Enqueue runs the existing pre-network pipeline first** (audio normalize /
  WAV→WebM conversion with the current `preparing`/`compressing` composer states,
  recorded-blob → File naming) so the outbox stores final bytes; sync becomes pure
  upload. Store the resulting blob + name on the entry.
- **Size cap at enqueue**: mirror the server's max-media-size constant (read the real
  value from the backend validation; do not invent one). Over the cap → keep state,
  `toast.error` naming the limit, e.g. `` `This file is too big to queue (${limit} MB
  limit).` ``.
- **Quota/storage failure**: `enqueuePost` returns false → keep composer state +
  `toast.error("Couldn't queue this post — device storage is full.")`. Unlike autosave,
  never silently drop the media and queue the text: the outbox entry is the post, not a
  best-effort snapshot.
- **Sync**: `createPost` already handles both branches given a `File`; the S3 branch
  presigns *at flush time*, so the 300s presign expiry is a non-issue. No special
  handling.
- **Card previews**: object URLs from the stored blob — image `<img>`, audio/video
  the platform elements; reuse the composer's preview component if it fits, otherwise
  minimal inline elements. Revoke object URLs on unmount (house precedent f5d2971).

Tests: outboxDb blob metadata round-trip (jsdom blobs don't survive fake-indexeddb —
assert metadata in unit tests, bytes in e2e); enqueue-time conversion called for
recorded audio; size-cap and quota-failure paths; card preview rendering. E2E: attach a
real image offline → queued card shows preview → reconnect → post in feed renders the
image with `naturalWidth > 0` (byte fidelity through IDB → FormData).

## Phase 3 — auto-sync toggle (local-first mode)

- `type SyncMode = 'auto' | 'local'` lives in the outbox store (reactive via the same
  subscription); every change writes localStorage `'post-sync-mode'`. Engine: while
  `local`, no automatic flushing at all (mount, online, backoff — all suppressed);
  `flushEntry`/`retryEntry` still work. Flipping to `auto` triggers a flush.
- **Composer toggle**: icon dropdown in the action-row right cluster, immediately left
  of the visibility selector, mirroring its exact idiom (icon trigger +
  `DropdownMenuRadioGroup` with labeled, described items). Trigger icon `Cloud` (auto) /
  `CloudOff` (local), `aria-label` `Auto-sync`. Items:
  - `auto`: label `Sync automatically`, description `Posts go online as soon as
    possible.`
  - `local`: label `Stay on this device`, description `Posts wait here until you send
    them.`
  Visible to everyone (not auth-gated). The Post button label never changes; the toast
  differs: submitting in local mode always enqueues (even online) with
  `toast('Saved on this device.')`.
- **Presentation while `local`**: queued cards' chip reads `On this device` instead of
  `Queued`; the strip gets a header row — left `` `On this device — ${n}` ``, right a
  ghost `Post all` button (calls `flushOutbox` bypassing mode via an explicit-manual
  flag). Indicator adds a state above the idle row: mode `local` with n > 0 →
  `HardDrive` icon + count, tooltip `Auto-sync is off — posts stay on this device.`
- **Per-card `Post now`** (queued entries, any mode): sends just that entry
  (`flushEntry`).
- **Per-card `Edit`**: only when the composer is empty (else disabled with tooltip
  `Finish or clear the composer first.`); loads the entry back into composer state
  (text, visibility, media, isDraft has no composer slot — draft-ness is chosen at
  submit — accept the loss and note it in the card tooltip? No: keep it simple, Edit
  restores content and the user re-chooses Draft), then removes the entry. Autosave
  picks the content up within its debounce, so a crash loses nothing meaningful.
- 401-failed entries interact well here: `Sign in to post this.` + the entry waits;
  after login the user hits Retry (auto-retry on login is a non-goal).

Tests: mode persistence + engine suppression while `local`; `Post all` and `Post now`
bypass; chip/copy switch; Edit flow (restores composer, removes entry, disabled when
composer occupied); flip-to-auto flushes. E2E: toggle local → post online → card says
`On this device` → survives reload → `Post now` → lands in feed.

## Phase 4 — Settings default for the toggle

- `AppSettings` gains `postSyncDefault: 'auto' | 'local' | 'remember'`, default
  `'auto'` (add to `defaultSettings` — `getSettings()` merges, so existing users get it
  free).
- Resolution at provider mount: `'remember'` → localStorage `'post-sync-mode'`
  (fallback `'auto'`); otherwise the setting value verbatim. The live toggle always
  writes `'post-sync-mode'` regardless of the default in force, so switching the
  setting to `remember` later honors history.
- **Settings UI**: new Card `Offline & sync` after the Post Settings card (`mb-4`),
  before Video Settings. One `RadioGroup` (Video Quality is the precedent), label
  `New posts`, description `Choose how the auto-sync switch in the composer starts.`
  Options:
  - `auto` — label `Sync automatically`, description `Posts go online as soon as
    possible. Offline posts wait for a connection.`
  - `local` — label `Stay on this device`, description `Posts wait here until you send
    them.`
  - `remember` — label `Remember my last choice`, description `Start with whichever
    mode you used last.`
  Follow the page's existing state pattern (one `useState` + the single persist
  `useEffect` that writes all settings).

Tests: settings default merge; radio persists through `updateSettings`; provider mode
resolution for all three values incl. `remember` fallback; SettingsPage render +
interaction.

## Gates (every phase)

```bash
cd app && bun run typecheck   # TS 7 — never bunx tsc
cd app && bun run lint        # --max-warnings 8 ceiling: split files (hooks .ts,
                              # components .tsx) rather than adding warnings
cd app && bun run test        # Vitest — never bare `bun test`
cd app && bun run check       # Biome
ruff check server/ && ruff format --check server/
uv run python server/manage.py test apps   # `apps` label mandatory
bun run test:e2e              # phases with e2e additions; Django must be on :8000
```

## Non-goals

- Service worker / PWA shell, offline reads, offline app start with a cold cache
  (backlog stage 1/3). The outbox serves an already-loaded tab.
- Offline edit/delete of *server* posts; offline likes, views, transcription.
- Cross-tab live sync of the outbox mirror (client_uuid makes races harmless; the UI
  may be momentarily stale in a second tab).
- Auto-retry of 401-failed entries on login.
- Outbox entries on the Profile page or Drafts tab before they sync.
- `Retry-After` handling for 429 (generic backoff covers it).

## Security and correctness invariants

- A queued post composed by user A is never displayed to, flushed as, or editable by
  user B; `'anon'` entries never flush while a user is authenticated. (`'unknown'`
  entries belong to the device's session by construction.)
- All server-side gates are unchanged: anonymous may only create public + published;
  dedupe runs after the auth gate and never widens what an anonymous request can do.
- `client_uuid` is write-only: never serialized back, never in OG pages or list
  responses.
- The outbox never silently drops content: enqueue failures surface to the composer,
  media is never stripped to satisfy quota, remove requires confirmation.
- No new `VITE_*` variables (the prod Docker build wouldn't plumb them), no inline
  scripts (CSP hash gate), no new deps beyond what's installed.

## Deviation log

Deviations from this spec found necessary during implementation are recorded here by
the implementing/judging models.

- The existing `Feed.handlePostCreated` caught and logged create failures without rethrowing them,
  so `CreatePost` could not distinguish the pinned network-level `TypeError` fallback from a
  successful online submit. Phase 1 now rethrows after preserving the existing log; the composer
  still owns the existing user-facing failure toast.
- The existing auto-transcription failure copy in `usePostHandlers` is
  `Auto-transcription failed to start`, not `Failed to start transcription` as described above.
  The outbox reuses the real existing copy so the two create paths remain consistent.
- DRF treats model fields with `editable=False` as read-only, so listing `client_uuid` in
  `PostCreateSerializer.Meta.fields` did not provide the write semantics the spec expected from
  the model field. The create serializer declares an explicit write-only `UUIDField` with the
  pinned optional/null behavior; the read serializer remains unchanged.
- Playwright route interception aborts requests but does not change `navigator.onLine`, and
  dispatching only the `offline` event desyncs the flag from the event: TanStack's onlineManager
  (which listens to the events) then pauses the live-path mutation while the composer (which reads
  the flag) still takes the online path — the submit hangs and nothing is enqueued. The Phase 1
  e2e therefore overrides `navigator.onLine` via `Object.defineProperty` and dispatches the
  matching event together, the way a real browser flips both at once; reconnect restores the flag
  and uses the pinned `online` event.
- The spec originally pinned `page.route('**/api/**', …)` globs for the offline simulation. Under
  the Vite dev server those also match the app's own module URLs (`/src/lib/api/posts.ts`,
  `/src/lib/api/auth.ts`), aborting the source files themselves so the app never mounts — found
  when the e2e run timed out waiting for the composer. The recipe above now uses a
  pathname-anchored predicate (`url.pathname.startsWith('/api/')` etc.), which only matches real
  backend calls on any backend port (CI :8000, local :8100).

The following entries record fixes from the phase-1 adversarial review (a 4-lens finder /
per-finding refutation workflow); each amends what the spec originally pinned:

- The spec's original online-trigger design (`refreshAuthStatus()` then flush) read the refreshed
  identity through provider state that React commits a task *after* the refresh resolves, so the
  first entry of every online pass was gated on the pre-refresh identity — violating the
  never-flush-as-another-user invariant the refresh exists to defend (confirmed with an empirical
  React 19 timing probe). `useAuth` now maintains a synchronously-written snapshot ref exposed as
  `getAuthSnapshot()`, the engine reads auth exclusively through it, and `refreshAuthStatus()`
  reports success. The `online` event no longer refreshes inline: it marks the identity stale and
  the pass itself must complete a successful refresh before sending — so a failed reconnect
  refresh sends nothing (instead of flushing on stale identity) and backoff retries re-verify.
- A pass aborted because the identity could not be verified originally returned silently, leaving
  a pre-existing queue stuck at 'Queued' for the whole session when `/auth/status/` failed at app
  load. Such an abort now schedules the normal backoff retry.
- The spec pinned `flushOutbox()` as a silent no-op while a pass is running and accepted the
  mid-flush-enqueue gap. That also silently swallowed manual Retry clicks and the backoff timer's
  own firing (which had just been consumed), stranding entries with no remaining trigger. Flush
  requests that hit the lock are now latched and replayed for still-queued entries when the pass
  ends — which incidentally closes the accepted mid-flush-enqueue gap too.
- The provider's flush effect keyed only on `isAuthResolved`, so a login after the flag was
  already true (the visible path: sign in via the modal with queued entries present) never
  triggered a pass. It now keys on the identity fields as deliberate change-triggers.
- `removeEntry` was pinned `Promise<void>` with Remove always available, but confirming removal
  while the entry's POST was in flight deleted the local copy and let the post publish anyway,
  back-to-back 'Removed.' and 'Synced' toasts contradicting each other. `removeEntry` now returns
  `'sending'` without deleting when the send is in flight, and the card explains; the Remove
  button itself stays always-rendered as pinned.
- `getCsrfToken` called `response.json()` without an ok-check, so a transient 5xx on
  `/auth/csrf/` surfaced as a `SyntaxError` and landed in the generic-failure branch (permanent
  'failed'), while the identical 5xx on the create itself was retryable. It now throws a
  status-carrying `ApiError`, putting both failures in the same taxonomy branch.
- The indicator's `<output>` is an implicit live region whose only accessible text was the bare
  count digit — screen readers announced context-free numbers, and label-only state changes
  announced nothing. The digit is now `aria-hidden` and a visually-hidden copy of the label lives
  inside the region; `aria-label` stays for the accessible name (and the e2e/test selectors).
- The display-side visibility predicate (`useOutbox` → `getVisibleOutboxEntries`) had no
  unmocked test coverage — the filter could be deleted with every test staying green. A
  real-engine `useOutbox` hook test now pins both the authenticated and signed-out filters.

Phase 2:

- A `TypeError` raised *during* media preparation (WAV→WebM conversion) is not a network drop,
  and treating it as one would queue the text with its media silently stripped. Both queue
  paths now enqueue only after preparation completes (`prepareCompleted` guard on the online
  fallback, a catch on the offline branch); a preparation failure surfaces the generic
  create-failure toast with composer state kept.
- The spec's quota-failure copy ("device storage is full") is used only when the entry carries
  media; text-only enqueue failures keep phase 1's generic copy. IDB reports no distinct quota
  error through the outbox layer, and a text-only entry failing to store is almost never a
  quota problem.
- The queued card's status/Draft chip row moved from the header cluster to below the text and
  media preview, so status sits next to the error line it explains; media previews made the
  header placement cramped. The image alt text carries the stored filename.

Phase 3:

- The spec pinned Edit as disabled-with-tooltip while the composer is occupied. A live disabled
  state needs reactive cross-component occupancy tracking (composer state observed from every
  card), so occupancy is instead checked at click time via the `composerBridge` loader's return
  value, with the toast `Finish or clear the composer first.` on refusal — the same
  confirm-time-check idiom `removeEntry`'s sending-guard already uses.
- Edit re-reads the entry from the engine snapshot at click time. The rendered card can predate
  a flush pass that has since marked the entry `sending`; loading that content into the composer
  would duplicate a post already publishing. A sending entry gets the pinned can't-edit toast, a
  vanished one is a silent no-op.
- Indicator priority: the local-mode HardDrive state sits *below* offline, flushing, and failed —
  a manual "Post all" in local mode shows the spinner, and failures keep winning. The spec only
  pinned "offline wins"; the rest follows the phase-1 ordering rationale (most actionable first).
- The auth-verify abort inside a *manual* flush now toasts "Couldn't reach the server — your
  posts are still on this device." — silently doing nothing on an explicit click reads as a
  broken button. Background passes stay silent, and a latched manual request replayed by
  `drainPendingFlush` intentionally degrades to a silent background pass.
- Manual actions while offline (`Post now`, `Post all`) toast "You're offline." and skip the
  flush instead of burning a doomed attempt.
- Draft-ness is not restored on Edit (spec-pinned): the composer has no draft slot; the user
  re-chooses at submit.

Phase 4:

- Resolution moved from provider mount to engine module init, via a pure exported
  `resolveInitialSyncMode()` (reads the setting; `'remember'` → the stored `'post-sync-mode'`
  history, fallback auto; no writes, no flush). Mount-time resolution through `setSyncMode`
  would have persisted the *default* into `'post-sync-mode'` on every app start, destroying
  the history "Remember my last choice" exists to read — and phase 3's module-init read
  would have rendered the wrong mode until the provider effect ran.
- `postSyncDefault` defaults to `'remember'`, not the spec-pinned `'auto'`. The phase-3 e2e
  reload test exposed the harm: with an `'auto'` default, reloading resets the mode and the
  provider's mount flush silently publishes posts the user explicitly held on this device.
  `'remember'` keeps the shipped phase 1–3 behavior exactly (offline posts composed in auto
  mode still auto-send across reloads — offline composing never flips the mode), while
  `'auto'`/`'local'` remain available in Settings for users who want a pinned start mode.

Hardening round (post-review):

An adversarial multi-agent review over the finished branch confirmed six defects (nine
findings; the rest were coverage gaps). All fixed in the hardening commit:

- `removeEntry` published the snapshot *after* awaiting the IndexedDB delete; a flush
  trigger firing inside that await (backoff timer, reconnect, another enqueue) still saw
  the entry and could publish the post the user had just removed. The snapshot filter now
  happens before the await.
- `runFlush`'s auth-verify abort left `pendingFlushIds` latched, so ids from a manual
  "Post all" could replay on an unrelated later automatic pass — in local mode, long
  after the click. The abort now clears the latch; auto-mode backoff still covers the
  queue as a whole.
- Flipping auto-sync off mid-pass didn't stop the pass: entries kept publishing after the
  user turned syncing off. An automatic pass now stops at the next entry boundary
  (`if (!options?.manual && snapshot.syncMode !== 'auto') break`); a manual pass
  deliberately keeps going.
- The offline indicator promised "They'll go out when you're back online." even in local
  mode, where reconnecting sends nothing. Offline + local now says "on this device."
- The composer's online submit and its offline fallback used different `client_uuid`s: a
  create whose response was lost after the server processed it would duplicate on flush.
  `submitPost` now mints one uuid, sends it with the live request, and hands the same
  uuid to `enqueuePost` (which grew an optional `id` input) so the replay dedupes
  server-side.
- The size-cap toast hardcoded "100 MB limit"; it's now derived from
  `MAX_QUEUED_MEDIA_BYTES`.

Refuted findings deliberately not changed: "Post now" on draft entries (spec-pinned),
Retry's missing offline guard (doesn't end in silence), `resolveInitialSyncMode` input
validation (only typed writers exist), a TanStack mid-flight pause/resume duplicate
(mutations retry 0 — the mechanism cannot occur), and stale-identity flush (spec-pinned).
