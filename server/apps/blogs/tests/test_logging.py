"""Regression tests for logger configuration across server/apps/.

A logger whose name matches no entry in LOGGING inherits the root logger: no
handlers, and an effective level of WARNING. Nothing raises and nothing warns —
the records simply stop arriving, so the gap is invisible until someone goes
looking for a stack trace that was never written. These tests make that
condition fail out loud instead.

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
        for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
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


def reaches_a_handler(name):
    """Whether a record logged to `name` finds a handler, mirroring callHandlers."""
    current = logging.getLogger(name)
    while current:
        if current.handlers:
            return True
        current = current.parent if current.propagate else None
    return False


class LoggerConfigurationTests(SimpleTestCase):
    """Every logger under apps/ must reach a handler at a usable level."""

    def test_the_scan_finds_the_call_sites(self):
        """Guard the scan itself — one that matched nothing would pass silently."""
        found = list(declared_loggers())
        self.assertGreaterEqual(len(found), 10)
        self.assertGreaterEqual(len({path for _, path in found}), 10)

    def test_every_logger_reaches_a_handler(self):
        """An unconfigured name inherits root, and its records go nowhere useful."""
        for name, path in declared_loggers():
            with self.subTest(logger=name, source=path):
                self.assertTrue(
                    reaches_a_handler(name),
                    f'Logger {name!r} ({path}) resolves to no handler, so its records '
                    'fall through to logging.lastResort — bare stderr, never reaching '
                    'the file_errors log. Add its prefix to LOGGING in config/settings.py.',
                )

    def test_every_logger_emits_at_info(self):
        """Reaching a handler is moot if the effective level discards the record."""
        for name, path in declared_loggers():
            with self.subTest(logger=name, source=path):
                self.assertLessEqual(
                    logging.getLogger(name).getEffectiveLevel(),
                    logging.INFO,
                    f'Logger {name!r} ({path}) has an effective level above INFO, so '
                    'its info() calls are dropped before reaching a handler.',
                )
