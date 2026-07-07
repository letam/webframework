"""Tests for the users app: initial users and default-credential lockout."""

import importlib
import os
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.core.management import call_command
from django.test import TestCase

User = get_user_model()


def run_admin_password_migration():
    """Run migration 0004's data function against the current database."""
    migration = importlib.import_module('apps.users.migrations.0004_remove_default_admin_password')
    migration.remove_default_admin_password(django_apps, None)


class InitialUsersTests(TestCase):
    """Tests for the users created (and not created) by migrations."""

    def test_migrations_do_not_create_default_admin(self):
        """A fresh database must not contain the old admin/admin superuser."""
        self.assertFalse(User.objects.filter(username='admin').exists())

    def test_migrations_create_anonymous_user(self):
        """The dedicated user for anonymous posts is created by migrations."""
        self.assertTrue(User.objects.filter(username='anonymous').exists())


class RemoveDefaultAdminPasswordTests(TestCase):
    """Tests for the migration that revokes the old default admin credentials."""

    def test_default_admin_password_is_revoked(self):
        """An 'admin' account still using the default password gets locked out."""
        admin = User.objects.create_superuser(username='admin', password='admin')

        run_admin_password_migration()

        admin.refresh_from_db()
        self.assertFalse(admin.has_usable_password(), "Default password should be revoked")
        self.assertFalse(check_password('admin', admin.password))

    def test_admin_with_real_password_is_untouched(self):
        """An 'admin' account with a non-default password keeps its password."""
        admin = User.objects.create_superuser(username='admin', password='a-real-password-42')

        run_admin_password_migration()

        admin.refresh_from_db()
        self.assertTrue(check_password('a-real-password-42', admin.password))


class InitUsersCommandTests(TestCase):
    """Tests for the init_users management command."""

    ENV = {'DJANGO_SUPERUSER_USERNAME': 'boss', 'DJANGO_SUPERUSER_PASSWORD': 'env-pass-123'}

    def test_superuser_only_uses_env_credentials(self):
        """init_users --superuser-only reads DJANGO_SUPERUSER_* env vars, no defaults."""
        with mock.patch.dict(os.environ, self.ENV):
            call_command('init_users', '--superuser-only')

        boss = User.objects.get(username='boss')
        self.assertTrue(boss.is_superuser)
        self.assertTrue(check_password('env-pass-123', boss.password))
        self.assertFalse(User.objects.filter(username='admin').exists())

    def test_creates_superuser_when_anonymous_already_exists(self):
        """On a fresh database (anonymous user from migrations), a superuser is still created."""
        self.assertTrue(User.objects.filter(username='anonymous').exists())

        with mock.patch.dict(os.environ, self.ENV):
            call_command('init_users')

        self.assertTrue(User.objects.get(username='boss').is_superuser)
        self.assertEqual(User.objects.filter(username='anonymous').count(), 1)

    def test_rerun_is_idempotent(self):
        """Running init_users again does not crash or duplicate users."""
        with mock.patch.dict(os.environ, self.ENV):
            call_command('init_users')
            call_command('init_users')

        self.assertEqual(User.objects.filter(username='boss').count(), 1)
        self.assertEqual(User.objects.filter(username='anonymous').count(), 1)
