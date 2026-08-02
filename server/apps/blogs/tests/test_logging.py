"""Regression tests for logger configuration across server/apps/.

A logger whose name matches no entry in LOGGING inherits the root logger: no
handlers, and an effective level of WARNING. Nothing raises and nothing warns —
the records simply stop arriving, so the gap is invisible until someone goes
looking for a stack trace that was never written. These tests make that
condition fail out loud instead.

Two of them assert against the *handlers a record actually survives*, not just
the ones it reaches. Reaching a handler is not enough: `console` carries a
require_debug_true filter, so a logger wired only to it goes silent the moment
DEBUG is False — a hole that a hierarchy walk alone reports as configured. The
suite runs with DEBUG=False (Django forces it), which is exactly the production
configuration those two tests need.

Config-level, but housed here because `apps/blogs/tests/` is the discoverable
tests package (`apps/uploads/` has no `__init__.py`), matching test_csp_hashes
and test_drf_compat.
"""

import ast
import logging
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

APPS_ROOT = Path(settings.BASE_DIR) / 'apps'


def module_name_for(path):
    """Return the dotted name `path` is imported under.

    server/ is the import root, so server/apps/blogs/views.py is imported as
    `apps.blogs.views` — which is exactly what `__name__` evaluates to there.
    """
    parts = path.relative_to(settings.BASE_DIR).with_suffix('').parts
    if parts[-1] == '__init__':
        parts = parts[:-1]
    return '.'.join(parts)


def declared_loggers():
    """Yield `(logger_name, source_path)` for every getLogger call under apps/.

    Resolves `getLogger(__name__)` statically to the name the module is imported
    under, so both naming conventions in this tree are covered by one scan.
    Calls whose argument is neither `__name__` nor a string literal are skipped:
    their name is not knowable without running the code.
    """
    for path in sorted(APPS_ROOT.rglob('*.py')):
        if 'migrations' in path.parts:
            continue
        source = path.read_text(encoding='utf-8')
        for node in ast.walk(ast.parse(source, filename=str(path))):
            if not (isinstance(node, ast.Call) and node.args):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, 'id', None)
            if name != 'getLogger':
                continue
            arg = node.args[0]
            if isinstance(arg, ast.Name) and arg.id == '__name__':
                yield module_name_for(path), path
            elif isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                yield arg.value, path


def reachable_handlers(name):
    """Yield the handlers a record logged to `name` visits, mirroring callHandlers."""
    current = logging.getLogger(name)
    while current:
        yield from current.handlers
        current = current.parent if current.propagate else None


def handlers_accepting_errors(name):
    """Yield the handlers that would actually emit an ERROR record from `name`.

    Reachability is not acceptance — a handler still discards the record if its
    own level is higher or one of its filters rejects it. The filters that
    matter here (require_debug_true / require_debug_false) read settings.DEBUG
    when called, so this reflects whatever mode the caller is running in.
    """
    record = logging.LogRecord(name, logging.ERROR, __file__, 0, 'probe', None, None)
    for handler in reachable_handlers(name):
        if record.levelno >= handler.level and handler.filter(record):
            yield handler


class LoggerConfigurationTests(SimpleTestCase):
    """Every logger under apps/ must reach a handler at a usable level."""

    def test_the_scan_finds_the_call_sites(self):
        """Guard the scan itself — one that matched nothing would pass silently."""
        found = list(declared_loggers())
        # A floor, not the true count (14 call sites across 14 files as of writing):
        # the point is to catch a scan that silently stops matching, not to make
        # every added or deleted logger a test edit.
        self.assertGreaterEqual(len(found), 10)
        self.assertGreaterEqual(len({path for _, path in found}), 10)

    def test_every_logger_reaches_a_handler(self):
        """An unconfigured name inherits root, and its records go nowhere useful."""
        for name, path in declared_loggers():
            with self.subTest(logger=name, source=path):
                self.assertTrue(
                    any(reachable_handlers(name)),
                    f'Logger {name!r} ({path}) resolves to no handler, so its records '
                    'fall through to logging.lastResort — bare stderr, never reaching '
                    'the file_errors log. Add its prefix to LOGGING in config/settings.py.',
                )

    def test_every_logger_emits_at_error(self):
        """Reaching a handler is moot if the effective level discards the record.

        ERROR rather than INFO deliberately: quieting a chatty module to WARNING
        is a legitimate choice, losing its stack traces never is.
        """
        for name, path in declared_loggers():
            with self.subTest(logger=name, source=path):
                self.assertLessEqual(
                    logging.getLogger(name).getEffectiveLevel(),
                    logging.ERROR,
                    f'Logger {name!r} ({path}) has an effective level above ERROR, so '
                    'its exception() calls are dropped before reaching a handler.',
                )

    def test_errors_reach_the_process_output_stream(self):
        """Production reads stderr — an error only in a file is an error nobody sees.

        Fly's log stream is the container's stdout/stderr. The error log itself
        sits on the ephemeral filesystem (BASE_DIR/../log), so it is wiped on
        every deploy and readable only over `fly ssh`. Wiring an app logger to a
        require_debug_true-filtered handler alone silently ends the deploy with
        no traceback anywhere useful.
        """
        for name, path in declared_loggers():
            with self.subTest(logger=name, source=path):
                streams = [
                    handler
                    for handler in handlers_accepting_errors(name)
                    # FileHandler subclasses StreamHandler, so exclude it to be
                    # left with the handlers writing to the process's own stream.
                    if isinstance(handler, logging.StreamHandler)
                    and not isinstance(handler, logging.FileHandler)
                ]
                self.assertTrue(
                    streams,
                    f'Logger {name!r} ({path}) has no stderr handler that survives '
                    'DEBUG=False, so its stack traces never reach the production log '
                    'stream. Wire it to `app_console`, not the filtered `console`.',
                )

    def test_errors_reach_the_error_log(self):
        """The rotating file is the point of setup_save_errorlog_to_file — use it."""
        for name, path in declared_loggers():
            with self.subTest(logger=name, source=path):
                files = [
                    handler
                    for handler in handlers_accepting_errors(name)
                    if isinstance(handler, logging.FileHandler)
                ]
                self.assertTrue(
                    files,
                    f'Logger {name!r} ({path}) reaches no file handler under '
                    'DEBUG=False, so its errors never land in log/server-errors.log.',
                )
