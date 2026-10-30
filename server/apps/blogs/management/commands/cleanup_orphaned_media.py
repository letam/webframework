"""Report orphaned media and reclaim files only during verified maintenance."""

import json
from datetime import timedelta

from django.core.files.storage import storages
from django.core.management.base import BaseCommand, CommandError
from django.db import DEFAULT_DB_ALIAS, connections
from django.utils import timezone

from apps.blogs.media_cleanup import (
    classify_candidate,
    collect_reference_fields,
    delete_candidate,
    find_referenced_names,
    iter_unattached_media,
)
from apps.uploads.inventory import iter_storage_batches, storage_identity, validate_prefix


class Command(BaseCommand):
    """Manually inventory storage; unattached Media rows are always report-only."""

    help = 'Report orphaned media; --delete requires verified writer quiescence (maintenance).'

    def add_arguments(self, parser):
        """Expose finite budgets and explicit maintenance acknowledgement."""
        parser.add_argument('--delete', action='store_true')
        parser.add_argument('--writers-quiesced', action='store_true')
        parser.add_argument('--min-age-hours', type=int, default=168)
        parser.add_argument('--batch-size', type=int, default=100)
        parser.add_argument('--max-scan', type=int, default=10000)
        parser.add_argument('--max-delete', type=int, default=100)
        parser.add_argument('--max-row-report', type=int, default=1000)
        parser.add_argument('--prefix', action='append', default=[])

    def handle(self, *args, **options):
        """Write JSON lines for each decision and a final, explicitly partial summary."""
        if options['delete'] and not options['writers_quiesced']:
            raise CommandError('--delete requires --writers-quiesced; this flag is not a lock')
        if options['min_age_hours'] < 168:
            raise CommandError('--min-age-hours cannot be less than 168')
        for name in ('batch_size', 'max_delete', 'max_scan', 'max_row_report'):
            value = options[name]
            if value < 1 or (name in ('batch_size', 'max_delete') and value > 1000):
                raise CommandError(f'Invalid --{name.replace("_", "-")}')
        try:
            for prefix in options['prefix']:
                validate_prefix(prefix)
            now = timezone.now()
            cutoff = now - timedelta(hours=options['min_age_hours'])
        except (ValueError, OverflowError) as error:
            raise CommandError(str(error)) from error
        connection = connections[DEFAULT_DB_ALIAS]
        if options['delete'] and (connection.in_atomic_block or not connection.get_autocommit()):
            raise CommandError(
                'Deletion requires autocommit on the authoritative default database'
            )
        try:
            storage = storages['default']
            identity = storage_identity(storage)
            fields = collect_reference_fields(storage)
        except Exception as error:
            reason = str(error) if isinstance(error, ValueError) else type(error).__name__
            raise CommandError(f'Cleanup refused: {reason}') from error
        summary = {
            'scanned': 0,
            'protected_references': 0,
            'young': 0,
            'unknown_age': 0,
            'candidate_bytes': 0,
            'candidates': 0,
            'deletion_attempts': 0,
            'deleted': 0,
            'unattached_rows': 0,
            'caps': [],
            'incomplete': False,
        }

        def emit(**record):
            self.stdout.write(json.dumps({'storage': identity, **record}, ensure_ascii=True))

        def decision(entry, metadata, outcome, reason):
            emit(
                event='object',
                key=entry.name,
                mtime=metadata[0].isoformat() if metadata else None,
                size=metadata[1] if metadata else None,
                reason=reason,
                outcome=outcome,
            )

        def attempt():
            summary['deletion_attempts'] += 1

        def cap(name):
            summary['caps'].append(name)
            summary['incomplete'] = True

        database_name = str(connection.settings_dict['NAME'])
        emit(
            event='start',
            database={
                'alias': DEFAULT_DB_ALIAS,
                'engine': connection.settings_dict['ENGINE'],
                'name': database_name if '://' not in database_name else '<configured URI>',
            },
            cutoff=cutoff.isoformat(),
            dry_run=not options['delete'],
            limits={
                name: options[name]
                for name in ('batch_size', 'max_scan', 'max_delete', 'max_row_report')
            },
        )
        failure = None
        current_entry = None
        current_metadata = None
        batches = None
        try:
            for pk in iter_unattached_media(
                batch_size=options['batch_size'], limit=options['max_row_report']
            ):
                summary['unattached_rows'] += 1
                emit(event='unattached_media', pk=pk, outcome='skipped', reason='report_only')
            if summary['unattached_rows'] == options['max_row_report']:
                cap('max_row_report')
            batches = iter_storage_batches(
                storage,
                prefixes=options['prefix'],
                batch_size=options['batch_size'],
                max_scan=options['max_scan'],
            )
            stop = False
            for batch in batches:
                current_entry = None
                current_metadata = None
                referenced = find_referenced_names(
                    storage, [entry.name for entry in batch], fields
                )
                for entry in batch:
                    current_entry = entry
                    current_metadata = None
                    summary['scanned'] += 1
                    metadata, reason = classify_candidate(
                        storage, entry, referenced, cutoff=cutoff, now=now
                    )
                    current_metadata = metadata
                    if reason == 'referenced':
                        summary['protected_references'] += 1
                    elif reason == 'young':
                        summary['young'] += 1
                    elif reason in ('unknown_age', 'unknown_metadata', 'future_mtime'):
                        summary['unknown_age'] += 1
                    if reason != 'unreferenced':
                        decision(entry, metadata, 'skipped', reason)
                        continue
                    summary['candidates'] += 1
                    summary['candidate_bytes'] += metadata[1]
                    if not options['delete']:
                        decision(entry, metadata, 'would_delete', reason)
                        continue
                    outcome, reason = delete_candidate(
                        storage,
                        entry.name,
                        metadata,
                        fields,
                        cutoff=cutoff,
                        now=now,
                        on_attempt=attempt,
                    )
                    summary['deleted'] += outcome == 'deleted'
                    if reason == 'reference_recheck':
                        summary['protected_references'] += 1
                    decision(entry, metadata, outcome, reason)
                    if summary['deletion_attempts'] == options['max_delete']:
                        cap('max_delete')
                        stop = True
                        break
                if stop:
                    break
                current_entry = None
                current_metadata = None
            if summary['scanned'] == options['max_scan']:
                cap('max_scan')
        except Exception as error:
            failure = error
            summary['incomplete'] = True
            # Exception messages from storage SDKs may contain signed URLs or credentials.
            if current_entry is not None:
                decision(current_entry, current_metadata, 'error', type(error).__name__)
            else:
                emit(event='run', outcome='error', reason=type(error).__name__)
        finally:
            if batches is not None:
                batches.close()
            emit(event='summary', **summary)
        if failure is not None:
            raise CommandError(
                f'Cleanup aborted: {type(failure).__name__}; see JSON report'
            ) from failure
