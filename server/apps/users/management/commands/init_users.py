import sys
from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from ...models import User


class Command(BaseCommand):
    help = 'Create initial users for app: superuser and anonymous'

    def add_arguments(self, parser):
        # Optional argument
        parser.add_argument('--superuser-only', action='store_true', help='Create only superuser')

    def handle(self, *args, **options):
        user_count = User.objects.count()

        # Exit if users already exist
        if user_count >= 2:
            self.stdout.write(self.style.ERROR('Users already exist.'))
            sys.exit()

        if options['superuser_only']:
            User.objects.create_superuser(username='admin', password='admin')
            self.stdout.write(
                self.style.SUCCESS('Created superuser "admin". Please update the password ASAP.')
            )
            exit()

        # Create superuser
        if user_count == 0:
            username = input('Enter a username for the superuser: ')
            password = getpass('Enter a password for the superuser: ')
            User.objects.create_superuser(username=username, password=password)
            self.stdout.write(self.style.SUCCESS(f'Created superuser "{username}".'))

        # Create anonymous user--for anonymous posts
        User.objects.create(username='anonymous')
        self.stdout.write(self.style.SUCCESS('Created user "anonymous".'))
