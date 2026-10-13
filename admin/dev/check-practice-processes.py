"""Verify durable practice behavior on two real Daphne/Postgres/Redis processes.

The supplied Postgres role needs CREATEDB. Every run creates/drops its own database
and random Redis namespace; it never migrates the supplied database. A test-only
launcher kills a worker immediately after a service transaction commits, before
its caller can publish or acknowledge the command. No production failure hook is
installed. Use --pilot for the 100-socket, 10-room measurement (not a capacity claim).
"""

import argparse
import asyncio
import contextlib
import json
import os
import platform
import socket
import statistics
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
from redis.exceptions import RedisError
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = 'http://localhost:5173'
PASSWORD = 'practice-integration-password-27'


def free_port():
    """Choose a loopback port without advertising a public test service."""
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def stop(process):
    """Reap every spawned process, including failed startup paths."""
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def wait_ready(port, process):
    """Bound readiness waiting and report early worker failure."""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Daphne exited before readiness')
        try:
            if httpx.get(f'http://127.0.0.1:{port}/readyz/', timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError('Daphne did not become ready within 30 seconds')


def post(client, url, body, expected=200):
    """Use the actual session/CSRF exchange, including token rotation after login."""
    token = client.get('/auth/csrf/').json()['token']
    response = client.post(url, json=body, headers={'X-CSRFToken': token})
    assert response.status_code == expected, (url, response.status_code, response.text)
    return response.json() if response.content else None


def login(port, username):
    """Authenticate through the kit's existing login endpoint."""
    client = httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=10)
    post(client, '/auth/login/', {'username': username, 'password': PASSWORD})
    return client


async def room_socket(port, room_id, client, *, origin=ORIGIN):
    """Open an authenticated socket and complete the clock-correlated hello."""
    cookie = '; '.join(f'{key}={value}' for key, value in client.cookies.items())
    ws = await connect(
        f'ws://127.0.0.1:{port}/ws/practice/rooms/{room_id}/',
        origin=origin,
        additional_headers={'Cookie': cookie},
        close_timeout=2,
    )
    sync_id = str(uuid4())
    await ws.send(json.dumps({'v': 1, 'type': 'hello', 'sync_id': sync_id}))
    initial = await event(ws, 'room.snapshot', lambda item: item.get('sync_id') == sync_id)
    return ws, initial


async def event(ws, kind, predicate=lambda item: True):
    """Drain racing group events until an authoritative matching reply arrives."""
    async with asyncio.timeout(10):
        while True:
            payload = json.loads(await ws.recv())
            if payload['type'] == 'error' and kind != 'error':
                raise AssertionError(f"Room returned {payload.get('code')}")
            if payload['type'] == kind and predicate(payload):
                return payload


async def refresh(ws):
    """Heartbeats repair dropped final mutations and sample the clock."""
    sync_id = str(uuid4())
    await ws.send(json.dumps({'v': 1, 'type': 'heartbeat', 'sync_id': sync_id}))
    return await event(ws, 'room.snapshot', lambda item: item.get('sync_id') == sync_id)


def command(snapshot, action, **extra):
    """Build one stable retryable UUID command from a known room revision."""
    return {
        'v': 1,
        'type': 'timer.command',
        'request_id': str(uuid4()),
        'expected_revision': snapshot['revision'],
        'action': action,
        **extra,
    }


async def send_command(ws, payload):
    """Return the acknowledgement for this UUID, without counting broadcasts."""
    await ws.send(json.dumps(payload))
    return await event(
        ws, 'command.result', lambda item: item['request_id'] == payload['request_id']
    )


async def probe(
    ports, clients, ids, start, processes, redis, prefix, database_url, restart_redis=None
):
    """Test access, authority, races, retries, session expiry and Redis recovery."""
    host, participant, stranger = clients[:3]
    created = post(
        host, '/api/practice/rooms/', {'title': 'Integration room', 'duration_minutes': 1}, 201
    )
    initial, secret = created['snapshot'], created['invitation_secret']
    room_id = initial['room_id']
    path = f'/api/practice/rooms/{room_id}/'
    sockets = []
    try:
        print('Practice probe: origin, invitation, CSRF and persisted access', flush=True)
        for origin in (None, 'https://unapproved.example'):
            try:
                denied, _ = await room_socket(ports[0], room_id, host, origin=origin)
            except InvalidStatus as error:
                assert error.response.status_code == 403
            else:
                await denied.close()
                raise AssertionError('Unapproved Origin was accepted')
        assert stranger.get(path).status_code in (403, 404)
        assert (
            participant.post(path + 'join/', json={'invitation_secret': secret}).status_code == 403
        )
        post(participant, path + 'join/', {'invitation_secret': 'wrong-secret'}, 403)
        post(participant, path + 'join/', {'invitation_secret': secret})
        rotated = post(host, path + 'invite/rotate/', {})
        post(stranger, path + 'join/', {'invitation_secret': secret}, 403)
        assert participant.get(path).status_code == 200
        secret = rotated['invitation_secret']

        print('Practice probe: cross-process membership and host controls', flush=True)
        host_ws, state = await room_socket(ports[0], room_id, host)
        sockets.append(host_ws)
        member_ws, _ = await room_socket(ports[1], room_id, participant)
        sockets.append(member_ws)
        host_tab, _ = await room_socket(ports[1], room_id, host)
        sockets.append(host_tab)
        roster = (await refresh(member_ws))['members']
        assert sum(item['connected'] for item in roster) == 2, roster
        denied = await send_command(member_ws, command(state, 'start'))
        assert not denied['accepted'] and denied['code'] == 'host_only', denied
        started = await send_command(host_ws, command(state, 'start'))
        assert started['accepted']
        state = started['snapshot']
        observed = await event(
            member_ws, 'room.snapshot', lambda item: item['revision'] == state['revision']
        )
        assert observed['status'] == 'running' and observed['deadline'] == state['deadline']
        paused_payload = command(state, 'pause')
        paused = await send_command(host_tab, paused_payload)
        assert paused['accepted'] and paused['snapshot']['status'] == 'paused'
        replayed = await send_command(host_ws, paused_payload)
        assert replayed['accepted'] and replayed['replayed']
        assert replayed['accepted_revision'] == paused['accepted_revision']
        reused = await send_command(host_ws, {**paused_payload, 'action': 'reset'})
        assert not reused['accepted'] and reused['code'] == 'request_id_reused'
        resumed = await send_command(host_ws, command(paused['snapshot'], 'resume'))
        assert resumed['accepted'] and resumed['snapshot']['status'] == 'running'

        print('Practice probe: commands race on different workers', flush=True)
        state = resumed['snapshot']
        results = await asyncio.gather(
            send_command(host_ws, command(state, 'reset', duration_minutes=2)),
            send_command(host_tab, command(state, 'reset', duration_minutes=3)),
        )
        assert sum(item['accepted'] for item in results) == 1, results
        assert {item['code'] for item in results} == {'ok', 'revision_conflict'}, results
        state = await refresh(host_ws)
        assert state['revision'] == resumed['snapshot']['revision'] + 1

        print('Practice probe: worker dies after commit and before publish/ack', flush=True)
        # Only the test launcher wraps the real transactional service. The worker
        # exits after a matching command returns, before the consumer can publish.
        killed_payload = command(state, 'reset', duration_minutes=4)
        marker = ROOT / '.tmp' / f'practice-kill-{prefix}'
        marker.parent.mkdir(exist_ok=True)
        marker.write_text(killed_payload['request_id'])
        await host_ws.send(json.dumps(killed_payload))
        with contextlib.suppress(ConnectionClosed):
            async with asyncio.timeout(10):
                while True:
                    await host_ws.recv()
        assert processes[0].wait(timeout=5) == 86
        marker.unlink(missing_ok=True)
        start(0)
        recovered, _ = await room_socket(ports[0], room_id, host)
        sockets.append(recovered)
        replayed = await send_command(recovered, killed_payload)
        assert replayed['accepted'] and replayed['replayed'], replayed
        assert replayed['snapshot']['revision'] == state['revision'] + 1
        state = replayed['snapshot']

        print('Practice probe: a dropped last mutation repairs on heartbeat', flush=True)
        # A direct service call commits without any consumer/broadcast. This models
        # at-most-once group delivery dropping the final reset everywhere.
        payload = command(state, 'start')
        shell = (
            'from apps.practice.service import apply_command; '
            f'apply_command({room_id!r}, {ids[0]}, {payload["request_id"]!r}, '
            f'{state["revision"]}, "start")'
        )
        run_manage(['shell', '-c', shell], database_url, prefix)
        repaired = await refresh(member_ws)
        assert repaired['status'] == 'running' and repaired['revision'] == state['revision'] + 1

        print('Practice probe: expiry completes with no server present', flush=True)
        for ws in sockets:
            await ws.close()
        for process in processes:
            stop(process)
        with psycopg.connect(database_url) as db:
            db.execute(
                'UPDATE practice_practiceroom SET deadline = '
                'CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE id = %s',
                [room_id],
            )
        start(0)
        start(1)
        completed = host.get(path).json()
        assert completed['status'] == 'completed' and completed['remaining_ms'] == 0
        assert host.get(path).json()['revision'] == completed['revision']
        recovered, _ = await room_socket(ports[0], room_id, host)
        sockets.append(recovered)
        late_pause = await send_command(recovered, command(completed, 'pause'))
        assert not late_pause['accepted'] and late_pause['snapshot']['status'] == 'completed'

        print('Practice probe: lost Redis state forces reconnect and preserves timer', flush=True)
        keys = list(redis.scan_iter(match=f'{prefix}:*'))
        if keys:
            redis.delete(*keys)
        with contextlib.suppress(ConnectionClosed):
            await recovered.send(
                json.dumps({'v': 1, 'type': 'heartbeat', 'sync_id': str(uuid4())})
            )
            failure = await event(recovered, 'error')
            assert failure['code'] in ('lease_expired', 'service_unavailable'), failure
        await asyncio.wait_for(recovered.wait_closed(), timeout=5)
        restored, current = await room_socket(ports[1], room_id, host)
        sockets.append(restored)
        assert current['status'] == 'completed' and current['revision'] == completed['revision']

        if restart_redis is not None:
            print('Practice probe: physical Redis stop/restart and readiness', flush=True)
            restart_redis(False)
            assert host.get('/readyz/').status_code == 503
            with contextlib.suppress(ConnectionClosed):
                await restored.send(
                    json.dumps({'v': 1, 'type': 'heartbeat', 'sync_id': str(uuid4())})
                )
                failure = await event(restored, 'error')
                assert failure['code'] == 'service_unavailable', failure
            await asyncio.wait_for(restored.wait_closed(), timeout=5)
            restart_redis(True)
            assert host.get('/readyz/').status_code == 200
            restored, current = await room_socket(ports[1], room_id, host)
            sockets.append(restored)
            assert (
                current['status'] == 'completed' and current['revision'] == completed['revision']
            )

        print(
            'Practice probe: member revocation and session logout invalidate live sockets',
            flush=True,
        )
        member_ws, _ = await room_socket(ports[0], room_id, participant)
        sockets.append(member_ws)
        post(host, path + f'members/{ids[1]}/revoke/', {})
        await asyncio.wait_for(member_ws.wait_closed(), timeout=5)
        post(participant, path + 'join/', {'invitation_secret': secret}, 403)
        post(stranger, path + 'join/', {'invitation_secret': secret})
        stranger_ws, _ = await room_socket(ports[1], room_id, stranger)
        sockets.append(stranger_ws)
        post(stranger, '/auth/logout/', {})
        await stranger_ws.send(json.dumps({'v': 1, 'type': 'heartbeat', 'sync_id': str(uuid4())}))
        await asyncio.wait_for(stranger_ws.wait_closed(), timeout=5)
        post(host, path + 'invite/revoke/', {})
        final = await send_command(restored, command(current, 'close'))
        assert final['accepted'] and final['snapshot']['closed_at']
    finally:
        for ws in sockets:
            with contextlib.suppress(Exception):
                await ws.close()


def run_manage(arguments, database_url, prefix):
    """Run fixture-only service work in a distinct synchronous process."""
    environment = {
        **os.environ,
        'SECRET_KEY': 'isolated-practice-probe',
        'DEBUG': 'True',
        'USE_LOCAL_FILE_STORAGE': 'True',
        'DATABASE_URL': database_url,
        'REALTIME_ENABLED': 'False',
        'PRESENCE_ENABLED': 'False',
        'PRACTICE_ENABLED': 'False',
        'REALTIME_PREFIX': prefix,
    }
    return subprocess.run(
        [sys.executable, 'server/manage.py', *arguments],
        cwd=ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def process_metrics(processes, redis):
    """Collect an explicit local measurement, without extrapolating capacity."""
    pids = ','.join(str(process.pid) for process in processes)
    rows = (
        subprocess.check_output(['ps', '-p', pids, '-o', '%cpu=,rss='], text=True)
        .strip()
        .splitlines()
    )
    return {
        'daphne_cpu_percent': sum(float(row.split()[0]) for row in rows),
        'daphne_rss_mb': sum(int(row.split()[1]) for row in rows) / 1024,
        'redis_memory_mb': redis.info('memory')['used_memory'] / 1024**2,
    }


async def pilot(ports, clients, processes, redis):
    """Measure 100 sockets in 10 rooms over one normal heartbeat interval."""
    sockets = []
    latencies = []
    try:
        for index in range(10):
            created = post(
                clients[0],
                '/api/practice/rooms/',
                {'title': f'Pilot {index}', 'duration_minutes': 1},
                201,
            )
            room_id = created['snapshot']['room_id']
            for client in clients[1:10]:
                post(
                    client,
                    f'/api/practice/rooms/{room_id}/join/',
                    {'invitation_secret': created['invitation_secret']},
                )
            opened = await asyncio.gather(
                *(
                    room_socket(ports[(index + member) % 2], room_id, client)
                    for member, client in enumerate(clients[:10])
                )
            )
            sockets.extend(ws for ws, _ in opened)
        print('Practice pilot: 100 sockets / 10 rooms, normal 20s heartbeat', flush=True)
        before = process_metrics(processes, redis)
        await asyncio.sleep(20)
        await asyncio.gather(*(refresh(ws) for ws in sockets))
        for room in range(10):
            host_ws = sockets[room * 10]
            state = await refresh(host_ws)
            started = time.perf_counter()
            result = await send_command(host_ws, command(state, 'start'))
            assert result['accepted']
            latencies.append((time.perf_counter() - started) * 1000)
        after = process_metrics(processes, redis)
        return {
            'sockets': 100,
            'rooms': 10,
            'heartbeat_seconds': 20,
            'hardware': platform.platform(),
            'logical_cpus': os.cpu_count(),
            'before': before,
            'after': after,
            'command_ms_median': statistics.median(latencies),
            'command_ms_max': max(latencies),
        }
    finally:
        for ws in sockets:
            with contextlib.suppress(Exception):
                await ws.close()


def main():
    """Create isolated real services state, then clean every database and prefix."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--redis-binary', type=Path)
    args = parser.parse_args()
    base_url, redis_url = os.environ.get('DATABASE_URL', ''), os.environ.get('TEST_REDIS_URL', '')
    if not base_url.startswith(('postgres://', 'postgresql://')) or not (
        redis_url or args.redis_binary
    ):
        raise SystemExit('DATABASE_URL must be Postgres and TEST_REDIS_URL must be set.')
    owned_redis = []
    redis_log = tempfile.TemporaryFile()
    if args.redis_binary:
        redis_port = free_port()
        redis_url = f'redis://127.0.0.1:{redis_port}/0'

        def restart_redis(run):
            """Stop/start only a process owned by this isolated probe."""
            if owned_redis:
                stop(owned_redis.pop())
            if run:
                process = subprocess.Popen(
                    [
                        str(args.redis_binary),
                        '--bind',
                        '127.0.0.1',
                        '--port',
                        str(redis_port),
                        '--save',
                        '',
                        '--appendonly',
                        'no',
                    ],
                    stdout=redis_log,
                    stderr=redis_log,
                )
                owned_redis.append(process)
                deadline = time.monotonic() + 5
                with Redis.from_url(redis_url, socket_timeout=1) as check:
                    while True:
                        try:
                            check.ping()
                            return
                        except (RedisError, OSError):
                            if time.monotonic() >= deadline or process.poll() is not None:
                                raise
                            time.sleep(0.05)

        try:
            restart_redis(True)
        except Exception:
            if owned_redis:
                stop(owned_redis.pop())
            redis_log.close()
            raise
    else:
        restart_redis = None
    try:
        name, prefix = f'practice_probe_{uuid4().hex}', f'practice-probe-{uuid4().hex}'
        database_url = urlunsplit(urlsplit(base_url)._replace(path='/' + name))
        ports, processes, clients = [free_port(), free_port()], [], []
        with Redis.from_url(redis_url, socket_timeout=2, socket_connect_timeout=2) as redis:
            redis.ping()
            with psycopg.connect(base_url, autocommit=True) as admin:
                admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
                try:
                    run_manage(['migrate', '--noinput'], database_url, prefix)
                    fixture = (
                        'import json; from django.contrib.auth import get_user_model; '
                        'users=[get_user_model().objects.create_user('
                        'username="practice_probe_%s" % i, password='
                        + repr(PASSWORD)
                        + ') for i in range(10)]; '
                        'print(json.dumps([user.pk for user in users]))'
                    )
                    ids = json.loads(
                        run_manage(['shell', '-c', fixture], database_url, prefix)
                        .strip()
                        .splitlines()[-1]
                    )
                    environment = {
                        **os.environ,
                        'SECRET_KEY': 'isolated-practice-probe',
                        'DEBUG': 'True',
                        'USE_LOCAL_FILE_STORAGE': 'True',
                        'DATABASE_URL': database_url,
                        'REALTIME_ENABLED': 'True',
                        'ASGI_ENABLED': 'True',
                        'PRESENCE_ENABLED': 'False',
                        'PRACTICE_ENABLED': 'True',
                        'PRACTICE_ORIGINS': ORIGIN,
                        'REALTIME_REDIS_URL': redis_url,
                        'REALTIME_PREFIX': prefix,
                        'PRACTICE_MAX_CONNECTIONS_PER_IP': '200',
                        'PRACTICE_MAX_USER_CONNECTIONS': '20',
                        'PRACTICE_CONNECT_RATE': '1000',
                        'PRACTICE_IP_CONNECT_RATE': '1000',
                        'PRACTICE_IP_MESSAGE_RATE': '10000',
                        'PRACTICE_MESSAGE_RATE': '1000',
                        'PRACTICE_HTTP_RATE': '1000',
                    }
                    with (
                        tempfile.TemporaryFile() as log,
                        tempfile.TemporaryDirectory() as temporary,
                    ):
                        launcher = Path(temporary) / 'worker.py'
                        launcher.write_text(
                            'import os, sys\n'
                            'from pathlib import Path\n'
                            'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")\n'
                            'from config.asgi import application\n'
                            'from apps.practice import service, consumers\n'
                            'original = service.apply_command\n'
                            'def committed(*args, **kwargs):\n'
                            '    outcome = original(*args, **kwargs)\n'
                            '    marker = Path(os.environ["PRACTICE_PROBE_MARKER"])\n'
                            '    positional_id = args[2] if len(args)>2 else None\n'
                            '    request_id = kwargs.get("request_id", positional_id)\n'
                            '    if marker.exists() and marker.read_text() == str(request_id):\n'
                            '        os._exit(86)\n'
                            '    return outcome\n'
                            'service.apply_command = committed\n'
                            'if hasattr(consumers, "apply_command"):\n'
                            '    consumers.apply_command = committed\n'
                            'from daphne.cli import CommandLineInterface\n'
                            'CommandLineInterface().run(["-b", "127.0.0.1", "-p", sys.argv[1],\n'
                            '    "config.asgi:application"])\n'
                        )

                        def start(index):
                            worker_env = {
                                **environment,
                                'PYTHONPATH': str(ROOT / 'server'),
                                'PRACTICE_PROBE_MARKER': str(
                                    ROOT / '.tmp' / f'practice-kill-{prefix}'
                                )
                                if index == 0
                                else str(Path(temporary) / 'unused-marker'),
                            }
                            process = subprocess.Popen(
                                [sys.executable, str(launcher), str(ports[index])],
                                cwd=ROOT / 'server',
                                env=worker_env,
                                stdout=log,
                                stderr=log,
                            )
                            if index < len(processes):
                                processes[index] = process
                            else:
                                processes.append(process)
                            wait_ready(ports[index], process)

                        try:
                            start(0)
                            start(1)
                            clients = [
                                login(ports[index % 2], f'practice_probe_{index}')
                                for index in range(10)
                            ]
                            asyncio.run(
                                probe(
                                    ports,
                                    clients,
                                    ids,
                                    start,
                                    processes,
                                    redis,
                                    prefix,
                                    database_url,
                                    restart_redis,
                                )
                            )
                            # Logout is part of the security probe; renew that client.
                            clients[2].close()
                            clients[2] = login(ports[0], 'practice_probe_2')
                            report = (
                                asyncio.run(pilot(ports, clients, processes, redis))
                                if args.pilot
                                else {'integration': 'passed'}
                            )
                            print(json.dumps(report, indent=2), flush=True)
                            if args.report:
                                args.report.write_text(json.dumps(report, indent=2) + '\n')
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
                            for client in clients:
                                client.close()
                finally:
                    admin.execute(
                        sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name))
                    )
                    keys = list(redis.scan_iter(match=f'{prefix}:*'))
                    if keys:
                        redis.delete(*keys)
                    (ROOT / '.tmp' / f'practice-kill-{prefix}').unlink(missing_ok=True)
    finally:
        if owned_redis:
            stop(owned_redis.pop())
        redis_log.close()
    print(
        'PASS: real two-worker practice access, authority, race, retry, '
        'expiry, session and Redis recovery'
    )


if __name__ == '__main__':
    main()
