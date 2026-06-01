# 02 — Backend (Django)

Findings for `server/`. Security-critical items are cross-referenced in [01-security.md](01-security.md) and marked 🛡️. Severities: 🔴 high · 🟠 medium · 🟡 low.

---

## server/apps/blogs/models.py

- 🔴 **`:37-53`** — `Media.save()` uses fragile multi-save logic (null `file`, `super().save()`, restore `file`, pop `force_insert`, `super().save()` again) to work around needing the PK for the upload path. The second `super().save()` runs even on the insert branch and `force_insert` is never re-applied. *Fix:* extract path-generation clearly or use a `post_save` signal.
- 🔴 **`:67,79,86,93,100`** — Five `except Exception` blocks that only log and swallow errors during save/delete, masking real failures (disk full, permissions). *Fix:* catch `OSError` specifically; surface/re-raise.
- 🟠 **`:70-104`** — `Media.delete()` is long with three near-identical try/except blocks for `file`/`mp3_file`/`thumbnail`. *Fix:* `_remove_file(field, label)` helper.
- 🟠 **`:99`** — `os.rmdir(media_dir)` raises if the dir is non-empty, and `media_dir` is derived only from `self.file`; if `file` is empty but other files exist, the dir leaks. *Fix:* compute dir independently; use guarded cleanup.
- 🟠 **`:14-15`** — `media_file_path` has no docstring/type hints and depends on `instance.id` which is `None` for new records (the exact edge case `save()` works around). *Fix:* document and type.
- 🟠 **`:106-114`** — `convert_to_mp3()` calls full `self.save()`, re-triggering the whole complex override + duration extraction, and doesn't validate the conversion produced a file. *Fix:* `save(update_fields=['mp3_file'])` and check output.
- 🟠 **`:132-141`** — `Post.delete()` manually deletes `self.media` and swallows exceptions; a failed media delete still proceeds, orphaning files. *Fix:* signal-based cleanup or documented cascade.
- 🟡 **`:18-22`** — `MEDIA_TYPE_CHOICES` are magic strings also referenced by literal in `views.py:292` and duplicated in the frontend. *Fix:* a `TextChoices` enum.
- 🟡 **`:31`** — `media_type = CharField(max_length=255)` — 255 is excessive for a 3-value choice (copy-paste magic number across fields).
- 🟡 **`:11`** — Logger named with the hardcoded string `'server.apps.blogs'` while `views.py` uses `__name__`; inconsistent.

## server/apps/blogs/views.py

- 🔴 **`:200,216,219`** — `Post.objects.get(...)` raises unhandled `DoesNotExist` (500) instead of 404 in `get_post_media_mime_type`/`stream_post_media`. *Fix:* `get_object_or_404`.
- 🔴 **`:219-250`** — `stream_post_media` dereferences `post.media.file.path` with no `post.media is not None` check (→ `AttributeError`/500) and no path-existence validation before `os.path.getsize`. *Fix:* guard for missing media.
- 🔴 **`:231-233,254,262-273`** — DRF `Response(...)` returned from plain Django views (no renderer context → error, not the intended 400/JSON), and `FileResponse(data, ...)` at :254 passes raw `bytes` instead of a file-like object. *Fix:* use `JsonResponse`/`HttpResponse` in non-DRF views; pass a stream to `FileResponse`.
- 🔴 **`:42-79`** 🛡️ — `create()` is long and mixes request munging, debug printing, media creation, and re-serialization; it forces `Media.pk == Post.pk` (`id=serializer.instance.id`), a hidden, undocumented coupling between unrelated tables. *Fix:* separate concerns; don't pin PKs.
- 🟠 **`:54-61,126`** — Debug via `print()` with an inline `import json` (and a stray `print(f'Media updates: …')` in `update()`). *Fix:* `logger.debug`; move imports to top.
- 🟠 **`:81-129,171-194`** 🛡️ — Author/admin authorization duplicated verbatim between `update()` and `destroy()`. *Fix:* permission class / helper.
- 🟠 **`:25-27`** — `queryset = Post.objects.all()` with no `select_related('author','media')` → N+1 in list/retrieve (serializer touches `author`/`media` per post). TODO at :26 acknowledges it. *Fix:* add `select_related`/`prefetch_related`.
- 🟠 **`:143-156`** — `transcribe` inlines mp3-conversion logic that duplicates `Media.convert_to_mp3()` and re-checks `.endswith('.mp3')` twice. *Fix:* move to model/service.
- 🟠 **`:235`** — Magic condition `ranges.ranges[0][1] == 2` (range-end of exactly 2 → "whole file") is unexplained and likely a bug. *Fix:* document/replace.
- 🟡 **`:222`** — `request.META.get('HTTPS_RANGE')` is not a real WSGI var (range is always `HTTP_RANGE`); the `is_secure()` branch is dead/incorrect.
- 🟡 **`:243`** — `start, end = ranges[0]` indexes the `Range` object inconsistently with `ranges.ranges[0]` used elsewhere; the broad `except` then hides any error.

## server/apps/blogs/serializers.py

- 🟠 **`:32,45`** — `PostSerializer` is `HyperlinkedModelSerializer` with no hyperlinked relations, and includes the reverse `post_set` with no `prefetch_related` → N+1 when listing posts with replies. *Fix:* prefetch or drop the reverse field.
- 🟠 **`:15-29`** — `MediaSerializer` exposes raw `file`/`mp3_file` storage paths to clients, leaking storage structure. *Fix:* expose only signed/derived URLs.
- 🟡 **`:49-56`** — `PostCreateSerializer` declares a writable `media` FK field, but `create()` strips `media` before validation and creates Media separately → the field is dead/misleading.

## server/apps/blogs/transcription.py

- 🔴 **`:25-46`** — Temp-file leak: `os.unlink(temp_file.name)` is only on the success path; if `transcriptions.create` raises, the `delete=False` temp file is never removed. *Fix:* `try/finally`.
- 🟠 **`:22`** — Mutating module-global `openai.api_key` per call is not thread-safe and uses the deprecated pattern. *Fix:* instantiate a local `OpenAI(api_key=…)` client.
- 🟠 **`:12,29`** — `audio_file` is untyped; copying a local `FieldFile` via `.chunks()` into a temp file is redundant (the file already exists on disk in local-storage mode); no handling when `OPENAI_API_KEY` is unset. *Fix:* type it, reuse the existing path, guard the key.
- 🟡 **`:34-46`** — Three-level nesting (`NamedTemporaryFile` → `with open` → API/unlink/return). *Fix:* flatten.

## server/apps/blogs/utils/convert_to_mp3.py

- 🔴 **`:42-50`** 🛡️ ✅ — `CalledProcessError` is caught, logged, and the function **still returns `output_file` as if successful**; callers then use a non-existent file. *Fix:* re-raise or return a success flag.
- 🟠 **`:28`** — `# TODO: Handle case when file already exists` — ffmpeg without `-y` hangs on stdin waiting for overwrite confirmation if output exists, deadlocking the request. *Fix:* add `-y` or pre-check.
- 🟡 **`:34-38`** — Bitrate `96k`, sample rate `44100`, channels `2` are unexplained magic numbers.
- 🟡 **`:16-21`** — Docstring missing a `Returns:` section (Google convention).

## server/apps/blogs/utils/get_file_mimetype.py

- 🔴 **`:9-19`** 🛡️ — `subprocess.run` without `check=True`: a failing `file` command still has its `stdout` read, returning empty/garbage MIME silently; no check that `file_path` exists. *Fix:* `check=True`, validate input.
- 🟠 **`:20-22`** — Bare `except Exception` returns the magic string `'unknown'`, which callers then pass as an (invalid) Content-Type. *Fix:* narrow exceptions; signal failure.
- 🟡 **`:7`** — No type hints / docstring, unlike sibling `media.py`.

## server/apps/blogs/utils/media.py

- 🟠 **`:31-33`** — `except Exception` returns `None`, masking programming errors (e.g. `ValueError` from `float('')`). *Fix:* catch `(subprocess.CalledProcessError, ValueError)`.
- 🟡 **`:9`** — `Optional[timedelta]` (older style); project targets 3.13 where `timedelta | None` is idiomatic.

## server/apps/blogs/utils/__init__.py

- 🟡 **`:1-4`** — `get_file_mime_type` isn't re-exported while `convert_to_mp3`/`get_media_duration` are, so imports of it use the full path elsewhere — inconsistent surface.

## server/apps/blogs/admin.py

- 🟠 **`:23-46`** — `list_display` includes `get_media_type`/`get_media_duration` which dereference `obj.media` per row → N+1 in the changelist. *Fix:* `list_select_related = ('media','author')`.
- 🟡 **`:38-46`** — Old `func.short_description = …` pattern instead of `@admin.display(description=…)` (avoids the pyright-ignores at :41,:46).

## server/apps/blogs/apps.py

- 🟡 **`:1-6`** — No `ready()`; the file-cleanup/duration logic in model overrides would be more robust as signals registered here. (Architectural note.)

## server/config/settings.py

- 🔴 **`:391-392`** 🛡️ ✅ — `AWS_DEFAULT_ACL='public-read'` + `AWS_QUERYSTRING_AUTH=False` → all media public & URLs unauthenticated.
- 🔴 **`:117-128`** 🛡️ — `ALLOWED_HOSTS` hardcodes multiple domains plus localhost (Host-header risk; env-drive it).
- 🔴 **`:218-219`** 🛡️ — Empty `AUTH_PASSWORD_VALIDATORS` under DEBUG.
- 🔴 **`:70-101`** 🛡️ — `check_and_create_env_file()` fabricates a fresh `SECRET_KEY`; fail fast instead.
- 🔴 **(file)** 🛡️ — Missing production SSL/cookie/HSTS/nosniff headers.
- 🟠 **`:383-397,508`** — S3/R2/OpenAI config read via raw `os.getenv` while the rest uses `environs` `env(...)`; missing keys silently become `None`. *Fix:* `env.str(..., default=...)` consistently + validate.
- 🟠 **`:388`** — `AWS_S3_ENDPOINT_URL = f"https://{os.getenv('R2_ACCOUNT_ID')}.{os.getenv('R2_ENDPOINT_DOMAIN')}"` builds `https://None.None` when unset. *Fix:* validate presence first.
- 🟠 **`:24-60` vs `256-333`** — `LOGGING` is defined and `dictConfig`'d early, then fully overwritten (`copy.deepcopy(DEFAULT_LOGGING)`) and reassigned at :333; the early config is dead/wasted. *Fix:* one LOGGING definition.
- 🟠 **`:258,266`** — `import copy` / `import os` placed mid-file/inside a function (`os` already imported at top). *Fix:* move to top.
- 🟠 **`:147-149`** — Dev-only apps (`django_extensions`, `whitenoise.runserver_nostatic`) shipped to prod unconditionally. *Fix:* gate on DEBUG.
- 🟠 **`:353-374`** — `CORS_ALLOWED_ORIGINS` hardcodes `127.0.0.1:8000` (+ commented dead line) and `CSRF_TRUSTED_ORIGINS` duplicates the prod domain list. *Fix:* one env-driven source.
- 🟡 **`:306`** — Magic `10485760`; use `10 * 1024 * 1024`.
- 🟡 **`:265,272`** — Param `logging` shadows the stdlib module; `os.mkdir` should be `os.makedirs(exist_ok=True)`.
- 🟡 **`:281-297`** — Large commented-out dead symlink code.
- 🟡 **`:413-414`** — `os.makedirs(MEDIA_ROOT)` without `exist_ok=True` (race-prone).
- 🟡 **`:463-485`** — Hardcoded CSP hash magic strings with no traceability to their source template.
- 🟡 **`:4-10,107`** — Stale comments referencing Django 3.2.2 / 5.1 (project is 5.2.5).

## server/config/urls.py

- 🟠 **`:60,70`** — Catch-all `re_path('', index)` swallows unmatched API paths and returns HTML to API clients, masking 404s. *Fix:* stricter pattern / explicit prefixes.
- 🟡 **`:64-65`** — Media served via `static()` only under DEBUG; local-storage media in production 404s silently. *Fix:* document/handle the non-S3 prod case.

## server/apps/auth/views.py

- 🟠 **`:23-24,77-82`** 🛡️ — No throttling on login/signup; `logout` accepts `GET`.
- 🟠 **`:30,48`** 🛡️ — `json.loads(request.body)` with no try/except → 500 on bad JSON.
- 🟠 **`:42`** — `login` returns `JsonResponse(user_id, safe=False)` — a bare integer, inconsistent with object responses elsewhere. *Fix:* `{'user_id': …}`.
- 🟠 **`:7-8`** — `validate_password`/`ValidationError` imported but unused (dead). *Fix:* remove or actually validate.
- 🟡 **`:23,85`** — `csrf`/`status` lack docstrings.
- 🟡 **`:11,77`** — Double-quote string drift vs single-quote convention.
- 🟡 **(all)** — No type hints on view functions.

## server/apps/uploads/views.py

- 🔴 **`:20,75`** 🛡️ ✅ — No auth on presigned-URL endpoints.
- 🔴 **`:28`** 🛡️ ✅ — Path traversal via unsanitized `file_name` in the S3 key.
- 🔴 **`:24-26`** 🛡️ ✅ — No error handling / content-type validation on the JSON body.
- 🔴 **`:28`** 🛡️ — Hardcoded anonymous fallback `user_id = … else 2`. *Fix:* named setting; resolve the anonymous user explicitly.
- 🟠 **`:76`** — `Post.objects.get(id=post_id)` with no `DoesNotExist` handling and no per-post authorization. *Fix:* `get_object_or_404` + authorize.
- 🟠 **`:20-21,56-57`** — Manual `if request.method == 'POST'` / 405 instead of `@require_POST`. *Fix:* use the decorator.
- 🟠 **`:69`** 🛡️ — 1-hour presigned GET expiry vs ~1-minute frontend cache; over-exposed.
- 🟡 **`:22`** — `import json` inside the function body.
- 🟡 **`:34-40`** — `file_name.rsplit('.', 1)[1]` IndexErrors on extensionless names; extension-splitting duplicated.
- 🟡 **`:62,71`** — Dead `TODO`s about caching signed URLs.
- 🟡 **(all)** — No type hints/docstrings.

## server/apps/website/views.py

- 🔴 **`:14-46`** 🛡️ — Dev path-traversal via unsanitized `request.path` (see 01-security).
- 🟠 **`:26-38`** — `get_content_response_type_for_file` returns `None` for unknown extensions (→ `content_type=None`) and `filename.rsplit('.',1)[1]` IndexErrors on dotfiles. *Fix:* use `mimetypes`; guard the split.
- 🟡 **`:14-21`** — Implicit `return` (None) branch relied on by a walrus; imports inside the function body; no docstrings/type hints.

## server/apps/users/management/commands/init_users.py

- 🔴 **`:25`** 🛡️ ✅ — Hardcoded `admin/admin` superuser.
- 🟠 **`:39`** 🛡️ ✅ — Anonymous user has no `set_unusable_password()` / `is_active=False`.
- 🟠 **`:17-22,32`** — State inferred from magic counts (`>= 2`, `== 0`) rather than checking for the specific admin/anonymous usernames; fragile if other users exist.
- 🟡 **`:22,29`** — Mixes `sys.exit()` and bare `exit()` (a REPL builtin); a command should `return`/raise `CommandError`.
- 🟡 **`:4,33-34`** — Imports `CommandError` but never uses it; reads creds via `input()`/`getpass()` instead of command args (blocks non-interactive use).

## Empty / boilerplate files (dead code)

- 🟡 **`server/apps/auth/models.py:1-3`** — Only imports `models`; nothing defined.
- 🟡 **`server/apps/users/views.py:1-3`** — Only imports `render`; nothing defined.
- 🟡 **`server/apps/users/models.py:5-6`** — `class User(AbstractUser): pass` with no docstring.

## Cross-cutting (backend)

- 🟠 **App registration** — `settings.py` `INSTALLED_APPS` registers `apps.users/website/blogs` but **not** `apps.auth`/`apps.uploads`, whose views are imported in `urls.py`. Relying on importable-but-unregistered apps means no app config/migrations/checks. *Fix:* register all apps.
- 🟠 **`ANONYMOUS_USER_ID = 2`** is a magic number duplicated in `views.py:perform_create` and `uploads/views.py:28`. *Fix:* a single setting/constant.
- 🟡 **Logging inconsistency** — f-strings in log calls (models/views/utils) vs lazy `%s` formatting (`transcription.py`, `convert_to_mp3.py`); Django/ruff prefer `%s`.
