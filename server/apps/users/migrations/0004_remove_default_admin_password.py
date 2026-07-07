from django.contrib.auth.hashers import check_password, make_password
from django.db import migrations


def remove_default_admin_password(apps, schema_editor):
    """Lock out the 'admin' account if it still has the old default password.

    Migration 0002 used to create an 'admin' superuser with password "admin" on
    every database. Any deployment still holding those credentials is wide
    open, so mark the password unusable. Set a real password afterwards with
    `manage.py changepassword admin`, or create a fresh superuser with
    `manage.py createsuperuser`.
    """
    User = apps.get_model('users', 'User')
    for admin in User.objects.filter(username='admin'):
        if check_password('admin', admin.password):
            admin.password = make_password(None)
            admin.save(update_fields=['password'])


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0003_create_anonymous_user'),
    ]

    operations = [
        migrations.RunPython(remove_default_admin_password, migrations.RunPython.noop),
    ]
