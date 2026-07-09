"""Tests for the users app: initial users and default-credential lockout."""

import importlib
import io
import os
import shutil
import tempfile
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.blogs.models import Post

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


class AvatarUploadTests(TestCase):
    """Tests for authenticated avatar upload, processing, and removal."""

    def setUp(self):
        """Create a user, client, and isolated media storage."""
        self.media_root = tempfile.mkdtemp()
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MEDIA_URL='/media/',
            STORAGES={
                'default': {
                    'BACKEND': 'django.core.files.storage.FileSystemStorage',
                },
                'staticfiles': {
                    'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage',
                },
            },
        )
        self.settings_override.enable()
        self.user = User.objects.create_user(
            username='avatar-user', password='testpass123', first_name='Ava', last_name='Tar'
        )
        self.client = APIClient()
        self.url = reverse('user-avatar')

    def tearDown(self):
        """Remove temporary media storage and restore settings."""
        self.settings_override.disable()
        shutil.rmtree(self.media_root)
        super().tearDown()

    def _image_upload(self, name='avatar.png', size=(800, 400), color=(50, 80, 120, 255)):
        output = io.BytesIO()
        Image.new('RGBA', size, color).save(output, format='PNG')
        return SimpleUploadedFile(name, output.getvalue(), content_type='image/png')

    def test_avatar_upload_processes_to_square_jpeg_and_serializes_url(self):
        """Uploading an image creates a 512px JPEG and exposes its URL."""
        self.client.force_login(self.user)

        response = self.client.post(self.url, {'avatar': self._image_upload()}, format='multipart')

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.avatar)
        self.assertEqual(
            response.data['avatar'], self.user.avatar.storage.url(self.user.avatar.name)
        )

        with Image.open(self.user.avatar.path) as image:
            self.assertEqual(image.size, (512, 512))
            self.assertEqual(image.format, 'JPEG')
            self.assertEqual(image.mode, 'RGB')

        post = Post.objects.create(author=self.user, head='Avatar post')
        post_response = self.client.get(reverse('post-detail', args=[post.id]))
        self.assertEqual(post_response.status_code, 200)
        self.assertEqual(post_response.data['author']['avatar'], response.data['avatar'])

        status_response = self.client.get('/auth/status/')
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.json()['avatar'], response.data['avatar'])

    def test_avatar_upload_rejects_oversize_non_image_and_anonymous_requests(self):
        """Avatar uploads require auth, fit within 5 MB, and contain image bytes."""
        anonymous_response = self.client.post(
            self.url, {'avatar': self._image_upload()}, format='multipart'
        )
        self.assertEqual(anonymous_response.status_code, 401)

        self.client.force_login(self.user)
        huge_file = SimpleUploadedFile(
            'huge.png', b'0' * (5 * 1024 * 1024 + 1), content_type='image/png'
        )
        oversize_response = self.client.post(self.url, {'avatar': huge_file}, format='multipart')
        self.assertEqual(oversize_response.status_code, 400)

        text_file = SimpleUploadedFile('avatar.png', b'not an image', content_type='image/png')
        non_image_response = self.client.post(self.url, {'avatar': text_file}, format='multipart')
        self.assertEqual(non_image_response.status_code, 400)

    def test_avatar_replacement_deletes_old_file_and_delete_clears_avatar(self):
        """Replacing and deleting avatars removes obsolete storage objects."""
        self.client.force_login(self.user)
        first_response = self.client.post(
            self.url, {'avatar': self._image_upload('first.png')}, format='multipart'
        )
        self.assertEqual(first_response.status_code, 200)
        self.user.refresh_from_db()
        first_name = self.user.avatar.name
        storage = self.user.avatar.storage

        with mock.patch.object(storage, 'delete', wraps=storage.delete) as delete_mock:
            second_response = self.client.put(
                self.url, {'avatar': self._image_upload('second.png')}, format='multipart'
            )

        self.assertEqual(second_response.status_code, 200)
        delete_mock.assert_called_with(first_name)
        self.assertFalse(storage.exists(first_name))

        self.user.refresh_from_db()
        second_name = self.user.avatar.name
        delete_response = self.client.delete(self.url)
        self.user.refresh_from_db()

        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.data, {'avatar': None})
        self.assertFalse(self.user.avatar)
        self.assertFalse(storage.exists(second_name))
