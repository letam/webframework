# Incidents and lessons (2026-07-01 → 07 session)

Companion to [project overview](2026-07-project-overview.md). The failures and near-misses, because they're worth more than the successes.

## The zombie watcher shell (2026-07-07 evening)

During Phase 3 Slice C, an `&` inside a `run_in_background` Bash command detached the codex process from harness tracking. To regain visibility a watcher shell was started: `while pgrep -f "codex exec" > /dev/null; do sleep 20; done; ...`. Slice C finished and was committed — but the watcher ran for **1h17m more**, because `pgrep -f "codex exec"` matches machine-wide and Tam's *other* Claude session was running its own codex build in a different repo. Worse: when Tam said "we have a shell running", the first sweep (pgrep patterns + TaskList) wrongly concluded nothing from this session was live — **TaskList lists todo-tasks, not background shells**, and none of the pgrep patterns matched the watcher's command line. Tam pasted the shell's status; grepping by the unique log filename (`pgrep -fl "slice-c-codex.log"`) found it instantly → PID 97117 killed; the follow-up "failed with exit code 144" notification was just the SIGTERM registering.

**Lessons:** (1) never put `&` inside a run_in_background command; (2) watchers must key on a specific PID or a unique substring (log path), never a generic program name; (3) TaskList ≠ background shells; (4) when hunting a process, grep for its unique artifact, not its category.

## Tooling gotchas (repo-specific, still true)

- **`[tool.ruff] fix = true` in pyproject makes bare `ruff check` MUTATE files.** It auto-fixed files during plain inspection twice (once mid-Phase-0, once mid-Slice-D judging — the latter reverted). Always `--no-fix` to inspect; CI pins `ruff@0.15.20 check --no-fix`.
- **The repo's working Python formatter is `uvx ruff format`, not black.** `[tool.black]` sets no line length, so `uvx black` reformatted 7 files at 88 cols and moved `# pyright: ignore` comments off their lines (CLAUDE.md's "black, line length 99" is misleading). `uvx ruff format` (99 cols, quote-preserving) restored everything.
- **`manage.py test` from the repo root silently discovers 0 tests** — the `apps` label is mandatory (`test apps`). Both the new CI gate and `just test` shipped with this flaw until codex review caught it.
- **`bun test` runs Bun's own runner, not Vitest** — use `bun run test`. `bunx` "Saved lockfile" output is cache noise, not a project bun.lock mutation (verified via git diff).
- **Dev architecture**: Django (:8000) proxies Vite (:5173); the app must be driven at :8000 for same-origin session auth. Port 8000 belongs to Tam's own dev server — never kill it; use a throwaway :8001 for smoke tests.
- **Bash background timeout is 10 min** — long codex runs must be `nohup ... & disown` with a separate waiter (correctly keyed, see above). `codex review` needs `--uncommitted` XOR a prompt, and `--base origin/main` on a clean tree.
- **`uv add` writes `>=` constraints** while the repo pins `==` — correct pyproject by hand, then `uv lock`.
- **werkzeug ranges are end-exclusive** (`bytes=0-499` → `(0, 500)`); HTTP Content-Range is end-inclusive. Two range bugs traced to this.
- Running manage.py with cwd=`server/` creates a junk `server/server/` dir (relative MEDIA_ROOT); settings.py auto-creates `.env` on fresh checkout (CI needs no env setup).
- django-tasks 0.12 split the DB backend into the separate `django-tasks-db` package (`django_tasks_db.DatabaseBackend`, `manage.py db_worker`).

## Judgment errors and course corrections

- **Falsely reported "nothing running"** before the watcher was found (above) — corrected by Tam.
- Phase 2 verification got stuck introspecting the clipboard for the share button; Tam rejected the tool call and said "i think you got stuck. proceed" — the right move was noting it as an environment-specific finding and moving on.
- `git push origin main` blocked twice by the permission classifier ("go" ≠ push authorization) — correctly treated as Tam-only; Tam later pushed the first three commits personally.
- A `sleep 90` foreground wait was blocked by the harness — background waiters/notifications are the pattern.
- An earlier attempt at this very report (2026-07-07 20:37) died to an API server error mid-response; the request was repeated after the shell cleanup and completed as these files.

## Review-layer scorecard (why the multi-model pipeline stayed)

Independent reviewers caught real bugs the author missed in every round: Phase 0 codex → fresh-DB `init_users` crash; Phase 1 fable-5 judge → werkzeug off-by-one; Phase 1 codex review → CI running zero tests + liked-cache staleness; review round (3 opus + codex) → five production-facing bugs ([review round](2026-07-review-round.md)). Conversely, every reviewer finding was re-verified against the code before patching — several plausible-sounding ones were confirmed-then-scoped rather than blindly applied.
