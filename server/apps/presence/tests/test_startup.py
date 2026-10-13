"""Exercise the production server selection with isolated executable stand-ins."""

import os
import shlex
import signal
import subprocess
import sys
import tempfile
from contextlib import suppress
from pathlib import Path

from django.test import SimpleTestCase

SERVER = Path(__file__).resolve().parents[3]


class ProductionStartupTests(SimpleTestCase):
    """A shared transport limit must admit each enabled feature's valid messages."""

    def startup(self, **overrides):
        """Run the real entrypoint without migrations, workers or network listeners."""
        environment = {
            **os.environ,
            'SECRET_KEY': 'isolated-startup-test',
            'DEBUG': 'True',
            'DATABASE_URL': 'postgresql://startup_test@127.0.0.1/startup_test',
            'REALTIME_ENABLED': 'True',
            'REALTIME_REDIS_URL': 'redis://127.0.0.1:6379/0',
            'PRESENCE_ENABLED': 'False',
            'PRACTICE_ENABLED': 'True',
            'PRACTICE_ORIGINS': 'http://localhost:5173',
            'PRESENCE_MESSAGE_LIMIT': '128',
            'PRACTICE_MESSAGE_LIMIT': '2048',
            **overrides,
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            arguments = root / 'arguments'
            environment['PATH'] = f'{root}{os.pathsep}{os.environ["PATH"]}'
            environment['STARTUP_TEST_ARGUMENTS'] = str(arguments)
            scripts = {
                'python': (
                    '#!/bin/sh\n'
                    f'if [ "$1" = "-c" ]; then exec {shlex.quote(sys.executable)} "$@"; fi\n'
                    'if [ "$2" = "db_worker" ]; then exec sleep 3600; fi\n'
                    'exit 0\n'
                ),
                'daphne': '#!/bin/sh\nprintf "%s\\n" daphne "$@" > "$STARTUP_TEST_ARGUMENTS"\n',
                'gunicorn': (
                    '#!/bin/sh\nprintf "%s\\n" gunicorn "$@" > "$STARTUP_TEST_ARGUMENTS"\n'
                ),
            }
            for name, script in scripts.items():
                executable = root / name
                executable.write_text(script)
                executable.chmod(0o755)
            process = subprocess.Popen(
                ['bash', 'start-prod.sh'],
                cwd=SERVER,
                env=environment,
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            try:
                # Worker inherits stderr, so wait for the web-server process rather
                # than communicate() waiting for that supervised pipe to close.
                self.assertEqual(process.wait(timeout=15), 0)
                result = arguments.read_text().splitlines()
            finally:
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=5)
                if process.stderr:
                    process.stderr.close()
            return result

    def assert_transport_limit(self, arguments, expected):
        """Both Daphne frame and message bounds match the enabled capabilities."""
        self.assertEqual(arguments[0], 'daphne')
        for option in ('--websocket-max-message-size', '--websocket-max-frame-size'):
            self.assertEqual(arguments[arguments.index(option) + 1], str(expected))

    def test_practice_only_ignores_disabled_presence_limit(self):
        """A small public-presence bound cannot reject valid private-room commands."""
        self.assert_transport_limit(self.startup(), 2048)

    def test_both_features_use_largest_enabled_limit(self):
        """One transport admits both feature protocols, each with its own app bound."""
        arguments = self.startup(
            PRESENCE_ENABLED='True',
            PRESENCE_HASH_KEY='h' * 32,
            PRESENCE_STATS_TOKEN='',
            PRESENCE_SCOPES='{"reading":{"origins":["http://localhost:5173"]}}',
            PRACTICE_MESSAGE_LIMIT='4096',
        )
        self.assert_transport_limit(arguments, 4096)

    def test_presence_only_ignores_disabled_practice_limit(self):
        """A disabled room protocol does not change the public socket transport."""
        arguments = self.startup(
            PRESENCE_ENABLED='True',
            PRESENCE_HASH_KEY='h' * 32,
            PRESENCE_STATS_TOKEN='',
            PRESENCE_SCOPES='{"reading":{"origins":["http://localhost:5173"]}}',
            PRACTICE_ENABLED='False',
        )
        self.assert_transport_limit(arguments, 128)

    def test_http_only_still_uses_gunicorn(self):
        """Disabled realtime retains the existing HTTP server and worker count."""
        self.assertEqual(
            self.startup(REALTIME_ENABLED='False', PRACTICE_ENABLED='False'),
            ['gunicorn', '--bind', ':8000', '--workers', '2', 'config.wsgi'],
        )
