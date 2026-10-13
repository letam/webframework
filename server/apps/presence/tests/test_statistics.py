"""Privacy, daily deduplication, retention, aggregates and Postgres races."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from io import StringIO
from threading import Barrier
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, IntegrityError, close_old_connections, connection, transaction
from django.http import Http404
from django.test import RequestFactory, TestCase, TransactionTestCase, override_settings

from apps.presence.models import DailyPresenceSummary, DailyVisit, Visitor
from apps.presence.statistics import (
    hash_visitor,
    local_day,
    prune_statistics,
    record_peak,
    record_visit,
)
from apps.presence.views import stats

_SETTINGS = {
    'PRESENCE_ENABLED': True,
    'PRESENCE_HASH_KEY': 'test-only-key-for-scoped-visitor-pseudonyms',
    'PRESENCE_TIME_ZONE': 'America/Toronto',
    'PRESENCE_RETENTION_DAYS': 400,
    'PRESENCE_STATS_TOKEN': 'private-test-token',
    'PRESENCE_SCOPES': {'wholy': {}, 'other': {}},
}
_NOW = datetime(2026, 10, 13, 16, 0, tzinfo=UTC)
_BROWSER = '0e78152d-1908-41b3-9d11-f8cc6439fabb'


@override_settings(**_SETTINGS)
class VisitorStatisticsTests(TestCase):
    """Run ordinary durable statistics tests without Redis or active realtime."""

    def setUp(self):
        """Create a safe pseudonym reused across date and scope tests."""
        self.visitor_key = hash_visitor('wholy', _BROWSER)

    def test_hash_is_normalized_keyed_and_scoped(self):
        """One browser's pseudonym changes with the configured scope or secret."""
        self.assertRegex(self.visitor_key, r'^[0-9a-f]{64}$')
        self.assertEqual(self.visitor_key, hash_visitor('wholy', _BROWSER.upper()))
        self.assertEqual(self.visitor_key, hash_visitor('wholy', _BROWSER.replace('-', '')))
        self.assertNotIn(_BROWSER, self.visitor_key)
        self.assertNotEqual(self.visitor_key, hash_visitor('other', _BROWSER))
        with override_settings(PRESENCE_HASH_KEY='a-different-test-only-key'):
            self.assertNotEqual(self.visitor_key, hash_visitor('wholy', _BROWSER))

    def test_hash_rejects_missing_secret_and_invalid_identifiers(self):
        """Misconfiguration cannot silently fall back to an unkeyed digest."""
        with override_settings(PRESENCE_HASH_KEY=''):
            with self.assertRaises(ImproperlyConfigured):
                hash_visitor('wholy', _BROWSER)
        for identifier in ('private-invalid-input', '00000000-0000-0000-0000-000000000000', None):
            with self.subTest(identifier_type=type(identifier).__name__):
                with self.assertRaisesMessage(ValueError, 'Invalid visitor identifier') as error:
                    hash_visitor('wholy', identifier)
                self.assertNotIn('private-invalid-input', str(error.exception))

    def test_service_rejects_raw_identifiers_unknown_scopes_and_naive_time(self):
        """Only scoped digest input and aware server observations reach storage."""
        with self.assertRaisesMessage(ValueError, 'Invalid visitor pseudonym'):
            record_visit('wholy', _BROWSER, _NOW)
        with self.assertRaisesMessage(ValueError, 'Unknown presence scope'):
            record_visit('unconfigured', self.visitor_key, _NOW)
        with self.assertRaisesMessage(ValueError, 'Unknown presence scope'):
            hash_visitor('unconfigured', _BROWSER)
        with self.assertRaisesMessage(ValueError, 'aware timestamp'):
            record_visit('wholy', self.visitor_key, _NOW.replace(tzinfo=None))
        self.assertFalse(Visitor.objects.exists())
        self.assertFalse(DailyVisit.objects.exists())
        self.assertFalse(DailyPresenceSummary.objects.exists())

    def test_reload_tabs_and_retries_create_one_classified_daily_visit(self):
        """Repeated acknowledgements leave both durable rows and counters stable."""
        first = record_visit('wholy', self.visitor_key, _NOW)
        second = record_visit('wholy', self.visitor_key, _NOW + timedelta(hours=1))
        self.assertEqual(first, {'day': '2026-10-13', 'is_new': True, 'created': True})
        self.assertEqual(second, {'day': '2026-10-13', 'is_new': True, 'created': False})
        self.assertEqual(Visitor.objects.count(), 1)
        self.assertEqual(DailyVisit.objects.count(), 1)
        visitor = Visitor.objects.get()
        self.assertEqual(visitor.visitor_key, self.visitor_key)
        self.assertEqual(visitor.first_seen, date(2026, 10, 13))
        self.assertEqual(visitor.last_seen, date(2026, 10, 13))
        self.assertEqual(visitor.updated_at, _NOW)
        summary = DailyPresenceSummary.objects.get()
        self.assertEqual((summary.new_visitors, summary.returning_visitors), (1, 0))
        self.assertEqual(summary.updated_at, _NOW)

    def test_midnight_without_reconnect_records_returning_visit(self):
        """Renewal can acknowledge a new Toronto day while the socket stays open."""
        before_midnight = datetime(2026, 10, 13, 3, 59, tzinfo=UTC)
        after_midnight = datetime(2026, 10, 13, 4, 1, tzinfo=UTC)
        yesterday = record_visit('wholy', self.visitor_key, before_midnight)
        today = record_visit('wholy', self.visitor_key, after_midnight)
        retry = record_visit('wholy', self.visitor_key, after_midnight + timedelta(seconds=20))
        self.assertEqual(yesterday, {'day': '2026-10-12', 'is_new': True, 'created': True})
        self.assertEqual(today, {'day': '2026-10-13', 'is_new': False, 'created': True})
        self.assertEqual(retry, {'day': '2026-10-13', 'is_new': False, 'created': False})
        visitor = Visitor.objects.get()
        self.assertEqual(visitor.first_seen, date(2026, 10, 12))
        self.assertEqual(visitor.last_seen, date(2026, 10, 13))
        today_summary = DailyPresenceSummary.objects.get(day=date(2026, 10, 13))
        self.assertEqual((today_summary.new_visitors, today_summary.returning_visitors), (0, 1))

    def test_day_uses_configured_timezone_across_daylight_saving_fallback(self):
        """Repeated local clock hours share the same daily deduplication key."""
        first_hour = datetime(2026, 11, 1, 5, 30, tzinfo=UTC)
        repeated_hour = datetime(2026, 11, 1, 6, 30, tzinfo=UTC)
        self.assertEqual(local_day(first_hour), date(2026, 11, 1))
        self.assertEqual(local_day(repeated_hour), date(2026, 11, 1))
        record_visit('wholy', self.visitor_key, first_hour)
        self.assertFalse(record_visit('wholy', self.visitor_key, repeated_hour)['created'])

    def test_browser_is_new_independently_in_another_scope(self):
        """The same browser cannot link scoped reports through a shared digest."""
        record_visit('wholy', self.visitor_key, _NOW - timedelta(days=1))
        other_key = hash_visitor('other', _BROWSER)
        result = record_visit('other', other_key, _NOW)
        self.assertTrue(result['is_new'])
        self.assertEqual(Visitor.objects.count(), 2)
        self.assertEqual(DailyPresenceSummary.objects.get(scope='other').new_visitors, 1)

    def test_database_enforces_daily_uniqueness_without_acknowledgement_cache(self):
        """A duplicate row fails even if service or Redis deduplication is bypassed."""
        record_visit('wholy', self.visitor_key, _NOW)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DailyVisit.objects.create(
                visitor=Visitor.objects.get(),
                scope='wholy',
                day=local_day(_NOW),
                is_new=True,
                created_at=_NOW,
            )

    def test_visit_and_summary_roll_back_together_on_failure(self):
        """An aggregate failure cannot leave a visited day without its counter."""
        with patch.object(DailyPresenceSummary.objects, 'get_or_create', side_effect=RuntimeError):
            with self.assertRaises(RuntimeError):
                record_visit('wholy', self.visitor_key, _NOW)
        self.assertFalse(Visitor.objects.exists())
        self.assertFalse(DailyVisit.objects.exists())

    def test_peak_is_monotonic_and_does_not_write_repeated_or_lower_counts(self):
        """Coalesced observations store increases and preserve update timestamps."""
        record_peak('wholy', 7, _NOW)
        record_peak('wholy', 7, _NOW + timedelta(minutes=1))
        record_peak('wholy', 2, _NOW + timedelta(minutes=2))
        summary = DailyPresenceSummary.objects.get()
        self.assertEqual(summary.peak_active, 7)
        self.assertEqual(summary.updated_at, _NOW)
        record_visit('wholy', self.visitor_key, _NOW + timedelta(minutes=3))
        record_peak('wholy', 11, _NOW + timedelta(minutes=4))
        summary.refresh_from_db()
        self.assertEqual(summary.peak_active, 11)
        self.assertEqual(summary.new_visitors, 1)
        self.assertEqual(summary.updated_at, _NOW + timedelta(minutes=4))

    def test_invalid_peak_counts_are_not_persisted(self):
        """Malformed or oversized counts cannot poison the daily report."""
        for count in (-1, True, 1.5, '2', 2_147_483_648):
            with self.subTest(count=count):
                with self.assertRaises(ValueError):
                    record_peak('wholy', count, _NOW)
        self.assertFalse(DailyPresenceSummary.objects.exists())

    def test_retention_prunes_old_days_and_only_inactive_visitors(self):
        """The rolling window keeps its boundary and recent returning visitors."""
        inactive = hash_visitor('wholy', str(uuid4()))
        boundary = _NOW - timedelta(days=399)
        old = _NOW - timedelta(days=400)
        record_visit('wholy', inactive, old)
        record_visit('wholy', self.visitor_key, old)
        record_visit('wholy', self.visitor_key, _NOW)
        boundary_key = hash_visitor('wholy', str(uuid4()))
        record_visit('wholy', boundary_key, boundary)
        result = prune_statistics(_NOW)
        self.assertEqual(
            result,
            {
                'before': local_day(boundary).isoformat(),
                'daily_visits': 2,
                'daily_summaries': 1,
                'visitors': 1,
            },
        )
        self.assertEqual(
            set(Visitor.objects.values_list('visitor_key', flat=True)),
            {self.visitor_key, boundary_key},
        )
        self.assertEqual(DailyVisit.objects.count(), 2)
        self.assertEqual(DailyPresenceSummary.objects.count(), 2)
        self.assertTrue(record_visit('wholy', inactive, _NOW)['is_new'])

    @override_settings(PRESENCE_ENABLED=False, PRESENCE_RETENTION_DAYS=2)
    def test_retention_command_runs_independently_while_feature_disabled(self):
        """Scheduled cleanup needs neither realtime traffic nor a stats page view."""
        record_visit('wholy', self.visitor_key, _NOW - timedelta(days=2))
        output = StringIO()
        with patch('apps.presence.statistics.timezone.now', return_value=_NOW):
            call_command('prune_presence_statistics', stdout=output)
        self.assertFalse(Visitor.objects.exists())
        self.assertIn('1 daily visits, 1 daily summaries, 1 inactive visitors', output.getvalue())
        with self.assertRaises(CommandError):
            call_command('prune_presence_statistics', retention_days=0, stdout=StringIO())


@override_settings(**_SETTINGS)
class StatisticsEndpointTests(TestCase):
    """The private endpoint returns only bounded aggregates under bearer auth."""

    def setUp(self):
        """Create an HTTP request factory without requiring Redis or ASGI."""
        self.factory = RequestFactory()

    def request(self, query='', token='Bearer private-test-token', method='get'):
        """Call the HTTP view with deterministic server time."""
        request = getattr(self.factory, method)(
            '/presence/stats/' + query, HTTP_AUTHORIZATION=token
        )
        with patch('apps.presence.statistics.timezone.now', return_value=_NOW):
            return stats(request)

    def test_bearer_is_required_even_for_staff_session(self):
        """Account cookies and superuser status cannot substitute for the token."""
        for token in (
            '',
            'Basic private-test-token',
            'Bearer wrong',
            'Bearer private-test-token extra',
        ):
            with self.subTest(header_kind=token.split(' ')[0]):
                request = self.factory.get('/presence/stats/', HTTP_AUTHORIZATION=token)
                request.user = SimpleNamespace(
                    is_authenticated=True, is_staff=True, is_superuser=True
                )
                response = stats(request)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response['WWW-Authenticate'], 'Bearer')
                self.assertIn('no-store', response['Cache-Control'])

    def test_credential_comparison_uses_constant_time_primitive(self):
        """Missing and provided bearer credentials both reach compare_digest."""
        with patch('apps.presence.views.secrets.compare_digest', return_value=False) as compare:
            self.assertEqual(self.request(token='').status_code, 401)
            compare.assert_called_once_with(b'', b'private-test-token')
        with override_settings(PRESENCE_STATS_TOKEN=''):
            self.assertEqual(self.request(token='Bearer ').status_code, 401)

    @override_settings(PRESENCE_ENABLED=False)
    def test_disabled_feature_is_not_an_available_http_endpoint(self):
        """Disabling public presence also hides its private report."""
        with self.assertRaises(Http404):
            self.request()
        with self.assertRaises(Http404):
            self.request(method='post')

    def test_endpoint_is_read_only_and_never_cacheable(self):
        """Only an authenticated GET can read statistics."""
        response = self.request(method='post')
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response['Allow'], 'GET')
        response = self.request('?days=1')
        self.assertEqual(response.status_code, 200)
        self.assertIn('no-store', response['Cache-Control'])

    def test_database_failure_returns_an_unavailable_report_without_private_details(self):
        """An outage cannot masquerade as zero visitors or expose database errors."""
        private_detail = 'private SQL value ' + _BROWSER
        with patch.object(
            DailyPresenceSummary.objects, 'filter', side_effect=DatabaseError(private_detail)
        ):
            response = self.request('?days=1')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content), {'error': 'statistics_unavailable'})
        self.assertNotIn(private_detail, response.content.decode())
        self.assertIn('no-store', response['Cache-Control'])

    def test_day_range_is_bounded_before_parsing_or_querying(self):
        """Invalid and oversized date ranges never reach the reporting query."""
        for value in ('0', '401', '-1', '1.5', '', 'nan', '9' * 5000, '١'):
            with self.subTest(value_length=len(value)):
                with self.assertNumQueries(0):
                    response = self.request('?days=' + value)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.request('?days=1&days=2').status_code, 400)
        self.assertEqual(self.request('?days=400').status_code, 200)
        self.assertEqual(json.loads(self.request().content)['days'], 30)

    def test_report_zero_fills_days_and_exports_no_pseudonymous_rows(self):
        """Scoped reports distinguish daily unique visitors from summed visits."""
        first_key = hash_visitor('wholy', _BROWSER)
        second_key = hash_visitor('wholy', str(uuid4()))
        record_visit('wholy', first_key, _NOW - timedelta(days=1))
        record_visit('wholy', first_key, _NOW)
        record_visit('wholy', second_key, _NOW)
        record_peak('wholy', 7, _NOW)
        response = self.request('?days=3')
        payload = json.loads(response.content)
        self.assertEqual(payload['timezone'], 'America/Toronto')
        self.assertEqual((payload['from'], payload['to']), ('2026-10-11', '2026-10-13'))
        self.assertEqual(payload['retention_days'], 400)
        wholy = payload['scopes']['wholy']
        self.assertEqual(wholy['daily_visits'], 3)
        self.assertEqual(wholy['new_visitors'], 2)
        self.assertEqual(wholy['returning_visits'], 1)
        self.assertEqual(wholy['peak_active'], 7)
        self.assertEqual(
            wholy['daily'],
            [
                {
                    'day': '2026-10-11',
                    'visitors': 0,
                    'new_visitors': 0,
                    'returning_visitors': 0,
                    'peak_active': 0,
                },
                {
                    'day': '2026-10-12',
                    'visitors': 1,
                    'new_visitors': 1,
                    'returning_visitors': 0,
                    'peak_active': 0,
                },
                {
                    'day': '2026-10-13',
                    'visitors': 2,
                    'new_visitors': 1,
                    'returning_visitors': 1,
                    'peak_active': 7,
                },
            ],
        )
        self.assertEqual(payload['scopes']['other']['daily_visits'], 0)
        self.assertEqual(len(payload['scopes']['other']['daily']), 3)
        serialized = response.content.decode()
        for private_value in (
            _BROWSER,
            first_key,
            second_key,
            'private-test-token',
            'visitor_key',
        ):
            self.assertNotIn(private_value, serialized)

    def test_report_excludes_unconfigured_scopes_and_dates_outside_window(self):
        """No unconfigured identity scope is exposed through the reporting view."""
        record_peak('other', 99, _NOW)
        record_peak('wholy', 88, _NOW - timedelta(days=1))
        record_peak('wholy', 77, _NOW + timedelta(days=1))
        with override_settings(PRESENCE_SCOPES={'wholy': {}}):
            payload = json.loads(self.request('?days=1').content)
        self.assertEqual(set(payload['scopes']), {'wholy'})
        self.assertEqual(payload['scopes']['wholy']['peak_active'], 0)


@skipUnless(connection.vendor == 'postgresql', 'Postgres row locks required for race checks')
@override_settings(**_SETTINGS)
class PostgresStatisticsConcurrencyTests(TransactionTestCase):
    """Exercise real database connections rather than SQLite locking semantics."""

    def concurrently(self, callbacks):
        """Release independent worker connections together and close each one."""
        barrier = Barrier(len(callbacks))

        def run(callback):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return callback()
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=len(callbacks)) as workers:
            return list(workers.map(run, callbacks))

    def test_concurrent_first_sightings_create_one_new_daily_visit(self):
        """Tabs, reloads and retries cannot multiply the first daily sighting."""
        visitor_key = hash_visitor('wholy', _BROWSER)
        results = self.concurrently(
            [lambda: record_visit('wholy', visitor_key, _NOW) for _ in range(6)]
        )
        self.assertEqual(sum(result['created'] for result in results), 1)
        self.assertTrue(all(result['is_new'] for result in results))
        self.assertEqual(Visitor.objects.count(), 1)
        self.assertEqual(DailyVisit.objects.count(), 1)
        self.assertEqual(DailyPresenceSummary.objects.get().new_visitors, 1)

    def test_concurrent_distinct_visitors_do_not_lose_summary_increments(self):
        """An F expression preserves increments from independent visitor locks."""
        keys = [hash_visitor('wholy', str(uuid4())) for _ in range(6)]
        results = self.concurrently(
            [lambda key=key: record_visit('wholy', key, _NOW) for key in keys]
        )
        self.assertTrue(all(result['created'] for result in results))
        self.assertEqual(DailyVisit.objects.count(), 6)
        self.assertEqual(DailyPresenceSummary.objects.get().new_visitors, 6)

    def test_concurrent_next_day_sightings_create_one_returning_visit(self):
        """The first renewed day retains its returning classification under retries."""
        visitor_key = hash_visitor('wholy', _BROWSER)
        record_visit('wholy', visitor_key, _NOW - timedelta(days=1))
        results = self.concurrently(
            [lambda: record_visit('wholy', visitor_key, _NOW) for _ in range(6)]
        )
        self.assertEqual(sum(result['created'] for result in results), 1)
        self.assertTrue(all(not result['is_new'] for result in results))
        summary = DailyPresenceSummary.objects.get(day=local_day(_NOW))
        self.assertEqual((summary.new_visitors, summary.returning_visitors), (0, 1))

    def test_concurrent_peaks_keep_the_largest_observation(self):
        """A delayed low observation cannot overwrite a higher daily peak."""
        self.concurrently(
            [
                lambda count=count: record_peak('wholy', count, _NOW)
                for count in (2, 15, 7, 4, 11, 3)
            ]
        )
        self.assertEqual(DailyPresenceSummary.objects.count(), 1)
        self.assertEqual(DailyPresenceSummary.objects.get().peak_active, 15)
