# Phase 2 — social features (built 2026-07-01→02, committed 07-06 as `a81ec04`)

Tam picked this phase first ("most visible product progress") over the recommended security work. Implemented directly by fable-5 in one pass, then verified end-to-end in a real browser. 16 files, +983/−187. Part of [project overview](2026-07-project-overview.md); audit context in [opening audits](2026-07-audits.md).

## Backend

- `Like` (unique per user/post) and `Comment` models, migration 0015.
- ViewSet actions: `like` (POST/DELETE, 401 unauth, idempotent get_or_create/delete), `comments` (GET public / POST auth, 2000-char cap), `comments/<id>` DELETE (author or superuser).
- List queryset gained `select_related`/`prefetch_related` + `like_count`/`comment_count`/`liked` annotations — killing the audit's list N+1 as a side effect. Serializer methods fall back to per-object queries for non-annotated instances (create/transcribe responses).
- Fixed the create-response missing serializer context (audit C3).
- 13 new tests in `test_social.py` → 32 backend tests passing.

## Frontend

- Optimistic like toggling in `usePosts` (cancel → snapshot → flip → rollback on error → reconcile on success) — the app's first optimistic updates.
- `CommentSection` + `useComments`: composer (Cmd/Ctrl+Enter, disabled-when-empty), skeletons, empty/error states, own/superuser delete, count badges synced into the posts cache.
- Share button: `navigator.share` with clipboard fallback (AbortError swallowed as user-cancel).
- Profile page rewritten on real data: stats, Posts/Media/Likes tabs, login prompt when signed out; all mock data removed.
- New shared `usePostHandlers` hook for Feed + Profile — which also fixed the audit's fire-toast-without-await bug in `handleEditPost`.

## Verification (verify skill; Verdict: PASS)

Drove the running app via Playwright at localhost:8000 (Django proxies Vite in dev — same-origin is required for session auth; hitting :5173 direct broke with JSON parse errors). Seeded `verifyuser`/`otheruser`. Observed live: logged-out like → "Log in to like posts" toast; like → instant heart+count, server-confirmed by anonymous curl (`like_count: 1, liked: false`); unlike persisted; comment create/delete with badge updates; real Profile with working Likes tab; state survives reload; curl negative probes (unauth like/comment → 401, comments list public → 200).

**Bugs found by probing, fixed on the spot:**
1. **Stale liked-state across login/logout** — the heart kept the previous user's state because nothing invalidated the posts cache on auth change. Fixed in `useAuth`: invalidate on `userId` transition, with a `hasCheckedAuth` ref so the initial page-load check doesn't double-fetch. Re-verified live in both directions.
2. **Live proof of the security hole**: running `migrate` on the fresh dev DB visibly created the `admin`/`admin` superuser — turned the audit finding into an observed fact and set up [Phase 0 security](2026-07-phase0-security.md).

Known at the time: frontend unit suite already dead (pre-existing, deferred to Phase 1); share-sheet toast unobservable in automated Chromium (needs a manual click on a real device).
