from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='Visitor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scope', models.CharField(max_length=100)),
                ('visitor_key', models.CharField(max_length=64)),
                ('first_seen', models.DateField()),
                ('last_seen', models.DateField(db_index=True)),
                ('created_at', models.DateTimeField()),
                ('updated_at', models.DateTimeField()),
            ],
            options={
                'constraints': [
                    models.UniqueConstraint(fields=('scope', 'visitor_key'), name='presence_visitor_scope_key_unique'),
                    models.CheckConstraint(condition=models.Q(('first_seen__lte', models.F('last_seen'))), name='presence_visitor_dates_ordered'),
                ],
            },
        ),
        migrations.CreateModel(
            name='DailyPresenceSummary',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scope', models.CharField(max_length=100)),
                ('day', models.DateField(db_index=True)),
                ('new_visitors', models.PositiveIntegerField(default=0)),
                ('returning_visitors', models.PositiveIntegerField(default=0)),
                ('peak_active', models.PositiveIntegerField(default=0)),
                ('updated_at', models.DateTimeField()),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('scope', 'day'), name='presence_summary_scope_day_unique')],
            },
        ),
        migrations.CreateModel(
            name='DailyVisit',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scope', models.CharField(max_length=100)),
                ('day', models.DateField(db_index=True)),
                ('is_new', models.BooleanField()),
                ('created_at', models.DateTimeField()),
                ('visitor', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='daily_visits', to='presence.visitor')),
            ],
            options={
                'indexes': [models.Index(fields=['scope', 'day'], name='presence_visit_scope_day')],
                'constraints': [models.UniqueConstraint(fields=('visitor', 'day'), name='presence_daily_visit_unique')],
            },
        ),
    ]
