# Local practice pilot — 2026-10-13

This is one local implementation check, not a production capacity promise. The target
was 100 authenticated sockets across 10 rooms, two actual Daphne processes, a normal
20-second heartbeat and host actions while all sockets remained open.

The probe used a disposable Postgres 18.3 database and Redis 7.4.8 namespace on
macOS 15.8.1, arm64, with 12 logical CPUs. Ten test accounts each joined ten rooms.
Connection/rate allowances were explicitly raised for this test's shared loopback IP;
the application defaults retain their lower peer/account budgets. The existing browser
test namespace also shared the Redis process, so reported memory is total Redis memory,
not a per-room allocation. No production data, credentials or services were involved.

| Measurement | Before normal heartbeat | After heartbeat and 10 host starts |
| --- | ---: | ---: |
| Summed Daphne CPU from `ps` | 81.7% | 72.2% |
| Summed Daphne RSS | 250.91 MiB | 252.97 MiB |
| Redis used memory | 1.99 MiB | 2.06 MiB |

Ten sequential command acknowledgements measured median **167.36 ms**, maximum
**238.71 ms**. CPU is the platform's process CPU estimate, including the preceding
admission burst; this short run does not measure steady-state CPU or sustained capacity.
It does not establish network/hosting limits, a safe production VM size or a latency SLO.

Reproduce with a Postgres role that can create disposable databases:

```sh
DATABASE_URL=postgresql://<local-role>@127.0.0.1:<port>/<scratch-db> \
TEST_REDIS_URL=redis://127.0.0.1:<port>/0 \
uv run python admin/dev/check-practice-processes.py --pilot --report /tmp/practice-pilot.json
```

The same probe separately passed cross-process authority and concurrent revision
checks, a worker killed immediately after commit but before publish/ack, identical UUID
retry recovery, final-mutation heartbeat repair, completion while no worker was running,
membership revocation, logout and lost Redis state. An additional run with
`--redis-binary /path/to/redis-server` physically stopped and restarted a Redis process
owned only by the probe, verifying degraded socket closure, readiness 503 then 200,
resubscription and durable timer preservation.

The real Chrome browser test used two isolated accounts with device wall-clock offsets
of ±5 minutes. Its controlled low-latency sample showed 76 ms displayed timer difference;
after reconnect with a 200 ms guest downlink delay, the final measured difference was
54 ms (an earlier run measured 40 ms).
These are observed samples, not a universal simultaneity guarantee. Desktop and
390×844 viewport reviews passed. Real-phone Safari foreground/background and sleep/wake,
actual reverse-proxy idle behavior, production load sizing and off-machine backup/restore
remain release/deployment checks.
