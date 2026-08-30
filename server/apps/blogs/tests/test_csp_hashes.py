"""Regression tests for production CSP hashes on inline template blocks."""

import ast
import base64
import hashlib
import os
import re

from django.conf import settings
from django.test import SimpleTestCase

from . import BaseTestCase

# The SPA shell as authored, and as built by `bun run build` +
# admin/prod/build-prod.sh (or the Dockerfile). The built copy is gitignored, so
# it only exists after a production build.
SOURCE_SHELL = settings.BASE_DIR.parent / 'app' / 'index.html'
BUILT_SHELL = (
    settings.BASE_DIR / 'apps' / 'website' / 'templates' / 'website' / 'dist' / 'index.html'
)

# CI's e2e job builds the shell before running this module and sets this, so a
# missing build there is a broken gate rather than a quietly skipped test.
REQUIRE_BUILT_SHELL = os.environ.get('REQUIRE_BUILT_SHELL') == '1'

SETTINGS_SOURCE = settings.BASE_DIR / 'config' / 'settings.py'

# The CSP directive that enforces each inline tag's body: a <script> is hashed
# against script-src, a <style> against style-src. Keying on this is the whole
# point of the rewrite — a hash allowlisted only under the *other* directive
# must fail here exactly as the browser rejects it in production.
TAG_DIRECTIVE = {'script': 'script-src', 'style': 'style-src'}


def allowlisted_hashes_by_directive():
    """Map each CSP directive to the ``'sha256-…'`` source-expressions it allows.

    Read from the settings *source* via AST, not from the resolved
    ``settings.CONTENT_SECURITY_POLICY``. The resolved directives are built once
    at import from the ambient ``DEBUG``, so a developer running the suite with
    ``DEBUG=True`` gets the debug branch — ``'unsafe-inline'`` and no hashes at
    all — and a test reading it would silently check nothing. The production
    hashes live in the ``else`` branch of ``settings.py`` unconditionally, so the
    AST sees them whatever ``DEBUG`` is set to.

    Bucketing each hash under the directive key it sits below — rather than
    unioning every ``'sha256-…'`` literal in the file, as the old regex did —
    is what makes a misfiled hash (a style hash under ``script-src``) fail. AST
    also ignores comments, so a hash left behind in a comment no longer keeps a
    since-changed block passing.
    """
    tree = ast.parse(SETTINGS_SOURCE.read_text(encoding='utf-8'), filename=str(SETTINGS_SOURCE))
    hashes = {directive: set() for directive in TAG_DIRECTIVE.values()}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        # An ast.Dict always has parallel, equal-length keys/values, so strict
        # is both correct and what B905 wants.
        for key, value in zip(node.keys, node.values, strict=True):
            if not (isinstance(key, ast.Constant) and key.value in hashes):
                continue
            if not isinstance(value, ast.List):
                continue
            for element in value.elts:
                if (
                    isinstance(element, ast.Constant)
                    and isinstance(element.value, str)
                    and element.value.startswith("'sha256-")
                ):
                    hashes[key.value].add(element.value)
    return hashes


def inline_blocks(html):
    """Yield `(tag, body)` for every inline <style>/<script> block in `html`.

    Inline means "has a body the browser hashes", which is decided by the absence
    of ``src``, not by the absence of attributes: ``<script type="module">…</script>``
    is inline and needs a hash, and this repo already writes them that way (see
    apps/website/templates/website/index.html). Matching only bare ``<script>``
    would skip those silently while the browser still enforced a hash. A tag
    *with* src is an external reference, covered by the 'self' source instead.
    """
    for tag in ('style', 'script'):
        for body in re.findall(rf'<{tag}(?![^>]*\ssrc=)[^>]*>(.*?)</{tag}>', html, re.S):
            yield tag, body


class InlineBlockDetectionTests(SimpleTestCase):
    """Cover the detection itself, which decides what the hash tests can see.

    A scan that silently matches nothing passes exactly as loudly as one that
    matches everything — the failure mode this whole module exists to prevent.
    """

    def test_attributed_inline_script_is_found(self):
        """`<script type="module">` has a body the browser hashes."""
        found = list(inline_blocks('<script type="module">console.log(1)</script>'))
        self.assertEqual(found, [('script', 'console.log(1)')])

    def test_bare_inline_script_is_found(self):
        """The original bare-tag case must keep working."""
        self.assertEqual(
            list(inline_blocks('<script>console.log(1)</script>')),
            [('script', 'console.log(1)')],
        )

    def test_attributed_inline_style_is_found(self):
        """Styles have no src, so attributes still leave them inline."""
        self.assertEqual(
            list(inline_blocks('<style media="screen">body{color:red}</style>')),
            [('style', 'body{color:red}')],
        )

    def test_external_script_is_ignored(self):
        """A src'd tag is covered by the 'self' source, not by a hash."""
        html = '<script type="module" crossorigin src="/static/app/index.js"></script>'
        self.assertEqual(list(inline_blocks(html)), [])


class CspHashTests(BaseTestCase):
    """Verify inline styles and scripts have production CSP hashes."""

    def setUp(self):
        """Collect the hashes allowlisted in settings.py, per directive."""
        super().setUp()
        self.hashes_by_directive = allowlisted_hashes_by_directive()

    def test_the_scan_finds_the_allowlisted_hashes(self):
        """Guard the scan itself — one that matched nothing would pass silently.

        Floors, not exact counts (3 script + 9 style as of writing): the point is
        to catch an AST walk that stops matching, not to make every added or
        removed hash a test edit.
        """
        self.assertGreaterEqual(len(self.hashes_by_directive['script-src']), 1)
        self.assertGreaterEqual(len(self.hashes_by_directive['style-src']), 3)

    def no_build(self, message):
        """Skip for want of a production build — unless CI promised to make one."""
        if REQUIRE_BUILT_SHELL:
            self.fail(f'REQUIRE_BUILT_SHELL is set but the build is unusable: {message}')
        self.skipTest(message)

    def assert_inline_blocks_allowlisted(self, path):
        """Assert every inline <style>/<script> block in `path` is hash allowlisted.

        Each block is checked against the directive that actually enforces it —
        a <style> against style-src, a <script> against script-src — so a hash
        filed under the wrong directive fails here as it would in the browser.
        """
        for tag, block in inline_blocks(path.read_text()):
            with self.subTest(template=path, tag=tag, block=block):
                self.assertNotIn('{{', block)
                self.assertNotIn('{%', block)
                digest = base64.b64encode(hashlib.sha256(block.encode()).digest()).decode()
                directive = TAG_DIRECTIVE[tag]
                self.assertIn(
                    f"'sha256-{digest}'",
                    self.hashes_by_directive[directive],
                    f'{tag} block in {path} is not hash-allowlisted under {directive} in '
                    f'settings.py:\n{block!r}',
                )

    def test_inline_template_blocks_are_hash_allowlisted(self):
        """Every production inline style and script block should be hash allowlisted."""
        template_paths = [
            settings.BASE_DIR / 'templates' / 'shared' / 'base.html',
            settings.BASE_DIR / 'templates' / 'shared' / 'header.html',
            settings.BASE_DIR / 'apps' / 'blogs' / 'templates' / 'blogs' / 'post_detail.html',
            settings.BASE_DIR / 'apps' / 'blogs' / 'templates' / 'blogs' / 'rate_limited.html',
            # Production serves website/dist/index.html, built from app/index.html.
            # apps/website/templates/website/index.html is intentionally absent: it is
            # DEBUG-only, and the DEBUG CSP branch uses UNSAFE_INLINE, so its hashes
            # are never enforced.
            SOURCE_SHELL,
        ]

        for template_path in template_paths:
            self.assert_inline_blocks_allowlisted(template_path)

    def test_built_shell_blocks_are_hash_allowlisted(self):
        """The shell the browser actually gets must match the allowlist too.

        The test above hashes `app/index.html`, the source. The browser hashes
        Vite's output. They are byte-identical today because Vite passes bare
        inline blocks through untouched, but that is a property of the bundler,
        not a guarantee — and if it ever changes, the source-based test still
        passes while production silently blocks its own anti-FOUC script.

        Skipped when there is no production build, or when the one on disk
        predates the source, so `manage.py test` stays green on a clean checkout
        and a stale local artifact does not report a break that isn't there.
        With REQUIRE_BUILT_SHELL=1 (CI) those become failures instead.
        """
        if not BUILT_SHELL.is_file():
            self.no_build(f'No production build at {BUILT_SHELL}; run admin/prod/build-prod.sh')
        elif BUILT_SHELL.stat().st_mtime < SOURCE_SHELL.stat().st_mtime:
            self.no_build(f'{BUILT_SHELL} predates {SOURCE_SHELL}; rebuild to check it')
        self.assert_inline_blocks_allowlisted(BUILT_SHELL)
