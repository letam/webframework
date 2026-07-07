import os
from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from ...models import User


class Command(BaseCommand):
    help = 'Create initial users for app: superuser and anonymous'

    def add_arguments(self, parser):
        # Optional argument
        parser.add_argument('--superuser-only', action='store_true', help='Create only superuser')

    def create_superuser(self):
        """Create a superuser from DJANGO_SUPERUSER_* env vars or interactive prompts."""
        username = os.environ.get('DJANGO_SUPERUSER_USERNAME') or input(
            'Enter a username for the superuser: '
        )
        password = os.environ.get('DJANGO_SUPERUSER_PASSWORD') or getpass(
            'Enter a password for the superuser: '
        )
        if not username or not password:
            raise CommandError('A superuser needs a username and a non-empty password.')
        User.objects.create_superuser(username=username, password=password)
        self.stdout.write(self.style.SUCCESS(f'Created superuser "{username}".'))

    def handle(self, *args, **options):
        if options['superuser_only']:
            self.create_superuser()
            return

        created_any = False

        # Create superuser if none exists. Note that migrations already create
        # the anonymous user, so the database is never fully empty here.
        if not User.objects.filter(is_superuser=True).exists():
            self.create_superuser()
            created_any = True

        # Create anonymous user--for anonymous posts
        _, created = User.objects.get_or_create(username='anonymous')
        if created:
            self.stdout.write(self.style.SUCCESS('Created user "anonymous".'))
            created_any = True

        if not created_any:
            self.stdout.write(self.style.ERROR('Users already exist.'))
