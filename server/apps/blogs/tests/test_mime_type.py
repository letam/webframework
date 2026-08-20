"""Tests for MIME type detection on locally stored media."""

import os
import subprocess
import tempfile
from unittest import mock

from django.test import SimpleTestCase

from ..utils.get_file_mimetype import (
    FALLBACK_MIME_TYPE,
    _probe_mime_type,
    get_file_mime_type,
)


def _completed(stdout='audio/mpeg\n', stderr='', returncode=0):
    """A stand-in for what subprocess.run hands back for a `file` call."""
    return subprocess.CompletedProcess(
        args=['file', '-b', '--mime-type'], returncode=returncode, stdout=stdout, stderr=stderr
    )


class GetFileMimeTypeTests(SimpleTestCase):
    """Detection is a fork per call, and one media view makes a great many.

    A browser seeking through audio or video issues a range request per seek,
    and every one of them needs the file's type to build its 206. Probing is
    memoized so a scrub costs one `file` process rather than dozens.
    """

    def setUp(self):
        """Start from a cold cache — it is process-global and outlives a test."""
        super().setUp()
        _probe_mime_type.cache_clear()
        self.addCleanup(_probe_mime_type.cache_clear)
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.path = os.path.join(temp_dir.name, 'clip.mp3')
        with open(self.path, 'wb') as handle:
            handle.write(b'ID3 not really an mp3')

    def test_repeated_lookups_for_one_file_probe_it_once(self):
        """The second and later calls are answered from the cache."""
        with mock.patch('subprocess.run', return_value=_completed()) as run:
            results = [get_file_mime_type(self.path) for _ in range(3)]

        self.assertEqual(results, ['audio/mpeg'] * 3)
        self.assertEqual(run.call_count, 1)

    def test_a_file_replaced_at_the_same_path_is_probed_again(self):
        """The cache key is the file's identity, not just its name.

        Media names are unique in practice, so this is belt and braces — but a
        cache keyed on the path alone would keep serving the old type forever if
        that ever stopped being true, which is a bad way to find out.
        """
        with mock.patch('subprocess.run', return_value=_completed()) as run:
            self.assertEqual(get_file_mime_type(self.path), 'audio/mpeg')

        with open(self.path, 'wb') as handle:
            handle.write(b'\x89PNG a different file entirely, and a different size')

        with mock.patch('subprocess.run', return_value=_completed('image/png\n')) as run:
            self.assertEqual(get_file_mime_type(self.path), 'image/png')

        self.assertEqual(run.call_count, 1)

    def test_a_failed_probe_reports_a_usable_type(self):
        """A non-zero exit used to yield '' — an empty Content-Type on the 206."""
        with mock.patch('subprocess.run', return_value=_completed('', 'file: boom', 1)):
            with self.assertLogs('server.apps.blogs', level='ERROR'):
                self.assertEqual(get_file_mime_type(self.path), FALLBACK_MIME_TYPE)

    def test_a_probe_that_raises_reports_a_usable_type(self):
        """`file` may be absent or hang; neither should reach the response."""
        with mock.patch('subprocess.run', side_effect=FileNotFoundError('file')):
            with self.assertLogs('server.apps.blogs', level='ERROR'):
                self.assertEqual(get_file_mime_type(self.path), FALLBACK_MIME_TYPE)

    def test_a_missing_file_is_not_probed_at_all(self):
        """Nothing to read means nothing to fork for."""
        missing = os.path.join(os.path.dirname(self.path), 'gone.mp3')
        with mock.patch('subprocess.run') as run:
            with self.assertLogs('server.apps.blogs', level='ERROR'):
                result = get_file_mime_type(missing)

        self.assertEqual(result, FALLBACK_MIME_TYPE)
        run.assert_not_called()

    def test_an_unreadable_file_does_not_become_its_own_content_type(self):
        """`file` reports "cannot open" on stdout and still exits 0.

        Not a hypothetical shape: `file -b --mime-type` on a path it cannot read
        prints `cannot open: Permission denied` to stdout with status 0. Trusting
        the exit code alone would send that sentence to the browser as the
        Content-Type of a 206, and — now that probes are memoized — keep sending
        it for the life of the process.
        """
        with mock.patch(
            'subprocess.run', return_value=_completed('cannot open: Permission denied')
        ):
            with self.assertLogs('server.apps.blogs', level='ERROR'):
                self.assertEqual(get_file_mime_type(self.path), FALLBACK_MIME_TYPE)

    def test_a_transient_failure_is_not_memoized(self):
        """The whole point of the cache is defeated if it can cache a mistake.

        A `file` call that times out under load, or a moment when the binary is
        unavailable, must not pin application/octet-stream to this file until the
        worker restarts. lru_cache stores return values and not exceptions, which
        is why the probe raises rather than returning the fallback itself.
        """
        with mock.patch('subprocess.run', side_effect=subprocess.TimeoutExpired('file', 10)):
            with self.assertLogs('server.apps.blogs', level='ERROR'):
                self.assertEqual(get_file_mime_type(self.path), FALLBACK_MIME_TYPE)

        with mock.patch('subprocess.run', return_value=_completed()) as run:
            self.assertEqual(get_file_mime_type(self.path), 'audio/mpeg')

        run.assert_called_once()
