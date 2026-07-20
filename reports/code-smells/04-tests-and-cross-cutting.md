# 04 — Tests & Cross-Cutting

Test-quality findings plus codebase-wide patterns surfaced by targeted searches. Severities: 🔴 high · 🟠 medium · 🟡 low.

---

## Part 1 — Test quality

### Stale frontend tests (assert against an obsolete model / pre-TanStack API)

- 🔴 **`app/src/__tests__/data/mockPosts.ts:3-33`** — Mock uses a defunct `Post` shape (string `id`, `text`, `mediaType`, `mediaUrl`, `timestamp`, `username`, `userAvatar`, `likes`) vs the current numeric `id`, `head`/`body`, nested `author`/`media`, `created`/`modified`, `url`. Every consumer asserts an obsolete model. *Fix:* regenerate from the real `Post` interface.
- 🔴 **`app/src/__tests__/lib/api/posts.test.ts:14-33,29,69`** — Asserts `getPosts` calls `'http://localhost:3000/api/posts'` (no trailing slash) and `createPost` POSTs JSON, but the real code calls `${SERVER_API_URL}/posts/` and builds `FormData`; the signed-URL fan-out and `created`→Date mapping are untested. *Fix:* rewrite against the current implementation.
- 🔴 **`app/src/__tests__/hooks/usePosts.test.tsx:20-101`** — `renderHook(() => usePosts())` with **no `QueryClientProvider`**; the real hook is TanStack-Query-based and would throw. Uses raw `setTimeout` waits and a defunct return shape. *Fix:* wrap in a provider; use `waitFor`; assert the real surface.
- 🔴 **`app/src/__tests__/components/Feed.test.tsx:9-99`** — Renders `<Feed/>` (which uses `usePosts()`) with no provider and over-mocks `post`/`create` modules so assertions only verify the stubs. *Fix:* provider + realistic render.
- 🟡 **`app/src/__tests__/setup.ts:5` & `posts.test.ts:6`** — `global.fetch = vi.fn()` duplicated. *Fix:* keep only in setup.

### Missing coverage

- 🔴 **`server/apps/users/tests.py`** — No tests. The custom `User` model and the `init_users` command (superuser + the anonymous user ID=2 that anonymous posting depends on) are untested. *Fix:* test `init_users` idempotency + the anonymous-user invariant.
- 🔴 **`server/apps/website/tests.py`** — No tests for the index route or the OG-metadata post-detail page `/p/<id>/` (a public path), incl. 404 for missing posts.
- 🔴 **`server/apps/blogs/tests/test_views.py`** — No tests for the `transcribe` action, the media streaming endpoint (range requests — the Safari-critical path), or list/retrieve serialization. Only create/delete/update/permissions are covered.
- 🟠 **`server/apps/auth/tests.py`** — Only signup. No `login` (success/bad creds), `logout`, `csrf`, or unauthenticated `status`.
- 🟠 **`server/apps/blogs/tests/test_views.py:40-67`** — Nothing asserts anonymous POSTs are rejected/routed to the anonymous user, nor that `author == request.user` (a security-relevant binding).

### Weak / brittle / assertion-free tests

- 🟠 **`server/apps/blogs/tests/test_models.py:130-165`** — `test_media_duration_extraction_with_real_file` builds a 16-byte fake MP3 then asserts `assertIsInstance(media.duration, (type(None), timedelta))` — passes whether or not extraction works (effectively assertion-free). *Fix:* use a real generated file or delete.
- 🟠 **`server/apps/blogs/tests/test_models.py:96-128`** — `test_media_duration_extraction` mostly asserts non-behavior ("doesn't crash", `assertIsNone` for a fake mp3). *Fix:* split and remove the no-op assertions.
- 🟠 **`server/apps/blogs/tests/test_models.py:132,197,216`** — Unused `import subprocess`, repeated in-method `import tempfile`, ffmpeg-dependent tests that `skipTest` silently. *Fix:* hoist imports; gate ffmpeg behind a shared visible check.
- 🟠 **Duplicated test setup** — `MediaModelTests`, `PostModelTests`, `PostViewSetTests` each recreate `testuser`/`test_file`/`test_mp3` and the same recursive media-cleanup teardown (4th copy in `ViewTestCase`). *Fix:* a shared base with fixtures + one cleanup helper.
- 🟡 **`server/apps/blogs/tests/test_views.py:29-38,273-281`** — `self.temp_dir` setup/teardown that no test writes into; view tests also lack `@override_settings(MEDIA_ROOT=…)` (model tests have it) — confirm they aren't writing into the real `MEDIA_ROOT`.
- 🟡 **`server/apps/blogs/tests/test_models.py:172-193`** — `..._skips_if_already_set` uses the fake mp3, so "skip" is indistinguishable from "returned None"; passes even if skip logic is removed.
- 🟡 **`server/apps/auth/tests.py:64-86`** — `test_signup_weak_password` overrides `AUTH_PASSWORD_VALIDATORS` in-test, testing the override rather than the project's real validators.

---

## Part 2 — Cross-cutting patterns

### Debug statements left in production

- 🔴 **`server/apps/blogs/views.py:58-61,126`** — `print(...)` used for logging (the `:126` one ungated). *Fix:* `logger.debug`.
- 🟠 **`app/src/lib/utils/media.ts:30,46`** — `console.log('INFO: ...')` at module import, every page load.
- 🟠 **`app/src/components/post/create/AudioRecorder.tsx:144,148,160`** — amplitude/gain `console.log`s in the recorder.
- 🟡 **`app/src/components/Feed.tsx:51`, `Profile.tsx:64,69`, `pages/NotFound.tsx:8`** — placeholder/stub `console.log`/`console.error`.
- 🟡 **`app/src/lib/api/posts.ts:94-95`** — commented-out `console.log` block.

### Broad exception handling (no bare `except:` found — all are `except Exception`)

- 🟠 **`server/apps/blogs/models.py:67,79,86,93,100,137`** — six broad catches in file/media cleanup swallow real errors. *Fix:* narrow to `OSError`/`FileNotFoundError`.
- 🟠 **`server/apps/blogs/views.py:163,244`** — broad catch in transcribe + range-parse (silent whole-file fallback). *Fix:* narrow the range-parse catch.
- 🟡 **`server/apps/blogs/utils/get_file_mimetype.py:20`, `utils/media.py:31`** — broad catches in helpers. *Fix:* narrow.
- 🟠 **Frontend (pervasive)** — `try { … } catch (e) { console.error(e); throw e }` in `auth.ts`, `posts.ts`, `audio.ts`, `media.ts`, `settings.ts` adds noise without recovery. *Fix:* centralize.

### Duplicated constants / hardcoded values

- 🔴 **Media-type union duplicated** — `server/apps/blogs/models.py:18-21` (`MEDIA_TYPE_CHOICES`) vs `app/src/types/post.ts:11,40` (twice). Can drift silently. *Fix:* one shared source; document/generate from backend choices.
- 🟠 **`app/src/__tests__/lib/api/posts.test.ts:29,69`** — hardcoded `http://localhost:3000` doesn't match the runtime default (empty host → relative `/api`).
- 🟠 **`server/config/settings.py:354-374,440-483`** — dev origins/ports repeated across CORS, CSRF, and CSP sections. *Fix:* one env-driven list.
- 🟡 **"1 minute" cache duration triplicated** — `posts.ts:5` (`SIGNED_URL_CACHE_DURATION_MS = 60_000`), `usePosts.ts:40`/`useTags.ts:30` (`staleTime: 1000*60`), and the backend presign expiry. *Fix:* shared constant.
- 🟠 **`ANONYMOUS_USER_ID = 2`** hardcoded in `blogs/views.py` and `uploads/views.py:28`. *Fix:* one setting.

### Type-suppression comments

- 🟠 **`server/apps/blogs/views.py:39,68-73,92-93,185-186,243-245`** — many per-line `# pyright: ignore [...]` around `request.user.id`, `serializer.instance`, range parsing — the type model isn't expressed. *Fix:* proper narrowing instead of blanket ignores.
- 🟠 **`server/apps/blogs/tests/test_models.py:2`, `test_views.py:2`, `auth/tests.py:2`** — file-level `# pyright: reportAttributeAccessIssue=false` disables checking for whole files. *Fix:* targeted ignores.
- 🟡 **`server/apps/blogs/serializers.py:10,16,36,50`, `admin.py:41,46`** — DRF/Django-stubs friction ignores. *Fix:* shared stub fix.
- 🟡 **Frontend** — ~15 `eslint-disable`/`biome-ignore`, mostly vendored/justified. The `useExhaustiveDependencies` suppressions at `MediaPlayer.tsx:148,418` and `AudioRecorder.tsx:363` can hide stale-closure bugs — review.

### TODO/FIXME backlog (informational)

- 🟠 **`server/apps/blogs/views.py:201,217`** — "Restrict access to share only to authorized users" — a real auth gap, not just a comment (see [01-security.md](01-security.md)).
- 🟡 Open TODOs flag known gaps: `views.py:26` (prefetch), `uploads/views.py:62,71` (signed-URL caching), `posts.ts:62` (N+1 presign), `types/post.ts:4,32` (`avatar`/`likes`), `Feed.tsx:50` (likes), `CreatePost.tsx:94` (audio/video detection), `convert_to_mp3.py:28` (file-exists collision).

### Clean signals

- No `: any` / `as any` / `@ts-ignore` / `@ts-nocheck` in app source.
- No bare `except:` in Python.
- Style conventions (single quotes, no semicolons, tab indent, line length) are followed — style was not a meaningful source of findings.
