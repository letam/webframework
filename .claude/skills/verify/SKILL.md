---
name: verify
description: Build, launch, and drive this app (Django API + React feed) to verify changes end-to-end at runtime.
---

# Verifying changes in this repo

## Launch

```bash
uv run python server/manage.py migrate            # apply pending migrations first
uv run python server/manage.py runserver 8000 --noreload   # backend (background)
cd app && bun dev                                  # frontend on 5173 (background)
curl -s localhost:8000/healthz/                    # {"status": "ok"} when ready
```

Verify in the browser at **http://localhost:8000/** (not 5173) — Django proxies Vite in dev
and applies the real CSP headers there; 5173 bypasses CSP entirely. Vite HMR still works
through the proxy, but `--noreload` means **backend changes need a server restart**
(`lsof -ti:8000 | xargs kill`).

## Driving the API with curl

CSRF is a GET that returns `{"token": ...}` and sets the cookie:

```bash
JAR=$(mktemp)
CSRF=$(curl -s -c $JAR localhost:8000/auth/csrf/ | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
curl -s -b $JAR -X POST localhost:8000/api/posts/ \
  -H "X-CSRFToken: $CSRF" -H 'Content-Type: application/json' \
  -H 'Referer: http://localhost:8000/' -d '{"head":"...","body":"..."}'
```

- The `Referer` header is required (Django CSRF origin checking).
- Unauthenticated posts are created as the `anonymous` user — but anonymous users cannot
  edit them (PATCH → 401). For edit/delete flows, create a user via
  `manage.py shell` (`create_user`) and POST `/auth/login/` with the same JAR, then re-fetch
  the CSRF token (it rotates on login).
- Task side effects (transcription, link-preview fetches) run **inline** in dev
  (`TASKS_IMMEDIATE` defaults to DEBUG), so create/update responses already include them —
  and they hit the real network.

## Driving the UI (Playwright MCP)

- First visit shows a **"Community Ground Rules" modal** — close it (X button) before
  interacting with the feed.
- Posts carry `data-testid="post-<id>"`; link preview cards carry
  `data-testid="link-preview-<kind>"`.
- Theme: header "Toggle theme" button opens a menu with Light/Dark/System items.
- Two console errors are pre-existing noise: a blocked `cdn.gpteng.co/gptengineer.js`
  script and the resulting `/csp-report/` 403. Ignore them; anything else is real.
- Playwright MCP writes screenshots to the repo root / `.playwright-mcp/` — move them out
  before committing.

## Cleanup

Delete test posts via ORM (`Post.objects.get(pk=...).delete()` — exercises file-cleanup
overrides) and remove any test users you created.
