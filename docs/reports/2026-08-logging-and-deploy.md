# Production logging, and the deploy that carried it (2026-08-02 → 08-04)

Tam's request was three words — **"review PR 11"** — against a small, plainly-correct-looking
logging fix. The review found the PR made production *worse* than the bug it fixed, which
turned into two follow-up commits, a merge, the first Fly deploy since 2026-07-11 (32 commits,
including Django 6.1rc1), and a committed post-deploy check.

## What PR #11 fixed, and the hole it opened

The original commit (`f105a17`) was right about its bug. Loggers created as
`getLogger(__name__)` under `server/apps/` resolve to names like `apps.blogs.views`, and
`LOGGING` configured only `server` and `server.apps` — so 14 call sites across 14 files matched
nothing, inherited the root logger, and never reached the rotating error file. The PR added an
`apps` entry pointing at `['console', 'file_errors']`.

`console` comes from Django's `DEFAULT_LOGGING`, and **it carries a `require_debug_true`
filter** — under `DEBUG=False` it drops every record it receives. So in production the PR left
`file_errors` as the only surviving destination. Measured on both branches, emitting an
exception from `apps.blogs.views` with `DEBUG=False`:

| | stderr | error file |
|---|---|---|
| `main` (unconfigured logger) | message **+ full traceback** | nothing |
| PR branch | **nothing** | traceback |

The unconfigured state had a safety net the configured state removed: an unhandled record falls
through to `logging.lastResort`, a `_StderrHandler(WARNING)` using the default formatter — which
does append tracebacks. Configuring the logger *replaced* that net with a filtered handler.
And `fly logs` streams the container's stdout/stderr, while the error file lives at `/log`
(BASE_DIR is `/code`, so `BASE_DIR/'..'/log` resolves to `/log`) — the container filesystem,
not the `/data` volume. Every deploy wipes it, and reading it at all needs `fly ssh`.

Net effect had it merged as-is: the seven modules whose tracebacks were previously visible in
`fly logs` would have gone silent there, in exchange for a file that resets on deploy.

`48b2d8c` fixed it with `app_console` — an unfiltered `StreamHandler` twin of `console` — plus
an `app` formatter (`{levelname} {asctime} {name} {message}`; `{name}` not `{module}`, which
would render both `blogs/views.py` and `users/views.py` as a bare `views`).

**`app_console` is pinned to `level: INFO`, and that detail was nearly missed.** The first
instinct was to leave it unlevelled. Grepping the call sites first found
`server/apps/blogs/transcription.py:44` doing `logger.debug('Transcription: %s', ...)` on a
DEBUG-level logger — an unlevelled handler would have streamed entire transcripts to production
stderr.

## The second hole: Django's own errors

`48b2d8c` deliberately left the `django` logger on the filtered `console`, on the reasoning that
an unfiltered handler would log a WARNING for every 404 — bot-scan noise on a public site. That
reasoning was right about the cost and **wrong about the conclusion, because it never measured
what the cost was buying.** Probing `django.request` under `DEBUG=False` produced nothing at all
on stderr: unhandled 500 tracebacks were reaching no visible destination in production. A wider
hole than the one the PR set out to fix — the app loggers carry *caught* exceptions; this is the
uncaught ones.

The objection argued for a surgical fix, not for leaving it. `298f9ed` added `console_errors`:
level `ERROR`, filter `require_debug_false` — the stderr twin of `file_errors`, firing exactly
when it does. Tracebacks reach the log stream; 404 WARNINGs still do not; `require_debug_false`
keeps development output byte-identical.

Separately verified: `sentry_sdk` patches `logging.Logger.callHandlers`
(`integrations/logging.py:192`), so the `propagate: False` on the app loggers hides nothing from
Sentry. The propagation choice carries no hidden cost.

## Tests that assert survival, not configuration

`server/apps/blogs/tests/test_logging.py` AST-scans `apps/` for `getLogger` calls, resolving
`getLogger(__name__)` statically to the module's dotted name, then asserts against every one.
The load-bearing design decision: **the tests check the handlers a record *survives*, not the
ones it reaches.** A hierarchy walk alone reports a `require_debug_true`-only logger as fully
configured — that is exactly the defect that shipped. `handlers_accepting_errors()` builds a real
`LogRecord` and applies each handler's own level and filters, so it reflects the mode it runs in.
Django's test runner forces `DEBUG=False`, which is the production configuration for free.

Six tests. Reverting only the handler wiring fails
`test_errors_reach_the_process_output_stream` on all 14 call sites and nothing else; reverting
`settings.py` wholesale fails 28 subtests across 3 tests.

## The deploy (release v162)

Merged as `c8c3ebf`, then deployed — the first since 2026-07-11, carrying **32 commits**: all of
PR #10 (Django 5.2.5 → **6.1rc1**, a release candidate; React/Vite/TS majors; R2 and rate-limit
fixes), the two feature commits stranded on main since 07-16, and this logging work.

Zero migrations, so the normal one-liner path applied and the runbook's park-on-sleep dance
stayed unused. Volume snapshotted first. Machine restarted in 14s, health green 11s after boot,
`No migrations to apply`, no errors since. The `app is not listening on the expected address`
WARNING mid-deploy is benign — Fly probing during the ~7s that boot-migrate runs before gunicorn
binds.

## Verification that had to be handed over

`fly deploy`, `fly ssh console`, and even a `curl` to a 404 path were each blocked by Claude
Code's auto-mode permission classifier. Tam ran the deploy via `!`; the endpoint checks
(`/healthz/`, `/api/posts/`, machine status, boot logs) were doable from outside, but confirming
the *logging* fix against the live process was not — leaving the deploy verified and the thing
it was for unverified.

So the check became a committed artifact instead of a one-off: `admin/prod/check-logging.sh`
(`just fly-check-logging`, `4db328d`). It opens one `fly ssh console -C`, asks the running
process which handlers an ERROR and a WARNING each survive for both an app logger and
`django.request`, and prints pass/fail per expectation. The probe is base64'd rather than quoted
through three shells; the verdict is read from stdout because flyctl does not reliably propagate
a remote exit status. Verified against local settings both ways before shipping: `DEBUG=False`
passes all four, `DEBUG=True` fails three with expected-vs-got diffs.

Tam's first real run returned `RESULT: PASS` on all four — including
`django.request @ WARNING -> (none)`, the row that proves 500s reach the stream while bot scans
stay out. `/log/server-errors.log` read **0 bytes**: no errors since boot, and the ephemerality
claim demonstrated rather than argued (the local copy of the same file is 205 KB).

## Commit map

| Commit | Date | What |
|---|---|---|
| `f105a17` | 07-30 | route `apps.*` loggers into the error log (the PR as opened) |
| `48b2d8c` | 08-02 | `app_console` — keep app errors on stderr, not only the ephemeral file |
| `298f9ed` | 08-03 | `console_errors` — Django's own 500 tracebacks back on stderr |
| `c8c3ebf` | 08-03 | merge PR #11 |
| — | 08-03 | deploy: release v162, image `deployment-01KZ59M89ZZ74P1X9AKQFP9FBZ` |
| `4db328d` | 08-04 | `just fly-check-logging` + docs |

## Lessons

- **Reaching a handler is not being emitted by it.** Level and filters decide, and both are
  invisible to "is this logger configured?" Any check worth writing asks what survives.
- **Configuring a logger can silence it.** `logging.lastResort` covers the unconfigured case, so
  a partial fix can strictly lose ground against the bug. Compare against the *old* behaviour,
  not against nothing.
- **Measure before deferring.** The `django` logger was left out on a cost that was real and a
  benefit never checked; one probe showed the benefit was zero and reversed the call. A deferral
  is a claim about what you'd lose, and claims get measured.
- **Grep the call sites before picking a handler level.** One `logger.debug` of a full transcript
  is the difference between a stream you read and one you scroll past.
- **When you can't verify something yourself, ship the verification.** The classifier blocking
  prod access produced a better artifact than the check would have been otherwise — repeatable,
  committed, and in the runbook rather than in a transcript.
- **A green deploy is not a verified fix.** Health checks passed the entire time the logging was
  broken; that is what made the original bug survivable in the first place.

## Still open

Carried into `docs/feature-backlog.md` (Ops backlog / Tech debt & pins to unwind), which is
the durable home — this report is a snapshot and will not be updated as these close.

- **`SENTRY_DSN` is unset.** Now the only gap in error visibility: stderr is correct, but Fly's
  log retention is short and the error file resets each deploy, so "what broke last Tuesday" is
  still unanswerable. Already env-gated in `settings.py` — one variable, no code.
- **Making `/log` persistent was considered and declined.** It would need conditional dev/prod
  path logic for a file that now duplicates stderr and still wouldn't give durable history.
  Sentry is the answer to what that change was reaching for.
- **Production runs Django 6.1rc1.** Repin `pyproject.toml` to `6.1` final when it ships (PyPI's
  latest stable was still 6.0.7 on 2026-08-03). Two other unwinds ride with it: delete
  `server/config/drf_django61_compat.py` once DRF supports Django 6.1, and collapse the TS6/TS7
  alias split once typescript-eslint does (see CLAUDE.md, "Two TypeScript versions").
