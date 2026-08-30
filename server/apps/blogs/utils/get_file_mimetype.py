"""Helpers for detecting MIME types from local files."""

import logging
import os
import re
import subprocess
from functools import lru_cache

logger = logging.getLogger('server.apps.blogs')

# Returned when the type genuinely cannot be determined. The old code returned
# 'unknown' here, which is not a MIME type — browsers treat it as an unplayable
# `<audio>`/`<video>` source rather than falling back to sniffing.
FALLBACK_MIME_TYPE = 'application/octet-stream'

# `file` does not report unreadable files through its exit status: given a path it
# cannot open it still exits 0 and prints `cannot open: Permission denied` on
# *stdout*, which is a perfectly plausible-looking string to hand back as a
# Content-Type. Checking the shape is what actually catches that.
_MIME_TYPE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9.+_-]*/[A-Za-z0-9][A-Za-z0-9.+_-]*$')


class _ProbeError(Exception):
    """Raised instead of returning a fallback, so the failure is not memoized.

    ``lru_cache`` stores return values and not exceptions. Raising is therefore
    what keeps a transient failure — a timeout under load, a moment when `file`
    is unavailable — from pinning ``application/octet-stream`` to that file for
    the life of the process. The caller turns this back into the fallback.
    """


@lru_cache(maxsize=512)
def _probe_mime_type(file_path, _size, _mtime_ns):
    """Ask ``file`` what ``file_path`` holds, memoized on the file's identity.

    ``file`` reads the bytes, so it stays the authority here — media arrives with
    extensions that are missing or wrong often enough to matter. It is also a
    fork per call, and a browser scrubbing a video issues one range request per
    seek, every one of which used to land here for the same unchanged file.

    ``_size`` and ``_mtime_ns`` are unused in the body and present only as cache
    key: a file replaced at a path already seen gets probed again instead of
    being answered from a stale entry.

    Raises:
        _ProbeError: if ``file`` could not be run, or answered with something
            that is not a MIME type.
    """
    result = subprocess.run(
        [
            'file',
            '-b',
            '--mime-type',
            file_path,
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )
    mime_type = result.stdout.strip()
    if result.returncode != 0 or not _MIME_TYPE_RE.match(mime_type):
        raise _ProbeError(
            f'file(1) gave no usable mime type for {file_path} '
            f'(exit {result.returncode}): {mime_type or result.stderr.strip()!r}'
        )
    return mime_type


def get_file_mime_type(file_path):
    """Return the MIME type reported by the system file command.

    Falls back to ``application/octet-stream`` when the file cannot be read or
    ``file`` cannot answer. That is a worse answer than the real type but a much
    better one than the empty string this used to return, which becomes an empty
    Content-Type on a 206 — a lie, and harder to debug than saying we don't know.
    """
    try:
        stat = os.stat(file_path)
    except OSError as e:
        logger.error(f'Error getting mime type for {file_path}: {str(e)}')
        return FALLBACK_MIME_TYPE
    try:
        return _probe_mime_type(file_path, stat.st_size, stat.st_mtime_ns)
    except Exception as e:
        logger.error(f'Error getting mime type for {file_path}: {str(e)}')
        return FALLBACK_MIME_TYPE
