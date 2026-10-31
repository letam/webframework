"""Bounded inventory of the active media storage, without Storage.listdir()."""

import os
import re
import stat
from dataclasses import dataclass
from urllib.parse import urlsplit

from django.core.files.storage import FileSystemStorage
from django.utils._os import safe_join

from .storage import GuardedS3Boto3Storage

NAMESPACE = re.compile(r'post/(?:[0-9]+/media|audio/[0-9]+)/[^/]+\Z')
PREFIX = re.compile(r'post/(?:audio/(?:[0-9]+/(?:[^/]+)?)?|[0-9]+/(?:media/(?:[^/]+)?)?)?\Z')
DIRECTORY = re.compile(r'post(?:/audio(?:/[0-9]+)?|/[0-9]+(?:/media)?)?\Z')


@dataclass(frozen=True)
class InventoryEntry:
    """One listing entry; directories and symlinks consume the scan budget too."""

    name: str
    reason: str = ''


def safe_segments(name):
    """Reject noncanonical names instead of normalizing them into eligible keys."""
    return (
        isinstance(name, str)
        and bool(name)
        and not name.startswith('/')
        and '\\' not in name
        and not any(ord(char) < 32 or ord(char) == 127 for char in name)
        and all(part not in ('', '.', '..') for part in name.rstrip('/').split('/'))
    )


def eligible_name(name):
    """Return whether a key has an audited application-owned shape."""
    return safe_segments(name) and NAMESPACE.fullmatch(name) is not None


def validate_prefix(prefix):
    """Accept only narrowing prefixes within the audited namespaces."""
    if not safe_segments(prefix) or not PREFIX.fullmatch(prefix):
        raise ValueError('Invalid cleanup prefix; use an audited post namespace')
    return prefix


def storage_identity(storage):
    """Return a non-secret, unambiguous backend identity or fail closed."""
    if isinstance(storage, FileSystemStorage):
        root = os.path.abspath(storage.location)
        if os.path.realpath(root) != root:
            raise ValueError('Filesystem storage root must not contain symlinks')
        return {'backend': 'filesystem', 'root': root}
    if isinstance(storage, GuardedS3Boto3Storage):
        location = storage.location
        if location and (not safe_segments(location) or location.endswith('/')):
            raise ValueError('Ambiguous R2 storage location')
        # Reject endpoints with userinfo/query strings rather than printing them.
        endpoint = urlsplit(storage.endpoint_url or '')
        if (
            endpoint.scheme != 'https'
            or not endpoint.hostname
            or endpoint.username
            or endpoint.password
            or endpoint.query
            or endpoint.fragment
            or endpoint.path not in ('', '/')
        ):
            raise ValueError('Ambiguous R2 endpoint')
        if not storage.bucket_name or not safe_segments(storage.bucket_name):
            raise ValueError('Missing or invalid R2 bucket')
        return {
            'backend': 'r2',
            'endpoint': endpoint.netloc,
            'bucket': storage.bucket_name,
            'location': location,
        }
    raise ValueError('Unsupported media storage backend')


def local_name_safe(storage, name, *, file_only=False):
    """Recheck containment and every path component without following symlinks."""
    if not safe_segments(name):
        return False
    root = storage_identity(storage)['root']
    path = root
    for part in name.split('/'):
        path = os.path.join(path, part)
        if os.path.islink(path):
            return False
    if os.path.commonpath((root, os.path.realpath(path))) != root:
        return False
    if file_only:
        try:
            return stat.S_ISREG(os.stat(path, follow_symlinks=False).st_mode)
        except FileNotFoundError:
            # Let the storage metadata API classify a disappeared object as missing.
            return True
    return True


def local_reference_path(root, name):
    """Resolve a FileField like FileSystemStorage, following reference symlinks.

    Missing references cannot currently point to an inventoried file. Other
    resolution errors (including symlink loops) must abort reference checking.
    Backslashes are refused because their meaning varies across platforms.
    """
    if '\\' in name or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise ValueError('Ambiguous filesystem reference')
    path = safe_join(root, name)
    try:
        return os.path.realpath(path, strict=True)
    except FileNotFoundError:
        return None


def _local_entries(storage, prefixes):
    root = storage_identity(storage)['root']

    def walk(name):
        if not local_name_safe(storage, name):
            yield InventoryEntry(name, 'unsafe_path')
            return
        try:
            with os.scandir(os.path.join(root, name)) as entries:
                for entry in entries:
                    key = f'{name}/{entry.name}'
                    if not any(
                        key.startswith(prefix) or prefix.startswith(key + '/')
                        for prefix in prefixes
                    ):
                        yield InventoryEntry(key, 'outside_prefix')
                        continue
                    if entry.is_symlink():
                        yield InventoryEntry(key, 'symlink')
                    elif entry.is_dir(follow_symlinks=False):
                        yield InventoryEntry(key, 'directory')
                        if safe_segments(key) and DIRECTORY.fullmatch(key):
                            yield from walk(key)
                    elif entry.is_file(follow_symlinks=False):
                        yield InventoryEntry(key)
                    else:
                        yield InventoryEntry(key, 'unsupported_entry')
        except FileNotFoundError:
            # A missing storage root/post directory has no inventory.
            return

    yield from walk('post')


def _r2_entries(storage, prefixes, batch_size, max_scan):
    location = f'{storage.location}/' if storage.location else ''
    paginator = storage.connection.meta.client.get_paginator('list_objects_v2')
    remaining = max_scan
    for prefix in prefixes:
        pages = paginator.paginate(
            Bucket=storage.bucket_name,
            Prefix=location + prefix,
            PaginationConfig={'PageSize': min(batch_size, remaining), 'MaxItems': remaining},
        )
        for page in pages:
            for item in page.get('Contents', []):
                key = item['Key']
                if not key.startswith(location + prefix):
                    raise ValueError('R2 listing escaped the requested prefix')
                yield InventoryEntry(key[len(location) :])
                remaining -= 1
                if remaining == 0:
                    return


def iter_storage_batches(storage, *, prefixes, batch_size, max_scan):
    """Stream at most max_scan entries in batches, using only supported adapters."""
    identity = storage_identity(storage)
    prefixes = sorted(set(validate_prefix(prefix) for prefix in (prefixes or ['post/'])))
    # Overlapping prefixes must neither double-count nor delete an object twice.
    prefixes = [
        p for i, p in enumerate(prefixes) if not any(p.startswith(q) for q in prefixes[:i])
    ]
    if identity['backend'] == 'filesystem':
        entries = _local_entries(storage, prefixes)
    else:
        entries = _r2_entries(storage, prefixes, batch_size, max_scan)
    batch = []
    try:
        for entry in entries:
            batch.append(entry)
            max_scan -= 1
            if len(batch) == batch_size or max_scan == 0:
                yield batch
                batch = []
            if max_scan == 0:
                return
        if batch:
            yield batch
    finally:
        entries.close()
