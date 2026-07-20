# Code Smell Report — webframework

**Date:** 2026-05-29
**Scope:** Full codebase — `server/` (Django, ~2,550 LOC) and `app/src/` (React/TypeScript, ~10,650 LOC), excluding generated migrations and vendored `shadcn/ui` primitives.
**Method:** Six focused reviewers swept the code by area (backend core, backend infra/security, React post components, React app/pages, hooks/api/lib, tests/cross-cutting). Every finding carries a `file:line` reference and a one-line fix. The highest-severity security claims were manually spot-checked against source and confirmed.

## How findings are organized

| Report | Area | Findings |
|---|---|---|
| [01-security.md](01-security.md) | **Critical & high-severity security issues** (consolidated across the whole codebase) | 13 |
| [02-backend.md](02-backend.md) | Django backend — models, views, serializers, utils, settings, auth, uploads, users, website | ~70 |
| [03-frontend.md](03-frontend.md) | React — post components, app components, pages, hooks, API client, lib utils | ~120 |
| [04-tests-and-cross-cutting.md](04-tests-and-cross-cutting.md) | Test quality + cross-cutting patterns (debug logging, broad excepts, duplicated constants, suppressions, TODOs) | ~40 |

Security issues are listed in **01-security.md** for triage and also remain in their area report (02/03) with full context. Everything else lives only in its area report.

## Severity at a glance

| Severity | Count (approx.) | Meaning |
|---|---|---|
| 🔴 **High** | ~45 | Security exposure, data corruption/leak, resource leaks, false-success error handling, or broken-at-runtime code. Fix soon. |
| 🟠 **Medium** | ~80 | Maintainability hazards, N+1 queries, duplicated logic, inconsistent typing, missing error UX. Fix opportunistically. |
| 🟡 **Low** | ~90 | Style drift, magic numbers, dead code, minor inconsistency. Cleanup. |

## Top 13 issues to fix first

These are the highest-impact, independently verified problems. Full detail in [01-security.md](01-security.md) unless noted.

1. **🔴 Presigned-URL endpoints have no authentication** — `server/apps/uploads/views.py:20,75`. Any anonymous caller can mint a presigned `PUT` URL (write to your bucket) or a presigned `GET` for any post's media.
2. **🔴 Path traversal in S3 key construction** — `server/apps/uploads/views.py:28`. User-supplied `file_name` is concatenated straight into the object key with no sanitization (`../` escapes the prefix).
3. **🔴 All uploaded media is world-readable** — `server/config/settings.py:391-392`. `AWS_DEFAULT_ACL='public-read'` + `AWS_QUERYSTRING_AUTH=False` makes every object public and its URL unauthenticated, defeating the presigned-URL model entirely.
4. **🔴 Hardcoded `admin`/`admin` superuser** — `server/apps/users/management/commands/init_users.py:25`. The `--superuser-only` path creates a trivially guessable admin. The anonymous user is also created without `set_unusable_password()`.
5. **🔴 Startup fabricates a fresh `SECRET_KEY`** — `server/config/settings.py:70-101`. A missing `.env` is silently auto-generated with a new key; in production this rotates the key per deploy (invalidating sessions/signatures) and hides misconfiguration. Fail fast instead.
6. **🔴 Missing production security headers** — `server/config/settings.py`. No `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_PROXY_SSL_HEADER`, or `SECURE_CONTENT_TYPE_NOSNIFF`. Cookies can travel over HTTP.
7. **🔴 XSS risk: regex re-injects user content after sanitization** — `app/src/components/post/Post.tsx:32-38`. `DOMPurify.sanitize()` runs first, then a regex splices the captured URL into raw anchor HTML rendered via `dangerouslySetInnerHTML`; the post-sanitize URL is not re-escaped. Sanitize the *final* HTML. (See [03-frontend.md](03-frontend.md).)
8. **🔴 `credentials: 'include'` is missing on every fetch** — `app/src/lib/utils/fetch.ts:38-68`, `app/src/hooks/useAuth.tsx:30`, several calls in `app/src/lib/api/posts.ts`. Session-cookie auth + CSRF silently break when the API is cross-origin. (See [03-frontend.md](03-frontend.md).)
9. **🔴 ffmpeg/transcode failures are swallowed and reported as success** — `server/apps/blogs/utils/convert_to_mp3.py:42-50`. `CalledProcessError` is logged but the function still returns the output path as if it succeeded; callers treat a non-existent file as valid. Mirrored in `get_file_mimetype.py` (returns `'unknown'`). (See [02-backend.md](02-backend.md).)
10. **🔴 Object-URL / AudioContext / media-stream leaks** — `MediaPlayer.tsx:194-222,438-466`, `VideoRecorder.tsx:105-117`, `AudioRecorder.tsx:120-122`. `URL.createObjectURL` without `revokeObjectURL`, `new AudioContext()` never `close()`d, and `getUserMedia` tracks not stopped on unmount. (See [03-frontend.md](03-frontend.md).)
11. **🔴 Event-listener leak from mismatched add/remove** — `app/src/components/feed/FilterControls.tsx:57-71`. The cleanup passes a *different* anonymous function to `removeEventListener`, so the `keyup` listener is never removed. Verified. (See [03-frontend.md](03-frontend.md).)
12. **🔴 Unhandled `DoesNotExist` → 500 instead of 404; DRF objects returned from plain views** — `server/apps/blogs/views.py:200-300`. `Post.objects.get(...)` without `get_object_or_404`, `post.media.file` dereferenced without a null check, and `Response(...)`/`FileResponse(bytes)` misused in non-DRF views. (See [02-backend.md](02-backend.md).)
13. **🔴 Mutations never invalidate the query cache** — `app/src/hooks/usePosts.ts:52-73`. Create/edit/delete patch the cache by hand but never `invalidateQueries`, so the client silently diverges from server-computed fields. (See [03-frontend.md](03-frontend.md).)

## Recurring themes (worth a single systemic fix each)

- **Silent error handling everywhere.** `try { … } catch (e) { console.error(e); throw e }` adds noise without recovery across `auth.ts`, `posts.ts`, `audio.ts`, `media.ts`, `settings.ts`; six broad `except Exception` blocks in `models.py` swallow file-cleanup errors. Centralize and narrow.
- **Hand-rolled auth instead of the framework.** `PostViewSet` uses `AllowAny` + duplicated inline `is_author`/`is_admin` checks; auth views skip `@require_POST`/throttling. Use DRF permission classes + throttles.
- **Duplicated logic ripe for extraction.** `formatTime` (3 copies, 2 formats), the "pause all other `<audio>`/`<video>`" DOM hack (3 copies), forged synthetic events (`{ preventDefault(){} } as React.FormEvent`, 4 copies), the auth-modal scaffold (Login/Signup), the page-shell layout (3 copies), and the whole audio-player in `MediaPreview` duplicating `MediaPlayer`.
- **Media-type union duplicated across the stack.** `'audio'|'video'|'image'` is defined in `models.py` and twice in `types/post.ts` with no shared source of truth.
- **N+1 queries.** `PostViewSet.queryset`, `PostAdmin.list_display`, and `PostSerializer`'s reverse relations all lack `select_related`/`prefetch_related`.
- **Dead / stub code shipping to users.** `Profile.tsx` is entirely mock data with stub handlers; `AudioPostTab`/`VideoPostTab`/`TextPostTab` appear unreferenced; `auth/models.py` and `users/views.py` are empty boilerplate; commented-out blocks in `settings.py` and `posts.ts`.
- **Stale tests.** Multiple frontend test files (`posts.test.ts`, `usePosts.test.tsx`, `Feed.test.tsx`, `mockPosts.ts`) assert against an obsolete `Post` shape / pre-TanStack-Query API and cannot reflect current behavior; `users`, `website`, transcription, and media-streaming have no coverage.

## Notes on what's clean

- No `: any` / `as any` / `@ts-ignore` in app source (good TS discipline; the typing gaps are untyped `await response.json()` results, not explicit `any`).
- No bare `except:` in Python (all are `except Exception as e`).
- Reviewed files follow repo style conventions (single quotes, no semicolons, tab indent on the frontend; line length on the backend). Style was **not** a significant source of findings — the issues are substantive.
