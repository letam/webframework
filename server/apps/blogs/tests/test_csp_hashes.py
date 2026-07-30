"""Regression tests for production CSP hashes on inline template blocks."""

import base64
import hashlib
import os
import re

from django.conf import settings

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


class CspHashTests(BaseTestCase):
    """Verify inline styles and scripts have production CSP hashes."""

    def setUp(self):
        """Collect the hashes allowlisted in settings.py."""
        super().setUp()
        settings_source = (settings.BASE_DIR / 'config' / 'settings.py').read_text()
        self.allowlisted_hashes = set(re.findall(r"'sha256-[A-Za-z0-9+/=]+'", settings_source))

    def no_build(self, message):
        """Skip for want of a production build — unless CI promised to make one."""
        if REQUIRE_BUILT_SHELL:
            self.fail(f'REQUIRE_BUILT_SHELL is set but the build is unusable: {message}')
        self.skipTest(message)

    def assert_inline_blocks_allowlisted(self, path):
        """Assert every bare <style>/<script> block in `path` is hash allowlisted."""
        html = path.read_text()
        for tag in ('style', 'script'):
            # Bare tags only: anything with attributes (`<script type="module" src=…>`)
            # is an external reference, covered by the 'self' source, not a hash.
            for block in re.findall(rf'<{tag}>(.*?)</{tag}>', html, re.S):
                with self.subTest(template=path, tag=tag, block=block):
                    self.assertNotIn('{{', block)
                    self.assertNotIn('{%', block)
                    digest = base64.b64encode(hashlib.sha256(block.encode()).digest()).decode()
                    self.assertIn(f"'sha256-{digest}'", self.allowlisted_hashes)

    def test_inline_template_blocks_are_hash_allowlisted(self):
        """Every production inline style and script block should be hash allowlisted."""
        template_paths = [
            settings.BASE_DIR / 'templates' / 'shared' / 'base.html',
            settings.BASE_DIR / 'templates' / 'shared' / 'header.html',
            settings.BASE_DIR / 'apps' / 'blogs' / 'templates' / 'blogs' / 'post_detail.html',
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
