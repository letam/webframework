"""Conservative reference checks and maintenance-only storage reclamation."""

import os
from dataclasses import dataclass
from datetime import datetime

from botocore.exceptions import ClientError
from django.apps import apps
from django.core.files.storage import FileSystemStorage
from django.db import DEFAULT_DB_ALIAS, connections, models
from django.utils import timezone
from storages.utils import clean_name
from storages.utils import safe_join as s3_safe_join

from apps.uploads.inventory import (
    eligible_name,
    local_name_safe,
    local_reference_path,
    safe_segments,
    storage_identity,
)

from .models import Media


@dataclass(frozen=True)
class ReferenceField:
    """One modeled reference and its physical storage root."""

    model: type
    field_name: str
    root: str
    bucket_key: bool = False


def collect_reference_fields(storage):
    """Audit every concrete FileField storage; unknown mappings abort the sweep."""
    identity = storage_identity(storage)
    fields = []
    for model in apps.get_models():
        for field in model._meta.concrete_fields:
            if not isinstance(field, models.FileField):
                continue
            other = storage_identity(field.storage)
            if identity['backend'] != other['backend']:
                raise ValueError(f'Ambiguous storage mapping: {model._meta.label}.{field.name}')
            if identity['backend'] == 'filesystem':
                root = other['root']
            else:
                if (identity['bucket'], identity['endpoint']) != (
                    other['bucket'],
                    other['endpoint'],
                ):
                    raise ValueError(
                        f'Ambiguous storage mapping: {model._meta.label}.{field.name}'
                    )
                root = other['location']
            fields.append(ReferenceField(model, field.name, root))
    fields.append(ReferenceField(Media, 's3_file_key', '', bucket_key=True))
    return fields


def _reference_key(identity, reference, value):
    """Map a stored value to the object it reads, or refuse ambiguous values."""
    if reference.bucket_key:
        # These are literal boto3 keys, not storage-relative FileField names.
        if not safe_segments(value) or value.endswith('/'):
            raise ValueError('Ambiguous bucket-key reference')
        if identity['backend'] == 'filesystem':
            # Preserve the conservative protection for same-named local files.
            return os.path.join(identity['root'], value)
        return value
    if identity['backend'] == 'filesystem':
        return local_reference_path(reference.root, value)
    # Match django-storages reads, including Windows separators and dot segments.
    return s3_safe_join(reference.root, clean_name(value))


def find_referenced_names(storage, names, fields, *, database=DEFAULT_DB_ALIAS):
    """Resolve all primary references, including aliases and unattached rows.

    A literal __in lookup misses aliases of candidate keys. Stream every modeled
    value instead, both for batch classification and the fresh deletion check.
    """
    identity = storage_identity(storage)
    mapped = {}
    for name in names:
        key = (
            os.path.join(identity['root'], name)
            if identity['backend'] == 'filesystem'
            else '/'.join(filter(None, (identity['location'], name)))
        )
        mapped.setdefault(key, []).append(name)
    protected = set()
    for reference in fields:
        values = (
            reference.model._base_manager.using(database)
            .values_list(reference.field_name, flat=True)
            .iterator(chunk_size=1000)
        )
        for value in values:
            if value:
                key = _reference_key(identity, reference, value)
                protected.update(mapped.get(key, ()))
    return protected


def iter_unattached_media(*, batch_size, limit, database=DEFAULT_DB_ALIAS):
    """Report unattached IDs by primary-key batches; never delete these rows."""
    last_pk = 0
    while limit:
        rows = list(
            Media._base_manager.using(database)
            .filter(post__isnull=True, pk__gt=last_pk)
            .order_by('pk')
            .values_list('pk', flat=True)[: min(batch_size, limit)]
        )
        if not rows:
            return
        yield from rows
        limit -= len(rows)
        last_pk = rows[-1]


def _missing(error):
    return isinstance(error, FileNotFoundError) or (
        isinstance(error, ClientError)
        and error.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey', 'NotFound')
    )


def read_metadata(storage, name, now):
    """Read a safe timestamp and size through storage, skipping unknown metadata."""
    if isinstance(storage, FileSystemStorage) and not local_name_safe(
        storage, name, file_only=True
    ):
        return None, 'unsafe_path'
    try:
        modified = storage.get_modified_time(name)
        size = storage.size(name)
    except Exception as error:
        return None, 'missing' if _missing(error) else 'unknown_metadata'
    if not isinstance(modified, datetime) or timezone.is_naive(modified):
        return None, 'unknown_age'
    if modified > now:
        return None, 'future_mtime'
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        return None, 'unknown_size'
    return (modified, size), ''


def classify_candidate(storage, entry, referenced, *, cutoff, now):
    """Return metadata and a reason without changing storage or the database."""
    if entry.reason:
        return None, entry.reason
    if not eligible_name(entry.name):
        return None, 'excluded_namespace'
    metadata, reason = read_metadata(storage, entry.name, now)
    if reason:
        return metadata, reason
    if entry.name in referenced:
        return metadata, 'referenced'
    if metadata[0] >= cutoff:
        return metadata, 'young'
    return metadata, 'unreferenced'


def delete_candidate(storage, name, metadata, fields, *, cutoff, now, on_attempt):
    """Recheck metadata and primary references immediately before one removal."""
    connection = connections[DEFAULT_DB_ALIAS]
    if connection.in_atomic_block or not connection.get_autocommit():
        raise ValueError('Deletion requires fresh autocommit reads on the default database')
    fresh, reason = read_metadata(storage, name, now)
    if reason:
        return 'skipped', reason
    if fresh != metadata or fresh[0] >= cutoff:
        return 'skipped', 'changed_metadata'
    if find_referenced_names(storage, [name], fields):
        return 'skipped', 'reference_recheck'
    on_attempt()
    try:
        storage.delete(name)
    except Exception as error:
        if _missing(error):
            return 'skipped', 'missing'
        raise
    return 'deleted', 'unreferenced'
