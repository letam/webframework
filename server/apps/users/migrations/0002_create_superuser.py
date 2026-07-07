# This migration previously created an 'admin' superuser with the default
# password "admin" on every fresh database, which meant every deployment
# started with publicly known credentials. It is now a no-op; the file remains
# so databases that already applied it keep a consistent migration history.
#
# Superusers are created explicitly via `manage.py createsuperuser` or
# `manage.py init_users`. Migration 0004 revokes the old default credentials
# on databases where they were created.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0001_initial'),
    ]

    operations = []
