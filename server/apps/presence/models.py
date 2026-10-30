"""Durable daily statistics; browser identifiers never enter these models."""

from django.db import models
from django.db.models import F, Q


class Visitor(models.Model):
    """A scoped, keyed pseudonym and its observed local dates."""

    scope = models.CharField(max_length=100)
    visitor_key = models.CharField(max_length=64)
    first_seen = models.DateField()
    last_seen = models.DateField(db_index=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        """Keep identity unique within a scope and observation dates ordered."""

        constraints = [
            models.UniqueConstraint(
                fields=['scope', 'visitor_key'], name='presence_visitor_scope_key_unique'
            ),
            models.CheckConstraint(
                condition=Q(first_seen__lte=F('last_seen')), name='presence_visitor_dates_ordered'
            ),
        ]

    def __str__(self):
        """Describe the record without including its browser pseudonym."""
        return f'{self.scope}: visitor'


class DailyVisit(models.Model):
    """One acknowledged visit per scoped browser and local day."""

    visitor = models.ForeignKey(Visitor, on_delete=models.CASCADE, related_name='daily_visits')
    scope = models.CharField(max_length=100)
    day = models.DateField(db_index=True)
    is_new = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        """Make the database the final deduplication boundary."""

        constraints = [
            models.UniqueConstraint(fields=['visitor', 'day'], name='presence_daily_visit_unique')
        ]
        indexes = [models.Index(fields=['scope', 'day'], name='presence_visit_scope_day')]

    def __str__(self):
        """Describe a visit without including a browser identifier."""
        return f'{self.scope}: visit on {self.day}'


class DailyPresenceSummary(models.Model):
    """Daily aggregates with a monotonic, coalesced observed presence peak."""

    scope = models.CharField(max_length=100)
    day = models.DateField(db_index=True)
    new_visitors = models.PositiveIntegerField(default=0)
    returning_visitors = models.PositiveIntegerField(default=0)
    peak_active = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField()

    class Meta:
        """Store one aggregate row per scope and local day."""

        constraints = [
            models.UniqueConstraint(
                fields=['scope', 'day'], name='presence_summary_scope_day_unique'
            )
        ]

    def __str__(self):
        """Describe this aggregate's scope and local day."""
        return f'{self.scope}: summary on {self.day}'
