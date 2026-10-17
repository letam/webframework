# Frontend test suite quality — handoff

Status: **open**. Written 2026-10-17 after a quality review of the Vitest suite (`app/src/__tests__/`).
The first batch of fixes is PR 20 (`test/suite-quality-fixes`, commit `1c5da38`). Everything below
is what that review found and PR 20 did **not** fix, ranked for whoever picks it up next.

Line numbers are as of `1c5da38` on top of `main`; they drift, so grep the named symbol before
trusting one. Items marked **(PR 18)** concern code that only exists on `codex/channels-presence`
(realtime presence and practice rooms) and should be done there or after it merges.

## Where things stand

- 37 test files and 372 tests on `main`; `bun run test` takes about 10 s.
- Coverage on `main` is **~53% of lines and ~54% of branches**: `bun run test:coverage`. Before PR 20 the
  report left untested files out of the denominator and showed ~74%. Coverage is not gated in CI.
- Strongest areas, which you should copy rather than rework:
  - `outboxDb.test.ts`: fake-indexeddb, a fresh `IDBFactory` per test, and the full
    owner/lease/tombstone matrix.
  - The outbox engine's race tests: deferred promises plus `vi.waitFor`.
  - The hook tests run on real providers (`useAuth`, `usePosts`, `useOutbox`).
- Weakest areas:
  - Page-level component tests that mock every child and so only check props wiring.
  - Several high-risk user flows with no tests at all.

### What PR 20 already did (don't redo)

- Four outbox tests that spied on `Storage.prototype` could never fail. They now spy on
  `localStorage`, and the engine `afterEach` restores spies.
- `parseDurationString` fix (NaN on bad input; Django day prefix) and its first tests.
- `coverage.include` so untested files count; `TZ=UTC` pinned in `vite.config.ts`.
- `app/coverage/` is now ignored by git and by ESLint.

## How to work on this

- `cd app && bun run test` (never bare `bun test`), `bun run typecheck`, `bun run lint`
  (`--max-warnings 8` is a ceiling: don't raise it). For Biome, run the CI-pinned version
  from the repo root on the files you changed: `bunx @biomejs/biome@2.3.11 ci <files>`. A
  local `ci .` also sweeps generated static files that CI never sees.
- **Prove each new or repaired test can fail.** For every guard a test claims to cover,
  delete or invert it in the source and confirm exactly that test goes red. Then restore it
  with `git checkout -- <file>`. This is how PR 20 found four inert tests. A test that was
  never seen failing doesn't count as done.
- `vitest.setup.ts` replaces `localStorage` with a plain object. Spy on `localStorage`, never
  on `Storage.prototype`.
- Don't add `vi.restoreAllMocks()` to the global setup `afterEach`. `MediaPlayer.test.tsx`
  patches `HTMLMediaElement.prototype` in `beforeAll` and restores it in `afterAll`, so a
  global restore would undo that patch after the first test. Restore per file or per describe.

## Next steps, ranked

### P1: high-risk behavior with no test

1. **CreatePost prep-failure guard** (`components/post/create/CreatePost.tsx:521-590`). A
   `TypeError` thrown *while preparing media* (before `prepareCompleted = true`) must show a
   toast and **not** call `enqueueOutboxEntry`. A `TypeError` from the network fetch *after*
   prep must enqueue. Only the second case is tested (`CreatePost.test.tsx`). The untested
   branch is the one that would silently queue broken posts. Also test the generic
   non-TypeError failure (`'Failed to create post'`, `:590`) and the file-input rejection
   toasts for size and type.
2. **Post transcription polling** (`components/post/Post.tsx:24, 123-196`). `handleTranscribe`
   starts a 3 s `setInterval` and gives up after `TRANSCRIPTION_TIMEOUT_MS` (3 min) with a
   toast. `Post.test.tsx` already runs on fake timers, so this is the cheapest high-value
   test to add. Cover: completes → stops polling; never completes → timeout toast and
   interval cleared; unmount mid-poll → no further fetches.
3. **Request-layer wire contract.** `__tests__/lib/api/posts.test.ts:12` replaces
   `getFetchOptions` with a stub, so no posts test checks what actually goes over the wire.
   `fetch.test.ts` has one test. Test `getFetchOptions` (`lib/utils/fetch.ts:51`) directly:
   - GET sends no `X-CSRFToken`.
   - Mutating methods send it.
   - `FormData` bodies get **no** `Content-Type`.
   - Object bodies are JSON-stringified with `Content-Type: application/json`.
   - `credentials` is set.

   Also cover `getCsrfToken` (`:18`): cache hit, expiry, and `clearCsrfTokenCache` (`:13`).
4. **Post body sanitization** (`Post.tsx:71-91`, DOMPurify then `dangerouslySetInnerHTML`).
   `richText.test.ts` tests the lib layer, but nothing asserts the component strips
   `<img onerror>` and `javascript:` hrefs. Nothing checks that hashtag clicks route through the
   delegated handler either.
5. **Auth UI.** `LoginModal.tsx`, `SignupModal.tsx`: no tests. Cover server error display,
   submit disabled while pending, and success closing the modal and refreshing auth. Logout in
   `Navbar.tsx` is also untested. `e2e/auth.spec.ts` only opens and closes the modals.

### P2: real gaps, lower blast radius

6. **Pure modules with no tests:**
   - `utils/tags.ts` (`HASHTAG_REGEX = /#[0-9A-Za-z_]+/g`, `:4`)
   - `lib/utils/browser.ts`
   - `lib/utils/identity.ts` (pin one hash→palette value)
   - `lib/utils/audio.ts` (`convertToWav` is pure; feed it a stub AudioBuffer)
   - `richText.ts` `applyMarkdownShortcut` (`:111`)

   ⚠️ **Two product questions to raise, not decide.** `#café` becomes the tag `caf` (an
   ASCII-only regex). And `utils/filterQuery.ts:131` matches tags by substring, so `#draft`
   also matches `#drafts`. Write the test for whichever behavior the owner confirms.
7. **Outbox engine edges** (`lib/outbox.ts`):
   - `429` retryable (`:395`; only 503 is tested).
   - Backoff progression past the first 15 s step (`RETRY_DELAYS_MS`, `:56`).
   - The media `File` built in `buildCreateRequest` (`:325`): assert name and type reach
     `createPost`.
   - The transcription-failure toast.

   The hand-rolled `outboxDb` fake in `outbox.test.ts` never applies `recoverExpiredClaim`
   (`lib/utils/outboxDb.ts:31`), so expired leases from a dead tab aren't exercised at the
   engine level.
8. **Settings defaults** (`lib/utils/settings.ts:31-35`). Pin `defaultVisibility: 'private'`,
   `saveComposerDrafts: true` and the corrupt-JSON fallback. `settings.test.ts:28` "persists"
   `'remember'`, which is already the default, so it can't tell a write from a no-op. Use a
   non-default value.
9. **Recorders.** The `MediaRecorder` stub in `vitest.setup.ts:119-123` is a plain object and
   can't be constructed. That blocks any test of `AudioRecorder.tsx` (557 lines) or
   `VideoRecorder.tsx`. Make it a constructible fake class with
   start/stop/`ondataavailable`. This pairs with "Recording robustness pass", item 1 of "Next up" in
   `docs/feature-backlog.md`: build the fake as part of that work.
10. **EditPostModal, CommentSection**: no tests; CommentSection is at about 10% coverage.
11. **Hook gaps:**
    - `usePostHandlers`: anonymous-like toast; delete/visibility/publish/copy-link.
    - `usePostFilters`: toggle/remove/clear, `'or'` mode, `recordRecentFilterSet`.
    - `useComposerDraft`: restore flow, visibilitychange flush.
    - `useFeedKeyboard`: `enabled:false`, `altKey`, `defaultPrevented`.
    - `useAuth`: user change → posts invalidated; `clearCsrfTokenCache` asserted.

### P3: hygiene that makes the above cheaper

12. **Shared helpers.** Ten test files build their own `QueryClient` wrapper, and an
    `OutboxEntry` factory is hand-rolled in four. Add `renderWithProviders`, `makeOutboxEntry`
    and an auth-context factory next to `__tests__/data/mockPosts.ts`, then migrate files as you
    touch them. Don't do a big-bang rewrite.
13. **Leaked globals.**
    - `globalThis.fetch = …` is never restored in `MediaPlayer.test.tsx:42`,
      `fetch.test.ts:11` and `posts.test.ts:51`. Use `vi.stubGlobal` plus
      `vi.unstubAllGlobals()`, the way `auth.test.ts` does.
    - `SettingsPage.test.tsx:159` defines `URL.createObjectURL` without restoring it.
14. **Weak flushes.** `outbox.test.ts:335` and `:1215` use one `await Promise.resolve()` before
    `not.toHaveBeenCalled()`, and a single microtask proves nothing about an async chain.
    Await the real promise or `vi.waitFor` on a positive signal first.
15. **Accessibility gaps that force fragile queries.** Fix the component, then switch the test to
    `getByRole(..., { name })`:
    - The mobile menu trigger in `Navbar.tsx:~170` has no `aria-label`; tests use
      `name: ''`.
    - The `MediaPlayer.tsx` play/skip buttons have no names; the test uses
      `querySelectorAll('button')[1]`.
    - The hidden avatar file input in `Profile.tsx:309` has no label.
    - `SyncStatusIndicator.test.tsx` queries `.lucide-hard-drive`.
16. **Over-mocked page tests.** `Feed.test.tsx` mocks six collaborators and calls the
    `onPostCreated` prop by hand. Replace it with one test on real `Post` and `CreatePost` and a
    mocked API layer. `DraftsPage.test.tsx` asserts `getByText('2')`.
17. **Coverage ratchet.** Once P1 is in, add `coverage.thresholds` just under the current
    numbers and run `test:coverage` in CI, so the number can only go up.

### Not unit-test work

- **e2e gaps** (Playwright):
  - Real login/logout.
  - CSRF 403 → refresh → retry against Django.
  - Two-context outbox contention (`browser.newContext()` twice).

  The S3 upload branch isn't covered either, since e2e runs on local storage.
- **Cosmetic bug:** `MediaPlayer.tsx:17` `formatTime` has no hours field, so a 25-hour file
  shows `1500:03`. Found while verifying PR 20.
- **(PR 18)** Practice and presence tests:
  - `usePracticeRoom` has no tests for the 4401/4403/4404 denied closes, `'error'`
    frames, `room.presence`, the lease-stale close or `socket.send` throwing.
  - The two `practice.test.ts` reducer tests are 6–8-step chains; split them.
  - `lib/practice/invitation.ts` (scrubs `#invite=`; security-relevant) and
    `lib/api/practice.ts` have no tests.

## Not confirmed

One reviewer reported `act()` warnings in `CreatePost.test.tsx` ("submits the selected
visibility") and `usePracticeRoom.test.tsx` (wake-resync). A rerun on 2026-10-17 printed none.
If they show up under load, the cause is likely a lazy child resolving after the assertion. Await
`findBy*` for it before asserting.
