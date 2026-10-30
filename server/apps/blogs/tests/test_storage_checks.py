"""Production storage warnings must be useful without preventing startup."""

import os
from pathlib import Path
from unittest import mock

from config.storage_checks import warn_about_ephemeral_storage
from django.apps import apps
from django.conf import settings
from django.test import SimpleTestCase, override_settings


@override_settings(DEBUG=False, USE_LOCAL_FILE_STORAGE=True, MEDIA_ROOT='/data/uploads')
class StorageWarningTests(SimpleTestCase):
    """Exercise boot diagnostics without opening files or database connections."""

    def setUp(self):
        """Model a production process with a local SQLite file."""
        super().setUp()
        self.enterContext(mock.patch('config.storage_checks.sys.argv', ['gunicorn']))
        self.enterContext(
            mock.patch.dict(
                settings.DATABASES,
                default={'ENGINE': 'django.db.backends.sqlite3', 'NAME': '/data/db.sqlite3'},
            )
        )
        self.stat = self.enterContext(mock.patch('config.storage_checks.os.stat'))
        self.stat.return_value = os.stat_result((0, 0, 1, 0, 0, 0, 0, 0, 0, 0))

    def test_ready_runs_the_storage_check(self):
        """Django's discovered AppConfig wires the diagnostic into startup."""
        with mock.patch('config.storage_checks.warn_about_ephemeral_storage') as check:
            apps.get_app_config('blogs').ready()
        check.assert_called_once_with()

    def test_same_device_warns_for_media_and_sqlite(self):
        """Both a mistyped upload path and database path are visible in logs."""
        with self.assertLogs('server', level='WARNING') as logs:
            warn_about_ephemeral_storage()
        self.assertEqual(len(logs.records), 2)
        self.assertIn(
            'MEDIA_ROOT directory /data/uploads shares the root filesystem', logs.output[0]
        )
        self.assertIn(
            'SQLite DATABASE_URL directory /data shares the root filesystem', logs.output[1]
        )
        self.assertTrue(all(record.levelname == 'WARNING' for record in logs.records))
        self.stat.assert_has_calls(
            [mock.call('/data/uploads'), mock.call('/'), mock.call(Path('/data')), mock.call('/')]
        )

    def test_different_devices_do_not_warn(self):
        """A volume's directory device differs from the container root."""
        self.stat.side_effect = lambda directory: mock.Mock(st_dev=1 if directory == '/' else 2)
        with self.assertNoLogs('server', level='WARNING'):
            warn_about_ephemeral_storage()

    @override_settings(DEBUG=True)
    def test_debug_skips_checks(self):
        """Development commonly keeps all files on one device."""
        with self.assertNoLogs('server', level='WARNING'):
            warn_about_ephemeral_storage()
        self.stat.assert_not_called()

    def test_django_tests_skip_checks(self):
        """AppConfig.ready runs before the test runner replaces storage settings."""
        with mock.patch('config.storage_checks.sys.argv', ['manage.py', 'test', 'apps']):
            with self.assertNoLogs('server', level='WARNING'):
                warn_about_ephemeral_storage()
        self.stat.assert_not_called()

    def test_pytest_skips_checks(self):
        """Alternate test runners also avoid production storage diagnostics."""
        with mock.patch.dict('sys.modules', pytest=mock.Mock()):
            with self.assertNoLogs('server', level='WARNING'):
                warn_about_ephemeral_storage()
        self.stat.assert_not_called()

    @override_settings(USE_LOCAL_FILE_STORAGE=False)
    def test_r2_and_postgres_do_not_check_local_paths(self):
        """Remote media and database storage need no filesystem checks."""
        settings.DATABASES['default'] = {'ENGINE': 'django.db.backends.postgresql'}
        with self.assertNoLogs('server', level='WARNING'):
            warn_about_ephemeral_storage()
        self.stat.assert_not_called()

    @override_settings(USE_LOCAL_FILE_STORAGE=False)
    def test_r2_still_checks_local_sqlite(self):
        """Putting media in R2 does not make an ephemeral SQLite database safe."""
        with self.assertLogs('server', level='WARNING') as logs:
            warn_about_ephemeral_storage()
        self.assertEqual(len(logs.records), 1)
        self.assertIn('SQLite DATABASE_URL', logs.output[0])
        self.stat.assert_has_calls([mock.call(Path('/data')), mock.call('/')])

    def test_postgres_only_checks_local_media(self):
        """An external database does not make local uploads persistent."""
        settings.DATABASES['default'] = {'ENGINE': 'django.db.backends.postgresql'}
        with self.assertLogs('server', level='WARNING') as logs:
            warn_about_ephemeral_storage()
        self.assertEqual(len(logs.records), 1)
        self.assertIn('MEDIA_ROOT', logs.output[0])

    def test_memory_database_is_not_checked(self):
        """In-memory SQLite has no directory whose device can be inspected."""
        settings.DATABASES['default']['NAME'] = ':memory:'
        with self.assertLogs('server', level='WARNING') as logs:
            warn_about_ephemeral_storage()
        self.assertEqual(len(logs.records), 1)
        self.assertIn('MEDIA_ROOT', logs.output[0])
        self.assertEqual(self.stat.call_count, 2)

    def test_stat_errors_warn_without_raising(self):
        """Missing paths, denied access and invalid paths cannot stop boot."""
        for error in (FileNotFoundError(), PermissionError(), OSError(), ValueError()):
            with self.subTest(error=type(error).__name__):
                self.stat.side_effect = error
                with self.assertLogs('server', level='WARNING') as logs:
                    warn_about_ephemeral_storage()
                self.assertEqual(len(logs.records), 2)
                self.assertTrue(all('Could not check' in entry for entry in logs.output))

    def test_root_stat_error_does_not_raise(self):
        """Failure to inspect / is also advisory."""
        self.stat.side_effect = [mock.Mock(st_dev=1), PermissionError()] * 2
        with self.assertLogs('server', level='WARNING') as logs:
            warn_about_ephemeral_storage()
        self.assertEqual(len(logs.records), 2)

    def test_media_stat_error_does_not_skip_database_check(self):
        """A bad upload path must not hide a bad database path."""
        self.stat.side_effect = [FileNotFoundError(), mock.Mock(st_dev=1), mock.Mock(st_dev=1)]
        with self.assertLogs('server', level='WARNING') as logs:
            warn_about_ephemeral_storage()
        self.assertIn('Could not check MEDIA_ROOT', logs.output[0])
        self.assertIn('SQLite DATABASE_URL directory /data shares', logs.output[1])

    def test_relative_database_path_checks_its_parent(self):
        """Check the parsed SQLite path even when DATABASE_URL was relative."""
        settings.DATABASES['default']['NAME'] = 'db.sqlite3'
        with self.assertLogs('server', level='WARNING'):
            warn_about_ephemeral_storage()
        self.stat.assert_any_call(Path('.'))
