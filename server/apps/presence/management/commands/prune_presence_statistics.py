"""Delete expired daily statistics and inactive browser pseudonyms."""

from django.core.management.base import BaseCommand, CommandError

from apps.presence.statistics import prune_statistics


class Command(BaseCommand):
    """Prune retained statistics; safe to schedule even while presence is disabled."""

    help = 'Prune expired presence daily statistics and inactive visitor pseudonyms.'

    def add_arguments(self, parser):
        """Allow an explicit retention window for independently scheduled runs."""
        parser.add_argument('--retention-days', type=int, default=None)

    def handle(self, *args, **options):
        """Apply retention without reading the private statistics endpoint."""
        try:
            result = prune_statistics(retention_days=options['retention_days'])
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(
            f"Pruned before {result['before']}: {result['daily_visits']} daily visits, "
            f"{result['daily_summaries']} daily summaries, {result['visitors']} inactive visitors."
        )
