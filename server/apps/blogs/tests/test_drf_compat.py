"""Expiry alarm for the Django 6.1 x DRF compatibility shim.

``config/drf_django61_compat.py`` restores ``django.utils.cache.cc_delim_re``,
a private symbol Django 6.1 removed but DRF 3.17.1 still imports. The shim is
guarded by ``if not hasattr(...)``, so once it stops being needed it silently
does nothing forever and nobody notices the dead code.

These tests re-derive both halves of "is the shim still needed?" from the
installed packages' *source*, which the runtime patch does not touch. When
either half stops holding, the shim can go — and the failure says so.
"""

from pathlib import Path

from django.test import SimpleTestCase
from django.utils import cache as django_cache

REMOVE_INSTRUCTIONS = (
    'Delete server/config/drf_django61_compat.py, its import in settings.py, '
    'the CLAUDE.md note, and this test file.'
)


class DrfDjango61ShimTests(SimpleTestCase):
    """Fail loudly once the compatibility shim is dead weight.

    Pure source inspection, so no database or media fixtures — hence
    SimpleTestCase rather than the package's BaseTestCase.
    """

    def test_django_still_lacks_cc_delim_re(self):
        """Django re-adding cc_delim_re would make the shim redundant."""
        source = Path(django_cache.__file__).read_text()
        self.assertNotIn(
            'cc_delim_re',
            source,
            msg=f'django.utils.cache defines cc_delim_re again. {REMOVE_INSTRUCTIONS}',
        )

    def test_drf_still_imports_cc_delim_re(self):
        """DRF dropping the import is the fix we are waiting on.

        Scanned package-wide, not just in `rest_framework/views.py`: DRF moving
        the import to another module would otherwise read as "the fix shipped"
        and get the still-needed shim deleted.
        """
        import rest_framework

        package_root = Path(rest_framework.__file__).parent
        users = [
            path.relative_to(package_root)
            for path in package_root.rglob('*.py')
            if 'cc_delim_re' in path.read_text()
        ]
        self.assertTrue(
            users,
            msg=f'No module under rest_framework/ mentions cc_delim_re. {REMOVE_INSTRUCTIONS}',
        )

    def test_shim_is_applied(self):
        """Whatever the source says, the symbol must exist at runtime for DRF."""
        self.assertTrue(hasattr(django_cache, 'cc_delim_re'))
        self.assertEqual(django_cache.cc_delim_re.pattern, r'\s*,\s*')
