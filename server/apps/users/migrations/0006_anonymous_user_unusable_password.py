from django.contrib.auth.hashers import is_password_usable, make_password
from django.db import migrations


def set_anonymous_password_unusable(apps, schema_editor):
    """Mark the 'anonymous' account's password unusable.

    0003 created it with ``User.objects.create(username='anonymous')`` and no
    password, leaving an empty hash. An empty hash is not a credential any hasher
    can match, so the account is not loginnable today — but make that explicit and
    tamper-evident: an unusable ('!'-prefixed) hash can never be coerced into a
    match, and signals intent to anyone reading the row. Idempotent: rows already
    holding an unusable password are skipped.
    """
    User = apps.get_model('users', 'User')
    for user in User.objects.filter(username='anonymous'):
        # Historical models lack AbstractBaseUser methods, so test the hash directly.
        if is_password_usable(user.password):
            user.password = make_password(None)
            user.save(update_fields=['password'])


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0005_user_avatar'),
    ]

    operations = [
        migrations.RunPython(set_anonymous_password_unusable, migrations.RunPython.noop),
    ]
