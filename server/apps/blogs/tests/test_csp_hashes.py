"""Regression tests for production CSP hashes on Django template blocks."""

import base64
import hashlib
import re

from django.conf import settings

from . import BaseTestCase


class CspHashTests(BaseTestCase):
    """Verify inline Django template blocks have production CSP hashes."""

    def test_inline_template_blocks_are_hash_allowlisted(self):
        """Every production inline style and script block should be hash allowlisted."""
        settings_source = (settings.BASE_DIR / 'config' / 'settings.py').read_text()
        allowlisted_hashes = set(re.findall(r"'sha256-[A-Za-z0-9+/=]+'", settings_source))
        template_paths = [
            settings.BASE_DIR / 'templates' / 'shared' / 'base.html',
            settings.BASE_DIR / 'templates' / 'shared' / 'header.html',
            settings.BASE_DIR / 'apps' / 'blogs' / 'templates' / 'blogs' / 'post_detail.html',
            settings.BASE_DIR / 'apps' / 'website' / 'templates' / 'website' / 'index.html',
        ]

        for template_path in template_paths:
            html = template_path.read_text()
            for tag in ('style', 'script'):
                blocks = re.findall(rf'<{tag}>(.*?)</{tag}>', html, re.S)
                for block in blocks:
                    with self.subTest(template=template_path, tag=tag, block=block):
                        self.assertNotIn('{{', block)
                        self.assertNotIn('{%', block)
                        digest = base64.b64encode(hashlib.sha256(block.encode()).digest()).decode()
                        self.assertIn(f"'sha256-{digest}'", allowlisted_hashes)
