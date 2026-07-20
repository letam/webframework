# 01 — Security Issues (Critical & High)

Consolidated security findings across the whole codebase, for triage. Each item also appears in its area report ([02-backend.md](02-backend.md) / [03-frontend.md](03-frontend.md)) with surrounding context. Verified items are marked ✅ (manually confirmed against source).

---

## Authentication & authorization

- **🔴 `server/apps/uploads/views.py:20,75`** ✅ — `get_presigned_url` and `get_presigned_url_for_post` have **no authentication or permission checks**. Any anonymous caller can mint a presigned `PUT` URL (write arbitrary objects to your R2/S3 bucket) or a presigned `GET` for any post's media. *Fix:* require authentication and authorize per-user/per-post.

- **🔴 `server/apps/blogs/views.py:24`** — `PostViewSet` sets `permission_classes = [AllowAny]` for all actions and hand-rolls `is_author`/`is_admin` checks inside `update()`/`destroy()` (duplicated verbatim). Bypasses DRF's permission framework and is easy to get wrong. *Fix:* an `IsAuthorOrAdmin` permission class per action.

- **🔴 `server/apps/users/management/commands/init_users.py:25`** ✅ — `create_superuser(username='admin', password='admin')` on the `--superuser-only` path leaves a trivially guessable superuser in any environment it's run. *Fix:* require an env/prompt-supplied password; never default to `admin/admin`.

- **🟠 `server/apps/users/management/commands/init_users.py:39`** ✅ — The anonymous user is created via `User.objects.create(username='anonymous')` with **no `set_unusable_password()` and no `is_active=False`**, leaving a login-capable account with an unset password hash. *Fix:* set an unusable password and deactivate login.

- **🟠 `server/apps/auth/views.py:23-24,77-82`** — No rate limiting/throttling on `login`/`signup` (brute-force / credential-stuffing), and `logout` accepts `GET` (state change via a CSRF-unsafe method). *Fix:* add DRF/django-ratelimit throttles; restrict logout to `POST`/`DELETE`.

- **🟠 `server/apps/blogs/views.py:201,217`** — Open `TODO`s: "Restrict access to share only to authorized users" on the media MIME and streaming endpoints — media of any post is currently served to any caller. *Fix:* authorize access before streaming; track as a real issue, not a comment.

## Input validation & injection

- **🔴 `server/apps/uploads/views.py:28`** ✅ — User-supplied `file_name` is concatenated directly into the S3 key (`f'post/audio/{user_id}/{file_name}'`) with no sanitization → path traversal / key injection (`../`) to overwrite arbitrary objects. *Fix:* sanitize/whitelist the filename; derive the key server-side.

- **🔴 `server/apps/uploads/views.py:24-26`** ✅ — `json.loads(request.body)` and `data['content_type']` / `data['file_name']` have no error handling (bad JSON / missing key → 500) and `content_type` is unvalidated (client sets the object's Content-Type freely). *Fix:* validate inputs, whitelist content types, return 400 on bad input.

- **🔴 `server/apps/website/views.py:14-46`** — `local_dev_response_from_file_in_app_public_dir` builds `file_path = 'app/public' + request.path` and opens it directly. Although DEBUG-only, `request.path` is attacker-controlled and unsanitized → path traversal (`/../../`) to read arbitrary files in dev. *Fix:* normalize and confine the resolved path to the public dir.

- **🟠 `server/apps/auth/views.py:30,48`** — `json.loads(request.body)` with no try/except in `login`/`signup` → unhandled `JSONDecodeError` (500) on a malformed body. *Fix:* wrap and return 400.

## Storage / object exposure

- **🔴 `server/config/settings.py:391`** ✅ — `AWS_DEFAULT_ACL = 'public-read'` makes every uploaded object world-readable. *Fix:* default to a private ACL; serve via presigned GET.

- **🔴 `server/config/settings.py:392`** ✅ — `AWS_QUERYSTRING_AUTH = False` strips signed query params from storage URLs, so object URLs are unauthenticated. Combined with `public-read`, all media is fully public. *Fix:* keep objects private and use presigned URLs (or set this `True`).

- **🟠 `server/apps/uploads/views.py:69`** — Presigned GET URLs are valid for **1 hour** (`ExpiresIn=3600`) while the frontend only caches them ~1 minute; over-long exposure on already-public objects. *Fix:* shorten expiry; name the constant.

## Secrets & configuration

- **🔴 `server/config/settings.py:70-101`** — `check_and_create_env_file()` silently auto-generates `.env` with a fresh `SECRET_KEY` if missing. In production a missing env mints a new key each deploy (invalidating all sessions/signatures) and hides misconfiguration. *Fix:* fail fast when required secrets are absent.

- **🔴 `server/config/settings.py`** (no SSL/cookie hardening) — Missing `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_PROXY_SSL_HEADER`, `SECURE_CONTENT_TYPE_NOSNIFF`. Session/CSRF cookies can be sent over HTTP. *Fix:* add these gated on `not DEBUG`.

- **🔴 `server/config/settings.py:218-219`** — `AUTH_PASSWORD_VALIDATORS = []` when `DEBUG` is true disables all password-strength checks; a DEBUG slip in staging accepts weak passwords. *Fix:* don't disable validators wholesale.

- **🟠 `server/config/settings.py:117-128`** — Production `ALLOWED_HOSTS` hardcodes multiple domains **plus** `localhost`/`127.0.0.1`; allowing localhost in prod is a Host-header risk and the domain list is baked into source. *Fix:* drive `ALLOWED_HOSTS` (and the duplicated `CSRF_TRUSTED_ORIGINS`) from one env var.

## Frontend security

- **🔴 `app/src/components/post/Post.tsx:32-38`** ✅ — `FormatText` runs `DOMPurify.sanitize(children)` **first**, then a regex splices the captured `url` into raw `<a href="…">…</a>` HTML rendered via `dangerouslySetInnerHTML`. The post-sanitize URL substring is not re-escaped, partially defeating the sanitizer. *Fix:* build the anchor markup first, then sanitize the final HTML (allow `target`/`rel`), or escape the URL before interpolation.

- **🔴 `app/src/lib/utils/fetch.ts:38-68` + `app/src/hooks/useAuth.tsx:30` + `app/src/lib/api/posts.ts` (several)** — No request sets `credentials: 'include'`, yet the app relies entirely on session cookies + CSRF. If `VITE_SERVER_HOST` is cross-origin, the cookie is never sent and auth/CSRF silently break (and `/auth/status/` reports unauthenticated). *Fix:* add `credentials: 'include'` in `getFetchOptions`, the CSRF fetch, and the bare `fetch`es in `posts.ts`/`useAuth`.

- **🟠 `app/src/lib/utils/fetch.ts:25-34`** — `getCsrfToken` doesn't check `response.ok` and reads `data.token` from untyped JSON; a failed CSRF request caches `undefined` as the token for an hour (every subsequent mutating request 403s with no refetch). *Fix:* validate the response/token and refresh on 403.

- **🟠 `app/src/pages/DebugPage.tsx:4-58`** — A `/debug` route exposing UA internals (incl. non-standard `navigator.userAgentData`) is registered in production routing. *Fix:* gate to dev only.
