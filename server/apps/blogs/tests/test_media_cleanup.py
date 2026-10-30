"""Safety and lifecycle regression tests for manual media reclamation."""

import json
import os
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from botocore.exceptions import ClientError
from django.apps import apps
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage, storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, models, transaction
from django.test import TransactionTestCase, override_settings

from apps.blogs.media_cleanup import collect_reference_fields, find_referenced_names
from apps.blogs.models import LinkPreview, Media, Post
from apps.blogs.utils.media_processing import save_media_thumbnail
from apps.uploads.inventory import (
    InventoryEntry,
    eligible_name,
    iter_storage_batches,
    validate_prefix,
)
from apps.uploads.storage import GuardedS3Boto3Storage

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)
OLD = NOW - timedelta(days=8)
COMMAND = 'apps.blogs.management.commands.cleanup_orphaned_media'


class FakeRemoteStorage(GuardedS3Boto3Storage):
    """Configured guarded adapter with in-memory metadata and a stub paginator."""

    def __init__(self, location=''):
        """Set explicit dummy configuration; never construct a network client."""
        super().__init__(
            bucket_name='test-bucket',
            endpoint_url='https://test.invalid',
            access_key='test',
            secret_key='test',
            location=location,
        )
        self.objects = {}
        self.deleted = []
        self.page_requests = []
        self.client = mock.Mock()
        self.client.get_paginator.return_value.paginate.side_effect = self.pages

    @property
    def connection(self):
        """Expose only the paginator mock used by inventory."""
        return mock.Mock(meta=mock.Mock(client=self.client))

    def pages(self, **kwargs):
        """Honor page and scan bounds while recording requested bucket prefixes."""
        self.page_requests.append(kwargs)
        keys = [key for key in self.objects if key.startswith(kwargs['Prefix'])]
        keys = keys[: kwargs['PaginationConfig']['MaxItems']]
        size = kwargs['PaginationConfig']['PageSize']
        for offset in range(0, len(keys), size):
            yield {'Contents': [{'Key': key} for key in keys[offset : offset + size]]}

    def get_modified_time(self, name):
        """Read fake remote metadata using storage-relative names."""
        return self.objects[self._normalize_name(name)][0]

    def size(self, name):
        """Read fake object size without accessing .path."""
        return self.objects[self._normalize_name(name)][1]

    def delete(self, name):
        """Record one storage API removal."""
        self.deleted.append(name)
        del self.objects[self._normalize_name(name)]


class MediaCleanupTests(TransactionTestCase):
    """Use real autocommit so destructive checks cannot inherit TestCase snapshots."""

    def setUp(self):
        """Isolate both database rows and real local files for every test."""
        super().setUp()
        self.temp = TemporaryDirectory()
        self.root = os.path.realpath(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        settings_override = override_settings(
            MEDIA_ROOT=self.root,
            USE_LOCAL_FILE_STORAGE=True,
            STORAGES={'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'}},
            TASKS={'default': {'BACKEND': 'django_tasks.backends.immediate.ImmediateBackend'}},
        )
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.storage = storages['default']
        self.output = StringIO()
        self.user = get_user_model().objects.create_user(username='cleanup-owner')

    def write(self, name, modified=OLD):
        """Create a real object with a controlled storage modification time."""
        path = Path(self.root, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'media')
        os.utime(path, (modified.timestamp(), modified.timestamp()))
        return name

    def run_cleanup(self, delete=False, **kwargs):
        """Run only against this test's isolated database/storage and parse JSON lines."""
        self.output = StringIO()
        with mock.patch(f'{COMMAND}.timezone.now', return_value=NOW):
            call_command(
                'cleanup_orphaned_media',
                delete=delete,
                writers_quiesced=delete,
                stdout=self.output,
                **kwargs,
            )
        return [json.loads(line) for line in self.output.getvalue().splitlines()]

    def summary(self):
        """Read the final record, including records emitted before an error."""
        return json.loads(self.output.getvalue().splitlines()[-1])

    def media(self, name, **kwargs):
        """Create a reference without invoking external media probing."""
        return Media.objects.create(file=name, duration=timedelta(seconds=1), **kwargs)

    @contextmanager
    def remote(self, location=''):
        """Inject the backend and every modeled FileField storage explicitly."""
        storage = FakeRemoteStorage(location)
        with ExitStack() as stack:
            stack.enter_context(mock.patch(f'{COMMAND}.storages', {'default': storage}))
            for model in apps.get_models():
                for field in model._meta.concrete_fields:
                    if isinstance(field, models.FileField):
                        stack.enter_context(mock.patch.object(field, 'storage', storage))
            yield storage

    def test_default_is_report_only(self):
        """Dry-run neither deletes files nor removes unattached rows."""
        key = self.write('post/1/media/orphan.bin')
        retained = self.media(self.write('post/2/media/kept.bin'))
        records = self.run_cleanup()
        self.assertTrue(self.storage.exists(key))
        self.assertTrue(Media.objects.filter(pk=retained.pk).exists())
        self.assertEqual([r['key'] for r in records if r.get('outcome') == 'would_delete'], [key])
        self.assertEqual(self.summary()['unattached_rows'], 1)
        self.assertEqual(self.summary()['deletion_attempts'], 0)

    def test_invalid_options_fail_before_inventory(self):
        """Maintenance acknowledgement and all numeric limits are enforced."""
        invalid = [
            {'delete': True},
            {'min_age_hours': 167},
            {'min_age_hours': 0},
            {'min_age_hours': 10**30},
            {'batch_size': 0},
            {'batch_size': 1001},
            {'max_delete': 0},
            {'max_delete': 1001},
            {'max_scan': 0},
            {'max_row_report': -1},
            {'prefix': ['avatars/']},
        ]
        for options in invalid:
            with (
                self.subTest(options=options),
                mock.patch(f'{COMMAND}.iter_storage_batches') as scan,
            ):
                with self.assertRaises(CommandError):
                    call_command('cleanup_orphaned_media', stdout=StringIO(), **options)
                scan.assert_not_called()

    def test_deletion_rejects_transaction_snapshots(self):
        """Even an acknowledged run refuses a long-lived database transaction."""
        with transaction.atomic(), self.assertRaisesMessage(CommandError, 'autocommit'):
            self.run_cleanup(delete=True)

    def test_age_uses_storage_and_strict_cutoff(self):
        """Only old objects qualify; equality, recent and future timestamps survive."""
        times = {
            'old': OLD,
            'equal': NOW - timedelta(hours=168),
            'young': NOW,
            'future': NOW + timedelta(days=1),
        }
        for name, modified in times.items():
            self.write(f'post/1/media/{name}', modified)
        row = self.media(self.write('post/2/media/referenced'))
        Media.objects.filter(pk=row.pk).update(created=OLD - timedelta(days=365), modified=OLD)
        self.run_cleanup(delete=True)
        for name in times:
            self.assertEqual(self.storage.exists(f'post/1/media/{name}'), name != 'old')
        self.assertTrue(self.storage.exists(row.file.name))
        self.assertEqual(self.summary()['deleted'], 1)

    def test_unknown_metadata_is_preserved(self):
        """Unsupported, naive, invalid, missing, and unsafe size metadata skip removal."""
        key = self.write('post/1/media/unknown')
        for value in (None, 'invalid', NOW.replace(tzinfo=None)):
            with (
                self.subTest(value=value),
                mock.patch.object(self.storage, 'get_modified_time', return_value=value),
            ):
                self.run_cleanup(delete=True)
                self.assertTrue(self.storage.exists(key))
        for error in (NotImplementedError(), FileNotFoundError(), PermissionError()):
            with (
                self.subTest(error=error),
                mock.patch.object(self.storage, 'get_modified_time', side_effect=error),
            ):
                self.run_cleanup(delete=True)
                self.assertTrue(self.storage.exists(key))
        for size in (None, -1, True, '5'):
            with (
                self.subTest(size=size),
                mock.patch.object(self.storage, 'size', return_value=size),
            ):
                self.run_cleanup(delete=True)
                self.assertTrue(self.storage.exists(key))

    def test_every_reference_is_protected(self):
        """All fields, unattached rows, drafts, private posts and shared names survive."""
        names = [self.write(f'post/1/media/{index}') for index in range(8)]
        media = self.media(names[0], mp3_file=names[1], thumbnail=names[2], s3_file_key=names[3])
        self.media(names[0])
        draft = self.media(names[4])
        private = self.media(names[5])
        Post.objects.create(author=self.user, media=draft, is_draft=True)
        post = Post.objects.create(author=self.user, media=private, visibility='private')
        get_user_model().objects.filter(pk=self.user.pk).update(avatar=names[6])
        LinkPreview.objects.create(post=post, url='https://example.com', image=names[7])
        self.run_cleanup(delete=True)
        self.assertEqual(self.summary()['protected_references'], len(names))
        self.assertEqual(self.summary()['deleted'], 0)
        self.assertTrue(Media.objects.filter(pk=media.pk).exists())
        self.assertTrue(all(self.storage.exists(name) for name in names))

    def test_base_manager_and_default_database_are_used(self):
        """Reference checks bypass filtered default managers and database read routers."""
        name = self.write('post/1/media/base-manager')
        self.media(name)
        with mock.patch('django.db.router.db_for_read', return_value='unavailable_replica'):
            self.run_cleanup(delete=True)
        self.assertTrue(self.storage.exists(name))

    def test_unsafe_names_and_excluded_namespaces(self):
        """Only the two audited shapes qualify, without normalization or traversal."""
        excluded = [
            'avatars/image',
            'link_previews/image',
            'audio/1/file',
            'post/None/media/file',
            'post/1/other/file',
            'static/file',
            'post/audio/no/file',
            'post/1/media/nested/file',
        ]
        for name in excluded:
            self.write(name)
        self.run_cleanup(delete=True)
        self.assertTrue(all(self.storage.exists(name) for name in excluded))
        for name in excluded + [
            '/post/1/media/file',
            'post/1/media/../file',
            'post/1/media/',
            'post//1/media/file',
            'post/1/media/a\\b',
            'post/1/media/a\n',
        ]:
            with self.subTest(name=name):
                self.assertFalse(eligible_name(name))
        for prefix in ['post/', 'post/1/', 'post/1/media/', 'post/audio/', 'post/audio/1/file']:
            self.assertEqual(validate_prefix(prefix), prefix)
        for prefix in ['/', 'post', 'post/../', 'audio/', 'post/None/', 'post/1/other/']:
            with self.assertRaises(ValueError):
                validate_prefix(prefix)

    def test_local_symlinks_and_directories_are_never_removed(self):
        """Symlink files, ancestor directories and an aliased root fail closed."""
        key = self.write('post/1/media/target')
        Path(self.root, 'post/1/media/link').symlink_to(Path(self.root, key))
        Path(self.root, 'post/2').symlink_to(Path(self.root, 'post/1'), target_is_directory=True)
        self.run_cleanup(delete=True, prefix=['post/2/'])
        self.assertTrue(self.storage.exists(key))
        self.assertTrue(Path(self.root, 'post/1/media/link').is_symlink())
        self.assertTrue(Path(self.root, 'post/2').is_symlink())
        with TemporaryDirectory() as other:
            alias = Path(other, 'alias')
            alias.symlink_to(self.root, target_is_directory=True)
            with mock.patch(f'{COMMAND}.storages', {'default': FileSystemStorage(location=alias)}):
                with self.assertRaisesMessage(CommandError, 'symlinks'):
                    self.run_cleanup(delete=True)

    def test_prefix_narrows_and_overlap_does_not_duplicate(self):
        """Repeated or overlapping prefixes cannot expand the deletion scope."""
        yes = self.write('post/audio/1/yes')
        no = self.write('post/audio/2/no')
        self.run_cleanup(
            delete=True, prefix=['post/audio/1/', 'post/audio/1/yes', 'post/audio/1/']
        )
        self.assertFalse(self.storage.exists(yes))
        self.assertTrue(self.storage.exists(no))
        self.assertEqual(self.summary()['deleted'], 1)

    def test_reference_appearing_after_batch_check_is_preserved(self):
        """A fresh reference wins over an earlier inventory snapshot."""
        key = self.write('post/1/media/race')
        original = find_referenced_names

        def snapshot(*args, **kwargs):
            result = original(*args, **kwargs)
            self.media(key)
            return result

        with mock.patch(f'{COMMAND}.find_referenced_names', side_effect=snapshot):
            self.run_cleanup(delete=True)
        self.assertTrue(self.storage.exists(key))
        self.assertEqual(self.summary()['deleted'], 0)

    def test_changed_metadata_and_disappearing_object_are_skipped(self):
        """Neither an overwritten object nor a vanished candidate is reported deleted."""
        key = self.write('post/1/media/change')
        for second in (OLD - timedelta(seconds=1), FileNotFoundError()):
            with (
                self.subTest(second=second),
                mock.patch.object(self.storage, 'get_modified_time', side_effect=[OLD, second]),
            ):
                self.run_cleanup(delete=True)
                self.assertEqual(self.summary()['deleted'], 0)
                self.assertTrue(self.storage.exists(key))
        with mock.patch.object(self.storage, 'size', side_effect=[5, 6]):
            self.run_cleanup(delete=True)
            self.assertEqual(self.summary()['deleted'], 0)

    def test_inventory_file_replaced_by_directory_is_preserved(self):
        """A stale file inventory entry cannot authorize deleting an empty directory."""
        name = 'post/1/media/replaced'
        Path(self.root, name).mkdir(parents=True)
        os.utime(self.storage.path(name), (OLD.timestamp(), OLD.timestamp()))
        with mock.patch(
            f'{COMMAND}.iter_storage_batches',
            return_value=(batch for batch in [[InventoryEntry(name)]]),
        ):
            self.run_cleanup(delete=True)
        self.assertTrue(Path(self.root, name).is_dir())
        self.assertEqual(self.summary()['deleted'], 0)

    def test_database_and_listing_failures_abort(self):
        """Errors in either safety source produce a nonzero, incomplete report."""
        key = self.write('post/1/media/safe')
        for target, error in [
            (f'{COMMAND}.find_referenced_names', DatabaseError()),
            ('apps.uploads.inventory.os.scandir', OSError()),
        ]:
            with self.subTest(target=target), mock.patch(target, side_effect=error):
                with self.assertRaises(CommandError):
                    self.run_cleanup(delete=True)
                self.assertTrue(self.summary()['incomplete'])
                self.assertEqual(self.summary()['deleted'], 0)
                self.assertTrue(self.storage.exists(key))

    def test_recheck_database_failure_aborts_before_delete(self):
        """A failed fresh reference lookup cannot authorize removal."""
        key = self.write('post/1/media/recheck')
        with mock.patch(
            'apps.blogs.media_cleanup.find_referenced_names', side_effect=DatabaseError()
        ):
            with self.assertRaises(CommandError):
                self.run_cleanup(delete=True)
        self.assertTrue(self.storage.exists(key))
        self.assertEqual(self.summary()['deletion_attempts'], 0)

    def test_delete_failure_stops_run_and_never_logs_secrets(self):
        """A failed removal ends the run and is never counted as a success."""
        self.write('post/1/media/first')
        self.write('post/1/media/second')
        with mock.patch.object(
            self.storage, 'delete', side_effect=OSError('signed-url-secret')
        ) as delete:
            with self.assertRaises(CommandError):
                self.run_cleanup(delete=True)
        delete.assert_called_once()
        self.assertEqual(self.summary()['deletion_attempts'], 1)
        self.assertEqual(self.summary()['deleted'], 0)
        self.assertTrue(self.summary()['incomplete'])
        self.assertNotIn('signed-url-secret', self.output.getvalue())

    def test_missing_during_delete_is_a_harmless_skip(self):
        """A removal racing an already missing file does not claim success."""
        self.write('post/1/media/missing')
        with mock.patch.object(self.storage, 'delete', side_effect=FileNotFoundError()):
            self.run_cleanup(delete=True)
        self.assertEqual(self.summary()['deleted'], 0)
        self.assertEqual(self.summary()['deletion_attempts'], 1)

    def test_all_caps_mark_reports_incomplete(self):
        """Scan, attempt and row budgets remain finite even across batches."""
        for index in range(5):
            self.write(f'post/1/media/{index}')
            self.media(f'post/99/media/row-{index}')
        self.run_cleanup(max_scan=3, max_row_report=2, batch_size=1)
        self.assertEqual(self.summary()['scanned'], 3)
        self.assertEqual(self.summary()['unattached_rows'], 2)
        self.assertEqual(set(self.summary()['caps']), {'max_scan', 'max_row_report'})
        self.run_cleanup(delete=True, max_delete=2, batch_size=1)
        self.assertEqual(self.summary()['deleted'], 2)
        self.assertIn('max_delete', self.summary()['caps'])
        self.assertEqual(Media.objects.count(), 5)

    def test_local_inventory_is_bounded_and_does_not_call_listdir(self):
        """Streaming local enumeration counts directories and excluded entries too."""
        for index in range(10):
            self.write(f'post/1/media/{index}')
        with mock.patch.object(self.storage, 'listdir', side_effect=AssertionError('unbounded')):
            batches = list(
                iter_storage_batches(self.storage, prefixes=[], batch_size=2, max_scan=5)
            )
        self.assertEqual([len(batch) for batch in batches], [2, 2, 1])
        self.assertEqual(sum(len(batch) for batch in batches), 5)

    def test_r2_pages_caps_and_storage_relative_keys(self):
        """Guarded R2 uses configured pagination and never a local path or new client."""
        with self.remote('uploads') as storage:
            for index in range(6):
                storage.objects[f'uploads/post/audio/1/{index}'] = (OLD, 5)
            storage.objects['uploads/post/audio/1/marker/'] = (OLD, 0)
            self.media('', s3_file_key='uploads/post/audio/1/0')
            with mock.patch.object(storage, 'path', side_effect=AssertionError('remote path')):
                self.run_cleanup(delete=True, batch_size=2, max_scan=5)
            self.assertEqual(storage.deleted, [f'post/audio/1/{i}' for i in range(1, 5)])
            self.assertIn('max_scan', self.summary()['caps'])
            self.assertEqual(storage.page_requests[0]['Bucket'], 'test-bucket')
            self.assertEqual(storage.page_requests[0]['Prefix'], 'uploads/post/')
            self.assertEqual(
                storage.page_requests[0]['PaginationConfig'], {'PageSize': 2, 'MaxItems': 5}
            )

    def test_remote_dry_run_and_directory_marker(self):
        """The remote adapter has the same report-only defaults and namespace exclusions."""
        with self.remote() as storage:
            storage.objects.update(
                {
                    'post/1/media/old': (OLD, 10),
                    'post/1/media/recent': (NOW, 10),
                    'post/1/media/marker/': (OLD, 0),
                    'avatars/avatar': (OLD, 10),
                }
            )
            self.run_cleanup()
            self.assertEqual(self.summary()['candidates'], 1)
            self.assertEqual(storage.deleted, [])
            self.run_cleanup(delete=True)
            self.assertEqual(storage.deleted, ['post/1/media/old'])

    def test_r2_multiple_prefixes_share_one_scan_budget(self):
        """Distinct R2 prefixes share a single finite enumeration allowance."""
        with self.remote() as storage:
            storage.objects.update(
                {
                    'post/audio/1/a': (OLD, 1),
                    'post/audio/2/b': (OLD, 1),
                    'post/audio/2/c': (OLD, 1),
                }
            )
            self.run_cleanup(
                batch_size=1,
                max_scan=2,
                prefix=['post/audio/1/', 'post/audio/2/'],
            )
            self.assertEqual(self.summary()['scanned'], 2)
            self.assertEqual(self.summary()['candidates'], 2)
            self.assertEqual(storage.page_requests[1]['PaginationConfig']['MaxItems'], 1)

    def test_r2_filefield_locations_map_to_physical_bucket_keys(self):
        """FileField names are relative; s3_file_key values remain bucket-root keys."""
        with self.remote('uploads') as storage:
            storage.objects['uploads/post/1/media/reference'] = (OLD, 5)
            other = FakeRemoteStorage('uploads/post')
            field = Media._meta.get_field('file')
            self.media('1/media/reference')
            with mock.patch.object(field, 'storage', other):
                self.run_cleanup(delete=True)
            self.assertEqual(storage.deleted, [])
            self.assertEqual(self.summary()['protected_references'], 1)

    def test_r2_missing_metadata_is_skipped(self):
        """A guarded backend's NoSuchKey response is a harmless vanished candidate."""
        with self.remote() as storage:
            storage.objects['post/audio/1/missing'] = (OLD, 1)
            error = ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
            with mock.patch.object(storage, 'get_modified_time', side_effect=error):
                records = self.run_cleanup(delete=True)
            self.assertEqual(storage.deleted, [])
            self.assertIn('missing', [record.get('reason') for record in records])

    def test_r2_listing_cannot_escape_requested_prefix(self):
        """An inconsistent paginator response aborts instead of expanding scope."""
        with self.remote() as storage:
            storage.client.get_paginator.return_value.paginate.side_effect = None
            storage.client.get_paginator.return_value.paginate.return_value = [
                {'Contents': [{'Key': 'avatars/outside'}]}
            ]
            with self.assertRaises(CommandError):
                self.run_cleanup(delete=True)
            self.assertEqual(storage.deleted, [])

    def test_r2_deletion_cap_across_pages_and_overlapping_prefixes(self):
        """Only capped attempts occur even when inventory spans several R2 pages."""
        with self.remote() as storage:
            storage.objects.update({f'post/audio/1/{i}': (OLD, 1) for i in range(10)})
            self.run_cleanup(
                delete=True, batch_size=2, max_delete=3, prefix=['post/', 'post/audio/1/']
            )
            self.assertEqual(len(storage.deleted), 3)
            self.assertEqual(len(storage.page_requests), 1)
            self.assertIn('max_delete', self.summary()['caps'])

    def test_r2_listing_failure_is_fatal(self):
        """Paginator failures cannot become an empty successful scan."""
        with self.remote() as storage:
            storage.client.get_paginator.side_effect = OSError()
            with self.assertRaises(CommandError):
                self.run_cleanup(delete=True)
            self.assertTrue(self.summary()['incomplete'])

    def test_unsupported_and_ambiguous_storage_mappings_refuse_run(self):
        """Unrecognized backends and hidden reference mappings fail closed."""
        with mock.patch(f'{COMMAND}.storages', {'default': object()}):
            with self.assertRaisesMessage(CommandError, 'Unsupported'):
                self.run_cleanup(delete=True)
        with mock.patch.object(get_user_model()._meta.get_field('avatar'), 'storage', object()):
            with self.assertRaisesMessage(CommandError, 'Unsupported'):
                self.run_cleanup(delete=True)
        with self.remote() as storage:
            other = FakeRemoteStorage()
            other.bucket_name = 'different-bucket'
            with mock.patch.object(Media._meta.get_field('file'), 'storage', other):
                with self.assertRaisesMessage(CommandError, 'Ambiguous'):
                    self.run_cleanup(delete=True)
            storage.endpoint_url = 'https://secret@test.invalid/?signature=secret'
            with self.assertRaises(CommandError):
                self.run_cleanup(delete=True)
            self.assertNotIn('signature', self.output.getvalue())

    def test_reference_mapping_between_local_roots(self):
        """A field under a parent storage root still protects the physical object."""
        key = self.write('post/1/media/shared')
        field = get_user_model()._meta.get_field('avatar')
        parent = FileSystemStorage(location=Path(self.root).parent)
        get_user_model().objects.filter(pk=self.user.pk).update(
            avatar=f'{Path(self.root).name}/{key}'
        )
        with mock.patch.object(field, 'storage', parent):
            fields = collect_reference_fields(self.storage)
            self.assertEqual(find_referenced_names(self.storage, [key], fields), {key})

    def test_escaped_json_records(self):
        """Keys are JSON escaped so filenames cannot inject additional records."""
        key = self.write('post/1/media/a"quoted')
        records = self.run_cleanup()
        self.assertIn(key, [record.get('key') for record in records])
        self.assertIn('a\\"quoted', self.output.getvalue())

    def test_failed_transaction_leaves_reclaimable_saved_file(self):
        """Rollback removes rows but leaves the bytes written by FileField.save()."""
        name = None
        with mock.patch('apps.blogs.models.get_field_file_duration', return_value=None):
            with self.assertRaises(DatabaseError), transaction.atomic():
                post = Post.objects.create(author=self.user)
                media = Media.objects.create(
                    id=post.pk, file=SimpleUploadedFile('rollback.bin', b'data')
                )
                name = media.file.name
                post.media = media
                post.save(update_fields=['media'])
                raise DatabaseError('late failure')
        self.assertFalse(Media.objects.filter(file=name).exists())
        self.assertFalse(Post.objects.filter(media__file=name).exists())
        os.utime(self.storage.path(name), (OLD.timestamp(), OLD.timestamp()))
        self.run_cleanup(delete=True)
        self.assertFalse(self.storage.exists(name))

    def test_individual_delete_cleans_up_without_command(self):
        """Existing individual deletion still removes media rows and stored originals."""
        name = self.write('post/1/media/individual')
        media = self.media(name)
        post = Post.objects.create(author=self.user, media=media)
        post.delete()
        self.assertFalse(self.storage.exists(name))
        self.assertFalse(Media.objects.filter(pk=media.pk).exists())

    def test_post_bulk_admin_and_user_cascade_leave_report_only_media(self):
        """Existing bulk/admin/cascade gaps are reproduced, never repaired by row pruning."""
        for mode in ('queryset', 'admin', 'cascade'):
            with self.subTest(mode=mode):
                user = get_user_model().objects.create_user(username=mode)
                name = self.write(f'post/audio/{user.pk}/{mode}')
                media = self.media(name)
                post = Post.objects.create(author=user, media=media)
                if mode == 'queryset':
                    Post.objects.filter(pk=post.pk).delete()
                elif mode == 'admin':
                    admin.ModelAdmin(Post, admin.site).delete_queryset(
                        None, Post.objects.filter(pk=post.pk)
                    )
                else:
                    user.delete()
                self.assertTrue(Media.objects.filter(pk=media.pk, post__isnull=True).exists())
                self.run_cleanup(delete=True)
                self.assertTrue(self.storage.exists(name))
                self.assertTrue(Media.objects.filter(pk=media.pk).exists())

    def test_bulk_media_delete_leaves_reclaimable_files_and_null_relation(self):
        """Bulk media deletion leaves file orphans and clears the post's media relation."""
        name = self.write('post/1/media/bulk')
        media = self.media(name)
        post = Post.objects.create(author=self.user, media=media)
        admin.ModelAdmin(Media, admin.site).delete_queryset(
            None, Media.objects.filter(pk=media.pk)
        )
        post.refresh_from_db()
        self.assertIsNone(post.media_id)
        self.assertTrue(self.storage.exists(name))
        self.run_cleanup(delete=True)
        self.assertFalse(self.storage.exists(name))

    def test_cascade_preview_files_are_excluded(self):
        """Cascaded preview bytes remain outside this command's audited namespaces."""
        name = self.write('link_previews/cascade.jpg')
        post = Post.objects.create(author=self.user)
        LinkPreview.objects.create(post=post, url='https://example.com', image=name)
        Post.objects.filter(pk=post.pk).delete()
        self.run_cleanup(delete=True)
        self.assertTrue(self.storage.exists(name))

    def test_failed_thumbnail_update_leaves_reclaimable_derivative(self):
        """A failed derivative DB write leaves bytes while original references remain."""
        original = self.write('post/1/media/original')
        media = self.media(original)
        with mock.patch.object(media, 'save', side_effect=DatabaseError()):
            with self.assertRaises(DatabaseError):
                save_media_thumbnail(media, ContentFile(b'thumbnail'), 'derivative.jpg')
        derivative = media.thumbnail.name
        media.refresh_from_db()
        self.assertFalse(media.thumbnail)
        self.assertTrue(self.storage.exists(derivative))
        os.utime(self.storage.path(derivative), (OLD.timestamp(), OLD.timestamp()))
        self.run_cleanup(delete=True)
        self.assertFalse(self.storage.exists(derivative))
        self.assertTrue(self.storage.exists(original))
