"""Probe two actual Daphne processes against disposable Postgres/Redis state.

Run with DATABASE_URL (Postgres role with CREATEDB) and TEST_REDIS_URL. The probe
creates and drops its own database, uses a unique Redis namespace, and never
migrates the supplied database. This is also the real-infrastructure CI gate.
"""

import asyncio
import contextlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx
import psycopg
from psycopg import sql
from redis import Redis
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    """Choose a loopback port for one short-lived Daphne process."""
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def wait_ready(port, process):
    """Bound startup waiting and surface process failures immediately."""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Daphne exited before readiness')
        try:
            response = httpx.get(f'http://127.0.0.1:{port}/readyz/', timeout=1)
            if response.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError('Daphne did not become ready within 30 seconds')


def stop(process):
    """Reap one spawned process, including the failed startup path."""
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


async def snapshot(socket, expected=None):
    """Drain racing group events until the requested authoritative count appears."""
    async with asyncio.timeout(8):
        while True:
            payload = json.loads(await socket.recv())
            if payload['type'] == 'error':
                raise AssertionError(f"Presence returned {payload['code']}")
            if payload['type'] == 'presence.snapshot':
                assert isinstance(payload['server_time'], str)
                assert 'visitor_id' not in payload and 'members' not in payload
                if expected is None or payload['count'] == expected:
                    return payload


async def hello(port, visitor_id=None, headers=None):
    """Open a real WebSocket and acknowledge an explicitly visible page."""
    socket = await connect(
        f'ws://127.0.0.1:{port}/ws/presence/',
        origin='http://localhost:5173',
        additional_headers=headers,
        close_timeout=2,
    )
    payload = {
        'v': 1,
        'type': 'hello',
        'scope': 'reading',
        'analytics': visitor_id is not None,
        'visible': True,
    }
    if visitor_id is not None:
        payload['visitor_id'] = visitor_id
    await socket.send(json.dumps(payload))
    return socket


async def probe(ports, restart, redis, prefix, token):
    """Verify tab deduplication, private stats and process/Redis-state recovery."""
    sockets = []
    visitor_a, visitor_b = str(uuid4()), str(uuid4())
    try:
        print('Probe: rejected socket origins', flush=True)
        for origin in (None, 'https://unapproved.example'):
            try:
                denied = await connect(
                    f'ws://127.0.0.1:{ports[0]}/ws/presence/', origin=origin, close_timeout=2
                )
            except InvalidStatus as error:
                assert error.response.status_code == 403, error.response.status_code
            else:
                await denied.close()
                raise AssertionError('Unapproved socket Origin was accepted')
        print('Probe: cross-process tab counts', flush=True)
        first = await hello(ports[0], visitor_a)
        sockets.append(first)
        await snapshot(first, 1)
        second = await hello(ports[1], visitor_a)
        sockets.append(second)
        await snapshot(second, 1)
        third = await hello(ports[1], visitor_b)
        sockets.append(third)
        await snapshot(third, 2)
        await snapshot(first, 2)
        await first.close()
        await second.send(json.dumps({'v': 1, 'type': 'heartbeat'}))
        await snapshot(second, 2)
        await second.send(json.dumps({'v': 1, 'type': 'inactive'}))
        await snapshot(second, 1)
        await second.send(json.dumps({'v': 1, 'type': 'heartbeat'}))
        await snapshot(second, 2)

        print('Probe: privacy and private statistics', flush=True)
        for privacy_header in ({'DNT': '1'}, {'Sec-GPC': '1'}):
            private = await hello(ports[0], visitor_a, privacy_header)
            sockets.append(private)
            await snapshot(private, len(sockets) - 1)
        with httpx.Client() as client:
            url = f'http://127.0.0.1:{ports[0]}/presence/stats/?days=1'
            assert client.get(url).status_code == 401
            response = client.get(url, headers={'Authorization': f'Bearer {token}'})
            response.raise_for_status()
            report = response.json()['scopes']['reading']
            assert report['daily_visits'] == 2, report
            assert visitor_a not in response.text and visitor_b not in response.text
            assert 'visitor_key' not in response.text

        # Abrupt worker loss drops that worker's sockets. The durable visit survives.
        print('Probe: abrupt worker restart', flush=True)
        restart()
        rejoined = await hello(ports[0], visitor_a)
        sockets.append(rejoined)
        await snapshot(rejoined)
        with httpx.Client() as client:
            response = client.get(
                f'http://127.0.0.1:{ports[0]}/presence/stats/?days=1',
                headers={'Authorization': f'Bearer {token}'},
            )
            response.raise_for_status()
            assert response.json()['scopes']['reading']['daily_visits'] == 2

        # Model lost ephemeral Redis state (e.g. a Redis restart). An existing
        # connection fails closed, then a controlled reconnect repopulates leases
        # AND Channels membership without inflating the durable daily visit.
        print('Probe: lost Redis state and reconnect', flush=True)
        keys = list(redis.scan_iter(match=f'{prefix}:*'))
        if keys:
            redis.delete(*keys)
        for stale in (second, third):
            await stale.send(json.dumps({'v': 1, 'type': 'heartbeat'}))
            async with asyncio.timeout(8):
                while True:
                    failure = json.loads(await stale.recv())
                    if failure['type'] == 'error':
                        assert failure['code'] == 'lease_expired', failure
                        break
            await asyncio.wait_for(stale.wait_closed(), timeout=5)
            assert stale.close_code == 4408, stale.close_code
        recovered_a = await hello(ports[0], visitor_a)
        sockets.append(recovered_a)
        await snapshot(recovered_a, 1)
        recovered_b = await hello(ports[1], visitor_b)
        sockets.append(recovered_b)
        await snapshot(recovered_b, 2)
        await snapshot(recovered_a, 2)
        with httpx.Client() as client:
            response = client.get(
                f'http://127.0.0.1:{ports[1]}/presence/stats/?days=1',
                headers={'Authorization': f'Bearer {token}'},
            )
            response.raise_for_status()
            assert response.json()['scopes']['reading']['daily_visits'] == 2
    finally:
        for socket in sockets:
            with contextlib.suppress(Exception):
                await socket.close()


def main():
    """Create temporary infrastructure state and execute the cross-process probe."""
    database_url = os.environ.get('DATABASE_URL', '')
    redis_url = os.environ.get('TEST_REDIS_URL', '')
    if not database_url.startswith(('postgres://', 'postgresql://')) or not redis_url:
        raise SystemExit('DATABASE_URL must be Postgres and TEST_REDIS_URL must be set.')
    database_name = f'presence_probe_{uuid4().hex}'
    prefix = f'presence-probe-{uuid4().hex}'
    token = uuid4().hex + uuid4().hex
    ports = [free_port(), free_port()]
    processes = []
    with Redis.from_url(redis_url, socket_timeout=2, socket_connect_timeout=2) as redis:
        redis.ping()
        with psycopg.connect(database_url, autocommit=True) as admin:
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database_name)))
            try:
                environment = {
                    **os.environ,
                    'SECRET_KEY': 'isolated-integration-test-secret',
                    'DEBUG': 'True',
                    'USE_LOCAL_FILE_STORAGE': 'True',
                    'DATABASE_URL': urlunsplit(
                        urlsplit(database_url)._replace(path='/' + database_name)
                    ),
                    'REALTIME_ENABLED': 'True',
                    'ASGI_ENABLED': 'True',
                    'PRESENCE_ENABLED': 'True',
                    'REALTIME_REDIS_URL': redis_url,
                    'REALTIME_PREFIX': prefix,
                    'PRESENCE_HASH_KEY': 'h' * 64,
                    'PRESENCE_STATS_TOKEN': token,
                    'PRESENCE_TIME_ZONE': 'UTC',
                    'PRESENCE_SCOPES': json.dumps(
                        {'reading': {'origins': ['http://localhost:5173']}}
                    ),
                    'PRESENCE_LEASE_SECONDS': '6',
                    'PRESENCE_HEARTBEAT_SECONDS': '2',
                    'PRESENCE_OBSERVATION_SECONDS': '0.2',
                }
                subprocess.run(
                    [sys.executable, 'server/manage.py', 'migrate', '--noinput'],
                    cwd=ROOT,
                    env=environment,
                    check=True,
                    capture_output=True,
                )
                with tempfile.TemporaryFile() as log:

                    def start(index):
                        process = subprocess.Popen(
                            [
                                sys.executable,
                                '-m',
                                'daphne',
                                '-b',
                                '127.0.0.1',
                                '-p',
                                str(ports[index]),
                                'config.asgi:application',
                            ],
                            cwd=ROOT / 'server',
                            env=environment,
                            stdout=log,
                            stderr=log,
                        )
                        if index < len(processes):
                            processes[index] = process
                        else:
                            processes.append(process)
                        wait_ready(ports[index], process)

                    def restart():
                        processes[0].kill()
                        processes[0].wait(timeout=5)
                        start(0)

                    try:
                        start(0)
                        start(1)
                        asyncio.run(probe(ports, restart, redis, prefix, token))
                        log.seek(0)
                        if b'Exception inside application' in log.read():
                            raise AssertionError('Daphne logged an application exception')
                    except Exception:
                        log.seek(0)
                        print(log.read().decode(), file=sys.stderr)
                        raise
                    finally:
                        for process in processes:
                            stop(process)
            finally:
                admin.execute(
                    sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database_name))
                )
                keys = list(redis.scan_iter(match=f'{prefix}:*'))
                if keys:
                    redis.delete(*keys)
    print(
        'PASS: two Daphne processes, shared Redis/Postgres, tab deduplication, '
        'privacy headers, private statistics, process restart and lost-state reconnect'
    )


if __name__ == '__main__':
    main()
