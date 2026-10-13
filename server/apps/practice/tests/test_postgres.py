"""Real row-lock concurrency check; never claim SQLite proves worker safety."""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase

from apps.practice.service import apply_command, create_room


class PostgresConcurrencyTests(TransactionTestCase):
    """Verify row locks under independent Postgres connections."""

    def test_competing_commands_accept_one_revision(self):
        """Two workers racing at revision zero accept exactly one start."""
        if connection.vendor != 'postgresql':
            if os.environ.get('REQUIRE_REALTIME_TESTS') == '1':
                self.fail('Real-time acceptance requires Postgres for command races')
            self.skipTest('Requires Postgres SELECT FOR UPDATE')
        user = get_user_model().objects.create_user(username='host', password='examplepass123')
        snapshot, _ = create_room(user.id, 'Together')
        barrier = Barrier(2)

        def start():
            """Wait for the competing worker before applying its transaction."""
            try:
                barrier.wait(timeout=5)
                return apply_command(snapshot['room_id'], user.id, str(uuid4()), 0, 'start')
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(start)
            second = pool.submit(start)
            outcomes = [first.result(timeout=10), second.result(timeout=10)]
        self.assertEqual(sorted(outcome.accepted for outcome in outcomes), [False, True])
        self.assertEqual({outcome.snapshot['revision'] for outcome in outcomes}, {1})
        self.assertEqual({outcome.code for outcome in outcomes}, {'ok', 'revision_conflict'})
