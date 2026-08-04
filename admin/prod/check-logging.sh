#!/usr/bin/env bash

# Verify the production logging wiring on a deployed Fly app.
#
# Errors are only useful where someone will see them. Two destinations matter:
# the container's stderr (what `fly logs` streams) and the rotating error file.
# Which handlers a record actually survives depends on DEBUG, handler levels,
# and the require_debug_* filters — none of which are visible from outside the
# machine, and all of which fail silently when wrong. This asks the running
# process directly.
#
# Usage: admin/prod/check-logging.sh [app-name]     (default: webframework)
#
# Exits 0 if every expectation holds, 1 otherwise.

set -euo pipefail

APP="${1:-webframework}"

if ! command -v fly &> /dev/null; then
    echo "fly not found. Install with: brew install flyctl" >&2
    exit 1
fi

# Base64 the probe rather than quoting it through `fly ssh console -C`, which
# would otherwise need escaping for the local shell, flyctl, and the remote
# shell in turn.
PROBE=$(cat <<'PY'
import logging

from django.conf import settings

# Handler sets each (logger, level) pair must resolve to under DEBUG=False.
# dictConfig stamps every handler with its settings.py key, so these are the
# names from LOGGING, not class names.
EXPECTED = {
    ('apps.blogs.views', 'ERROR'): ({'app_console', 'file_errors'},
                                    'app errors reach stderr AND the error log'),
    ('apps.blogs.views', 'WARNING'): ({'app_console'},
                                      'warnings hit stderr only (file_errors is ERROR-level)'),
    ('django.request', 'ERROR'): ({'console_errors', 'file_errors'},
                                  'unhandled 500 tracebacks reach the log stream'),
    ('django.request', 'WARNING'): (set(),
                                    '404s stay OUT of the log stream (bot-scan noise)'),
}


def surviving(name, level):
    """Return the handlers that would actually emit a record, not merely see it.

    Mirrors Logger.callHandlers for reachability, then applies each handler's
    own level and filters — the require_debug_* ones read settings.DEBUG when
    called, so this reflects the mode the process is really running in.
    """
    handlers, node = [], logging.getLogger(name)
    while node:
        handlers += node.handlers
        node = node.parent if node.propagate else None
    probe = logging.LogRecord(name, level, 'probe', 0, 'probe', None, None)
    return {
        handler.name or type(handler).__name__
        for handler in handlers
        if probe.levelno >= handler.level and handler.filter(probe)
    }


failures = []

print(f'DEBUG = {settings.DEBUG}')
if settings.DEBUG:
    failures.append('DEBUG is True — this is not a production configuration')
print()

for (name, levelname), (expected, why) in EXPECTED.items():
    actual = surviving(name, getattr(logging, levelname))
    ok = actual == expected
    if not ok:
        failures.append(
            f'{name} @ {levelname}: expected {sorted(expected)}, got {sorted(actual)}'
        )
    print(f'[{"OK" if ok else "FAIL"}] {name:17} @ {levelname:7} -> {sorted(actual) or "(none)"}')
    print(f'       {why}')

# `console` is require_debug_true, so it must survive nothing here. If it shows
# up above, DEBUG leaked into production — a bigger problem than logging.
log_path = settings.BASE_DIR / '..' / 'log' / 'server-errors.log'
print()
if log_path.exists():
    print(f'error log: {log_path.resolve()} ({log_path.stat().st_size} bytes)')
    print('       NOTE: on Fly this path is the container filesystem, not the')
    print('       /data volume — it is wiped on every deploy. stderr is the')
    print('       durable-ish destination; Sentry is the real one.')
else:
    failures.append(f'error log missing at {log_path}')
    print(f'error log: MISSING at {log_path}')

print()
if failures:
    print('RESULT: FAIL')
    for failure in failures:
        print(f'  - {failure}')
else:
    print('RESULT: PASS')
PY
)

B64=$(printf '%s' "$PROBE" | base64 | tr -d '\n')

echo "Probing logger configuration on '$APP'..."
echo

# Django's shell -c execs the string; exec() takes the decoded bytes directly.
OUTPUT=$(fly ssh console -a "$APP" \
    -C "python /code/manage.py shell -c \"import base64;exec(base64.b64decode('$B64'))\"" 2>&1) || true

echo "$OUTPUT"
echo

# Decide locally on the printed verdict rather than the remote exit status —
# flyctl does not reliably propagate it.
if grep -q 'RESULT: PASS' <<< "$OUTPUT"; then
    exit 0
fi

if ! grep -q 'RESULT: FAIL' <<< "$OUTPUT"; then
    echo "Probe did not run to completion — see the output above." >&2
    echo "If it never connected: check 'fly status -a $APP' and that you are logged in." >&2
fi
exit 1
