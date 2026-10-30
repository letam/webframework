*Planning record, copied from wholy.sh-landing `plans/` on 2026-10-14. What this branch actually built is described in `2026-10-13-presence-and-practice.md`, which is the kit's source; where the two differ, that one is right.*

*Superseded. This is the first plan, recovered from its planner's transcript on 2026-10-13. `PLAN-2026-10-12-here-now.md` replaced it and is the one that was built. Everything below the rule is as it was written.*

---

# Here now

*Plan, 2026-10-12, after `5b92baa` on `worktree-four-bylines`; builds from `main`. Step one
of a social network for wholy.sh, in Tam's words: "starting off with showing currently
active visitors. we also want to track new and returning visitors." Nothing here is built
yet. Where it says what Tam decided, it is quoting the brief; where it says what the plan
decided, § *Decisions* says why.*

## The shape

One quiet line in the footer, under the version: **7 here now**. It appears when at least
two pages are open and says nothing otherwise — nothing when the reader is alone, nothing
while the page is finding out, nothing when the server is down. Every open, visible page
sends a small heartbeat every thirty seconds to a tiny Django app on Fly, built as a
reusable `presence` app inside Tam's web dev kit (`~/code/webframework`) and run as its own
instance for wholy.sh at `live.wholy.sh`. The server answers each heartbeat with the count
of pages heard from in the last minute. The first heartbeat of a page load also says
whether this browser has been here before, and the server adds one to that day's *new* or
*returning* total. Those totals, and the day's peak count, are Tam's alone, behind a token.

The browser keeps one thing: the day it was last here. No cookie, no IP stored, no
fingerprint, and — see § *Decisions* — no identifier at all, in the browser or on the
server.

## Which server, and why

Tam's brief named Cloudflare from a list that did not yet include his own kit; his lost
message added "we can also use and extend my web dev kit project ~/code/webframework, and
host on fly or vps for very cheap/free." Both were weighed for this feature and for what
follows it. The kit was read, not edited.

**What the kit is.** Django 6.1 + DRF on Python 3.13, served by gunicorn (two sync WSGI
workers) behind WhiteNoise; a React/Vite SPA; SQLite on a Fly volume in production
(Postgres optional); session auth with CSRF, a custom User, posts with
private-by-default visibility, drafts, media to R2, an offline outbox, per-IP rate
limiting (`server/apps/ratelimit.py`, keyed on Fly's `Fly-Client-IP`), django-csp, Sentry,
django-tasks with a `db_worker`. 725 commits, last on 2026-09-11; CI gates ruff, Django
tests, Biome, ESLint, Vitest, Playwright; a Fly runbook (`docs/deploy-fly.md`) written
after a real incident. **It is live**: `https://webframework.fly.dev/healthz/` answered
`{"status":"ok"}` in 122ms on 2026-10-12, one always-on 512MB machine in `yyz` with a 1GB
volume. **It has no WebSocket or SSE**: `config/asgi.py` is Django's stock file, nothing
runs it, there is no Channels, uvicorn or daphne, and the only `StreamingHttpResponse` is
media range serving. `fly` 0.4.102 is installed on this Mac but logged out.

| | Cloudflare Worker + Durable Object | The kit on Fly (own instance) |
|---|---|---|
| Cost at idle | $0 on the Free plan | ~$3.84/mo always on (512MB shared-cpu-1x $3.69 + 1GB volume $0.15; bandwidth is pennies). **Fly has no free tier** since 2024: new orgs get a 7-day/2-hour trial, then pay as you go. $0 incremental if it rides the existing `webframework` machine instead. |
| Cost under a spike | $0 until 100k DO requests/day (one per socket open; messages 20:1, pings free), then errors until midnight UTC | One machine. Heartbeats at 30s: 3,000 open pages ≈ 100 beats/s, well inside two sync workers and SQLite; past a few hundred/s the limiter and the client's backoff shed load and the line goes quiet. The page itself is on GitHub Pages and never waits on this. |
| Always-on vs scale-to-zero | No machine. A hibernated DO costs nothing between messages. | Always-on is the known-good config. With `auto_stop_machines = 'suspend'` the first beat after sleep wakes it (~17s boot + migrate) and the line is empty for a minute; heartbeats tolerate that, a WebSocket count would not (every stop drops every socket). |
| Ops | None: `wrangler deploy`, logs in the dashboard. wrangler is not installed; Node 26 is. | The runbook Tam already runs, a second time: migrations on boot, volume snapshots, `fly deploy`, Python/Django upgrades his to do. |
| `live.wholy.sh` | Needs the wholy.sh zone on Cloudflare (subdomain-only zones are Enterprise); otherwise `wholy-presence.<account>.workers.dev` | CNAME at Porkbun + `fly certs add`, Let's Encrypt automatic, shared IPv4 free. The zone stays where it is. |
| Lock-in | The room, hibernation and SQLite API are Cloudflare's | Django anywhere: Fly, a VPS (the kit ships `nginx.conf` and a systemd unit), Postgres HA |
| Live count | Purpose-built: instant, 32k sockets per object | Heartbeat: up to 30s behind. A socket later means ASGI (uvicorn or Channels) for the whole kit — a serving-layer change, not a feature. |
| The next social step | Accounts, posts and storage to build from scratch on D1/DO, or a second backend | Already there: users, sessions, posts, visibility, media, rate limits, CSP, admin |

**Recommendation: the kit, on Fly, as its own instance, with heartbeats rather than a
socket.** For presence alone Cloudflare is the more elegant engine and it is free; what
decides it is the sentence before "starting off": this is step one of a social network,
and the kit already is one. Choosing Cloudflare now means either rebuilding accounts and
posts on Workers or running two backends from day one, and a Cloudflare custom domain
means moving wholy.sh's DNS, which Tam has not decided. The heartbeat gives up instant
updates for a line that only needs to be true within half a minute, and in exchange needs
no change to how the kit serves. About $4 a month is "very cheap"; it is not "free", and
the one way to make it free is below.

**What turns on Tam** (the first question in the report): his own instance (~$3.84/mo, its
own database — the right shape if wholy.sh's accounts will be wholy.sh's), or the existing
`webframework` machine ($0 incremental, but wholy.sh's social network would then share a
database and deploy cadence with whatever `webframework`/`wut.sh` is), or a VPS he already
pays for (same code, Docker + Caddy, A record instead of CNAME). The plan assumes his own
instance, named `wholy-live`; § *Deploy* says what changes for the other two.

## Decisions

**Decided by Tam, not reopened.** Readers see a live count only — one quiet line, not
per-thread. New and returning are private, behind a secret token, with peak concurrent per
day. Returning is known by the browser, not by a cookie, an IP or a fingerprint.

**The browser remembers *when*, not *who*.** The brief said a random id in localStorage.
This plan keeps nothing but `presence-day`, the server's date of the browser's last visit:
a first beat with no day is *new*, with an earlier day *returning*, with today's day
*again*. That is every number the brief asked for, and the server never holds an
identifier, random or otherwise — there is nothing to leak and nothing to join. It is the
brief's decision taken one step further, and it is reversible: if a later step wants a
stable visitor id, it is one more stored key and one more field in the beat. Flagged for
Tam in the report.

**Count pages, say so.** The count is open, visible pages heard from in the last 60s. Two
tabs are two. The line says "here now", not "people", and the footer's note says pages.
Counting people would need an identifier (see above) and would still be wrong about two
people on one laptop.

**Show nothing rather than a wrong number.** Alone (n ≤ 1): empty. Connecting, failed,
offline, hidden, or no successful beat for 90s: empty. The number on the page is always
from the last minute or it is not there.

**A heartbeat, not a socket.** `POST /presence/beat/` every 30s while visible; `bye` on
leaving. Fly's proxy closes connections idle for 60s, so a socket would need the same 30s
ping anyway; the heartbeat works on the kit's gunicorn as it stands, survives a machine
suspend, and is a plain Django view with plain Django tests. A socket is the upgrade path
when a feature needs sub-second updates; the beat endpoint is what the socket would carry.

**Do Not Track and Global Privacy Control are honoured.** Either on: the page still beats
(the count is anonymous and it is the feature), but it beats with `a=1`, sends no day,
stores none, and the server adds nothing to the day's totals. Tam's call, written as the
footer says it.

**The page says what it does.** One short colophon under the ESV note. The site's register
is to tell the reader the truth plainly; a counter that watched without saying so would be
out of voice.

**Only wholy.sh beats.** The client connects when `location.hostname === 'wholy.sh'`, or
when `presence-dev` in localStorage holds an `http(s)://` base for local work. Every
checkout, every check, the iOS simulator: no request, no timer, nothing scheduled. The
hero's cost checks measure a settled page; this keeps them measuring the hero.

**Day is America/New_York** on the server (`PRESENCE_TIMEZONE`, a setting so the kit stays
generic), and the server tells the browser the day — the browser's clock is never asked.

**Two repositories.** The server is a feature of the kit, generic (any origin list, any
timezone), with its own tests and spec in the kit's `docs/plans/`. wholy.sh carries the
client, the copy, the check and the record of where its server lives. Neither repo's
checks need the other to run.

## The parts

### 1. In `~/code/webframework` — the `presence` app

Branch `presence`, PR to `main`, kit CI as the gate (`just verify`). New app
`server/apps/presence/` with `__init__.py`, `apps.py`, `models.py`, `views.py`,
`migrations/0001_initial.py`, `tests/__init__.py`, `tests/test_views.py`. Registered in
`INSTALLED_APPS` as `'apps.presence'`; routes added to `config/urls.py` (the kit routes
there, not per-app).

**Models** (`models.py`):

```python
class Beat(models.Model):
    """One open page. Pruned ten minutes after its last beat."""
    token = models.CharField(max_length=40, primary_key=True)
    last_seen = models.DateTimeField(db_index=True)

class Visit(models.Model):
    """How many first beats of a kind a day saw, per page language."""
    day = models.DateField(db_index=True)
    lang = models.CharField(max_length=2)        # 'en' | 'vi'
    kind = models.CharField(max_length=9)        # 'new' | 'returning' | 'again'
    n = models.PositiveIntegerField(default=0)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['day', 'lang', 'kind'], name='presence_visit_day_lang_kind')]

class Peak(models.Model):
    """The most pages heard from at once on a day."""
    day = models.DateField(primary_key=True)
    peak = models.PositiveIntegerField(default=0)
```

**Settings** (`config/settings.py`, all via the kit's `env`):

```python
PRESENCE_ORIGINS = env.list('PRESENCE_ORIGINS', default=[])          # e.g. https://wholy.sh
PRESENCE_STATS_TOKEN = env.str('PRESENCE_STATS_TOKEN', default='')   # empty: /presence/stats/ is 401 for everyone
PRESENCE_TIMEZONE = env.str('PRESENCE_TIMEZONE', default='UTC')      # IANA name; wholy-live sets America/New_York
PRESENCE_WINDOW_SECONDS = 60      # a page is "here" this long after its last beat
PRESENCE_RETENTION_DAYS = 400     # Visit and Peak rows older than this go on the next stats call
```

and one generic addition the instance needs: `ALLOWED_HOSTS += env.list('ALLOWED_HOSTS_EXTRA',
default=[])` inside the existing `if not DEBUG:` block, so `live.wholy.sh` is accepted
without editing the kit's hardcoded list. Document both in `server/.env.example`.
django-cors-headers is **not** involved: the beat view sets its own CORS header for exactly
the origins it accepts, so the kit's `CORS_ALLOWED_ORIGINS` (which also opens `/api/`) is
untouched.

**`POST /presence/beat/`** (`@csrf_exempt`, `@require_POST`,
`@rate_limit('presence-beat', limit=600, window_seconds=600)` — one a second per IP,
thirty pages behind one NAT; the limiter is the kit's, in process memory, writes nothing):

1. `Origin` header must be in `PRESENCE_ORIGINS`, else `403 {"error":"origin"}`. No
   `Origin` is a 403 too: browsers always send it on a cross-site POST.
2. Body over 512 bytes: `413`. Body is `text/plain`, `k=v&k=v`; parse with
   `QueryDict(request.body.decode('utf-8', 'replace'))`. `t` must match
   `^[A-Za-z0-9_-]{16,40}$`, else `400`.
3. `bye=1`: delete the `Beat` with that token; `204`, with the CORS headers below. Done.
4. `now = timezone.now()`. `Beat.objects.update_or_create(token=t, defaults={'last_seen': now})`.
5. If `f=1` and not `a=1`: `lang = 'vi' if l == 'vi' else 'en'`;
   `today = now.astimezone(ZoneInfo(PRESENCE_TIMEZONE)).date()`; `d` absent → `new`;
   `d == today.isoformat()` → `again`; `d` a valid earlier `YYYY-MM-DD` → `returning`;
   `d` malformed or in the future → count nothing. Increment:
   `Visit.objects.get_or_create(day=today, lang=lang, kind=kind)` then
   `.filter(pk=...).update(n=F('n') + 1)`.
6. `n = Beat.objects.filter(last_seen__gte=now - timedelta(seconds=PRESENCE_WINDOW_SECONDS)).count()`.
7. `Peak.objects.get_or_create(day=today)`; `Peak.objects.filter(day=today, peak__lt=n).update(peak=n)`.
8. `Beat.objects.filter(last_seen__lt=now - timedelta(minutes=10)).delete()` — every call;
   it is a handful of rows and keeps the table the size of the room.
9. `200 {"n": n, "d": "YYYY-MM-DD"}` with `Access-Control-Allow-Origin: <the Origin>`,
   `Vary: Origin`, `Cache-Control: no-store`.

No `OPTIONS` handler: a `text/plain` POST with no custom headers is a CORS "simple request"
and the browser sends no preflight; `sendBeacon` with a `text/plain` Blob is the same. The
kit's `HealthCheckMiddleware` and gunicorn (no `--access-logfile`) mean the app writes no
request log; Fly's platform logs carry request lines briefly, and that is the only place an
address ever appears.

SQLite under two workers: the kit already sets WAL, `transaction_mode = 'IMMEDIATE'` and a
20s busy timeout; `F()` increments and the unique constraint make steps 5 and 7 safe.

**`GET /presence/stats/`** (`@require_GET`, `@rate_limit('presence-stats', limit=30,
window_seconds=600)`):

- `Authorization: Bearer <token>` compared with `hmac.compare_digest` against
  `PRESENCE_STATS_TOKEN`; missing, wrong, or token unset → `401` with
  `WWW-Authenticate: Bearer`. No CORS header: this is for `curl`, not a page.
- `days` query param, default 30, clamped to 1–400.
- First, prune: `Visit` and `Peak` rows with `day < today - PRESENCE_RETENTION_DAYS`.
- Then, with zeros for days that have no rows, newest first:

```json
{"tz": "America/New_York", "window_seconds": 60, "now": 3,
 "days": [{"day": "2026-10-12", "new": {"en": 3, "vi": 1}, "returning": {"en": 5, "vi": 0},
           "again": {"en": 2, "vi": 0}, "peak": 7}]}
```

`Cache-Control: no-store`. Tam reads it with
`curl -H "Authorization: Bearer $PRESENCE_STATS_TOKEN" 'https://live.wholy.sh/presence/stats/?days=14'`.

**Tests** (`tests/test_views.py`, subclass `apps.blogs.tests.BaseTestCase` for its cache
clearing, `@override_settings(PRESENCE_ORIGINS=['https://example.test'],
PRESENCE_STATS_TOKEN='t', PRESENCE_TIMEZONE='America/New_York')`): wrong or missing origin
→ 403 and no row; one beat → `n` 1 and the CORS headers; two tokens → 2; a token last seen
61s ago is not counted (freeze `timezone.now`); `bye` removes and returns 204; first beat
with no `d` → `new`, with today → `again`, with yesterday → `returning`, with `2026-13-45`
→ nothing counted; `a=1` counts in `n` and in `peak` but in no `Visit`; `f=0` counts in no
`Visit`; peak holds the maximum across beats; `d` in the response is the New York day when
UTC is already tomorrow; bad token → 400; 513-byte body → 413; the 601st beat from one IP
in a window → 429; stats without, with a wrong, and with the right token; stats shape with
zero-filled days; a `Visit` 401 days old is gone after a stats call; `PRESENCE_STATS_TOKEN`
empty → 401 even with an empty bearer.

**Kit docs**: `docs/plans/2026-10-12-presence.md` in the kit's spec register (copy this
section, with "Status: implemented …" once it is); `CLAUDE.md` *Apps* and *Key API
Endpoints* gain `presence` and the two routes; `docs/deploy-fly.md` gains a short
*Instances* section: a second app from the same image, the secrets it needs (§ 4 below),
and that `ALLOWED_HOSTS_EXTRA` is how it gets its hostname.

### 2. The wire, in one place

| Direction | Form |
|---|---|
| Beat | `POST {base}/beat/`, `Content-Type: text/plain;charset=UTF-8`, body `t=<token>&l=<en\|vi>&f=<0\|1>` + `&d=YYYY-MM-DD` when stored and not anonymous + `&a=1` when anonymous. `credentials: 'omit'`, `cache: 'no-store'`, 10s timeout. |
| Answer | `200 {"n": 7, "d": "2026-10-12"}`; any other status is a failure |
| Bye | `sendBeacon({base}/beat/, Blob('t=<token>&bye=1', text/plain))`; `fetch … keepalive: true` where there is no `sendBeacon`. Answer `204`, ignored. |
| Stats | `GET {base}/stats/?days=N`, `Authorization: Bearer …` → the JSON above |

- **token**: `crypto.randomUUID()` (fallback: 16 random bytes as hex), made once per page
  load, held in the script's closure, never stored. It survives the back-forward cache
  with the page and is gone with it.
- **first beat** (`f=1`) is the first beat the server *acknowledges*; a page keeps sending
  `f=1` until one succeeds, then `f=0` for the rest of its life, including after sleep,
  bfcache restore and a hidden-bye. So a reload is a visit and a reconnect is not.
- **visible / hidden**: beats run only while `document.visibilityState === 'visible'`.
  Hidden: the beat timer stops; after 60s hidden, `bye`. Visible again: a beat at once, or
  within 10s of the last good one. The server's 60s window makes a lost `bye` cost at most
  a minute of one extra page.
- **leaving**: `pagehide` → `bye` (navigation, close, into bfcache). `pageshow` with
  `persisted` → beat. `offline` → stop and clear the line; `online` → beat.
- **sleep/wake**: timers fire late; the next beat re-adds the token (the server had aged it
  out), and because the last good beat is older than 90s the line is cleared first.
- **failure and backoff**: fetch error, timeout, or non-2xx (429 included): clear the line,
  next beat in `min(30s · 2^k, 300s) · (0.75–1.25)`, `k` capped at 4; a success resets `k`.
- **anonymous** (`navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true`):
  `a=1`, no `d` sent, `presence-day` neither read nor written.
- **what leaves the browser**: the token, the language, the first-beat flag, the stored
  day. **What the server stores**: live tokens for ten minutes; per-day, per-language
  counts of new/returning/again; per-day peak. Nothing else, and no log of its own.

### 3. In `wholy.sh-landing` — the line, the note, the client

Work in a worktree off `main` (`.claude/worktrees/here-now`), not on
`worktree-four-bylines`.

**Markup.** In the footer, directly after the `.footer-version` paragraph and before
`.footer-note`:

```html
  <p class="footer-version">v0.2 · <time datetime="2026-10">October 2026</time></p>
  <!-- Here now: how many pages are open on the site this minute, from the heartbeat
       script at the foot of the page. Empty when the reader is alone, when the page
       is still finding out, and whenever the server has not answered inside ninety
       seconds; the space is reserved so the footer never moves when it fills. -->
  <p class="footer-presence" id="presence"></p>
```

Empty `<p>` elements are nothing to a screen reader, and there is no `aria-live`: a count
that moves every half minute must not interrupt anyone.

**CSS.** After the `.footer-version` rule (around line 5696), using only words the hero
stamp does not hash (no `hero`, `thread`, `orbit`, `--float`, `--geo-d`, `--fit`,
`--view-h` anywhere in these blocks):

```css
  .footer-presence {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    line-height: 1.4;
    min-height: 1.4em;
    margin-top: 0.6rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    transition: opacity 400ms ease;
  }
  .footer-presence:empty { opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    .footer-presence { transition: none; }
  }
  @media print {
    .footer-presence { display: none; }
  }
```

Both themes come from `--text-dim`. 320px: the footer already drops to 1rem gutters under
600px and the line is a dozen characters. Stack and swipe: the footer is outside `<main>`
and the pager. Hero: untouched. Companion, bottom bar, Back to the top, Filter: the line is
flow content near the top of the footer, whose bottom padding already clears the bar; it
is not a control, so the companion's keep-out does not change.

**Copy.** The line: `${n} here now` / `${n} người đang ở đây`, shown only for n ≥ 2, so
no singular. Added to `JS_EXTRA` in `scripts/build-i18n.py` as `"${n} here now"` (the
`${}` makes the prose test reject it, as with `"Take ${i + 1}"`), with the pair in
`content/i18n/vi.json`.

The note, a `<p class="footer-colophon footer-privacy">` inserted directly after the ESV
colophon's closing `</p>` and before `<p class="footer-explore-label">explore</p>` — do not
touch the ESV block itself, which `PAGE_REWRITES` removes from `/vi/` by exact match and
must keep matching once:

> Here now counts open pages, not people. Your browser keeps the day it was last here, so a
> return can be told from a first visit; the server keeps that day's totals and nothing
> else. With Do Not Track or Global Privacy Control on, you are counted here now and in
> nothing else.

Vietnamese, a draft for a reader of the language (Waiting on Tam):

> Dòng đang ở đây đếm số trang đang mở, không đếm người. Trình duyệt của bạn chỉ giữ ngày
> ghé thăm gần nhất, để phân biệt lần quay lại với lần đầu; máy chủ chỉ giữ tổng theo ngày,
> không gì khác. Nếu bật Do Not Track hoặc Global Privacy Control, bạn chỉ được tính vào
> dòng đang ở đây, không vào gì khác.

`.footer-privacy` needs no CSS of its own; `.footer-colophon` already sets it. Run
`docs/voice.md`'s bar and the no-ai-slop skill on both before committing.

**The client.** One classic `<script>` at the foot of the page, after the footer-language
script and before the service-worker registration (around line 18286), outside every
anchor `hero-stamp.py` hashes. `readStored`/`writeStored` are the head script's top-level
functions and are in scope. Reference implementation — the coder may restructure, but each
behaviour in § 2 and each `from` string in the faults table below must survive verbatim:

```html
<script>
(() => {
  // Here now. A heartbeat to the presence server while this page is open and
  // visible, and the count it answers with on the line under the version.
  // Only the live site beats: a checkout, a check and the simulator schedule
  // nothing at all, so the hero's cost checks keep measuring the hero.
  const dev = readStored('presence-dev');
  const base = location.hostname === 'wholy.sh' ? 'https://live.wholy.sh/presence'
    : /^https?:\/\//.test(dev || '') ? dev.replace(/\/$/, '') : null;
  if (!base) return;
  const line = document.getElementById('presence');
  const lang = document.documentElement.lang === 'vi' ? 'vi' : 'en';
  const anonymous = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  const token = crypto.randomUUID ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const BEAT = 30000, BYE_AFTER_HIDDEN = 60000, STALE = 90000, TIMEOUT = 10000;
  let announced = false, failures = 0, lastOk = 0, timer = 0, hiddenTimer = 0, inflight = false;
  const say = n => { line.textContent = n >= 2 ? `${n} here now` : ''; };
  const schedule = ms => { clearTimeout(timer); timer = setTimeout(beat, ms); };
  const beat = async () => {
    if (inflight || document.visibilityState !== 'visible' || navigator.onLine === false) return;
    if (lastOk && Date.now() - lastOk > STALE) say(0);
    let body = `t=${token}&l=${lang}&f=${announced ? 0 : 1}`;
    if (anonymous) body += '&a=1';
    else { const d = readStored('presence-day'); if (d) body += `&d=${d}`; }
    inflight = true;
    try {
      const r = await fetch(`${base}/beat/`, {
        method: 'POST', body, mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT) : undefined,
      });
      if (!r.ok) throw new Error(String(r.status));
      const { n, d } = await r.json();
      if (!announced && !anonymous && d) writeStored('presence-day', d);
      announced = true; failures = 0; lastOk = Date.now();
      say(n);
      schedule(BEAT);
    } catch (e) {
      say(0);
      failures = Math.min(failures + 1, 4);
      schedule(Math.min(BEAT * 2 ** failures, 300000) * (0.75 + Math.random() / 2));
    } finally { inflight = false; }
  };
  const bye = () => {
    clearTimeout(timer); say(0);
    const body = new Blob([`t=${token}&bye=1`], { type: 'text/plain;charset=UTF-8' });
    if (navigator.sendBeacon) navigator.sendBeacon(`${base}/beat/`, body);
    else fetch(`${base}/beat/`, { method: 'POST', body, mode: 'cors', credentials: 'omit', keepalive: true }).catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { clearTimeout(hiddenTimer); schedule(Math.max(0, 10000 - (Date.now() - lastOk))); }
    else { clearTimeout(timer); hiddenTimer = setTimeout(bye, BYE_AFTER_HIDDEN); }
  });
  window.addEventListener('pagehide', bye);
  window.addEventListener('pageshow', e => { if (e.persisted) beat(); });
  window.addEventListener('online', beat);
  window.addEventListener('offline', () => { clearTimeout(timer); say(0); });
  const start = () => (window.requestIdleCallback ? requestIdleCallback(beat, { timeout: 3000 }) : setTimeout(beat, 1000));
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
})();
</script>
```

Syntax stays inside what the page's oldest Safari runs (`page-chrome.js` has a `bytes`
fault for exactly this): no optional chaining, no `??`, and every newer API is guarded
(`randomUUID`, `AbortSignal.timeout`, `requestIdleCallback`, `sendBeacon`).

**Generated files.** After the copy lands: `python3 scripts/build-i18n.py --build --lang vi`
(fails until vi.json has the line and the note), then `extract-copy.py`,
`extract-content.py`, `build-themes.py` as `docs/deploy.md` says. `sw.js` is untouched: the
shells are network-first so the new page arrives without a bump, the service worker never
sees `sendBeacon` as anything it would cache, and its catch-all branch passes a cross-origin
POST straight through (`caches.match` ignores non-GET; the write-back is same-origin only).
There is no CSP on the page; if one ever arrives it needs `connect-src https://live.wholy.sh`.

### 4. Deploy

**The server** — Tam's hands, because it needs `fly auth login` and the brief forbids
creating cloud resources from here. From the kit checkout, with the `presence` branch
merged:

```sh
fly apps create wholy-live --org personal
fly volumes create myapp_data --app wholy-live --region yyz --size 1 --yes
fly secrets set --stage --app wholy-live \
  SECRET_KEY="$(openssl rand -base64 48 | tr -d '\n')" \
  DATABASE_URL='sqlite:////data/db.sqlite3' \
  MEDIA_URL='https://wholy-live.fly.dev/media/' MEDIA_ROOT='/data/uploads' USE_LOCAL_FILE_STORAGE='True' \
  PRESENCE_ORIGINS='https://wholy.sh' \
  PRESENCE_STATS_TOKEN="$(openssl rand -hex 32)" \
  PRESENCE_TIMEZONE='America/New_York' \
  ALLOWED_HOSTS_EXTRA='live.wholy.sh'
just fly-deploy-app-sqlite wholy-live          # admin/configs/fly-sqlite.toml: 512MB, always on
fly certs add live.wholy.sh --app wholy-live   # prints the CNAME target; or: fly certs setup live.wholy.sh
```

Then at Porkbun: `CNAME live → <the .fly.dev hostname fly printed>`. `fly certs check
live.wholy.sh --app wholy-live` until issued (Let's Encrypt, automatic). Confirm with
`curl https://live.wholy.sh/healthz/`. The three `MEDIA_*`/storage secrets are unused here
but `settings.py` refuses to boot without them, by design. 512MB because that is the
config the runbook knows; the cold start is ~17s with migrations.

*Riding the existing machine instead*: skip create/volume/deploy; `fly secrets set --app
webframework PRESENCE_ORIGINS=… PRESENCE_STATS_TOKEN=… PRESENCE_TIMEZONE=…
ALLOWED_HOSTS_EXTRA=live.wholy.sh`, redeploy, `fly certs add` on `webframework`. *A VPS*:
`docker build` the kit's Dockerfile, run with `-v data:/data -p 127.0.0.1:8000:8000` and the
same environment, Caddy in front for TLS, an A record for `live`. *Cheaper later*: in a copy
of `fly-sqlite.toml`, `auto_stop_machines = 'suspend'`, `min_machines_running = 0` — the
heartbeat wakes it; the first visitor after a quiet hour sees no line for a minute.

**The page** — `scripts/deploy.sh` as always. It copies seven named paths and the
top-level `assets/*` glob, not recursively; nothing in this plan adds a file to any of
them, and nothing new ships by accident. Deploy the page **after** `live.wholy.sh`
answers: before that, every open page on wholy.sh would try, fail, and settle into a beat
every five minutes — harmless, but pointless.

**Local dev.** Kit: `just runserver` with `PRESENCE_ORIGINS=http://127.0.0.1:8080,http://localhost:8080`
in `server/.env`. Page: `python3 -m http.server 8080` in the checkout, then in DevTools
`localStorage.setItem('presence-dev', 'http://localhost:8000/presence')` and reload. Two
tabs show **2 here now** within a beat.

### 5. Keeping the checks honest

**What does not move.** The hero's three checks and the pager's four open the page on
`127.0.0.1`, where the client returns before scheduling anything, so their renderer
counters and their "no requests" assumption hold by construction — and `presence.js`'s
`quiet` step below turns that assumption into a check. `hero-stamp.py --check` hashes the
hero section, the term table, `ringAt`…`applyNodes`, CSS blocks naming the wheel, and the
font requests and `--font-*` tokens; the new CSS names none of those words and the script
sits outside every anchor, so the stamp is unaffected — run `--check` to prove it rather
than trust this paragraph.

**Gates to run.** The deploy five (`build-i18n`, `check-assets`, `build-mark --check`,
`hero-stamp --check`, `subset-fonts --check`), the final-tree five from CLAUDE.md
(`pet-picker.js`, `hero-motion.js --only pet-press,pet-taps,pet-drop,pet-pupil,pet-fuse,pet-adrift,reduced-live --verify`,
`page-chrome.js`, `thread-view.js`, `tradition-filter.js`), and the new `presence.js
--verify`. The CLAUDE.md table has no row for the footer; the footer gains ~2.2em, which
touches nothing a thread or the wheel measures, so the five are the broad gate and
`thread-landing.js` is not needed. In the kit: `just verify`.

**New check: `scripts/presence.js`.** House style as `page-chrome.js`: `FAULTS` of
`[from, to, width, step]` applied to the page in flight, each `from` exactly once in the
English page; `STEPS` opening their own contexts through `hero-test-support.js`
(`serve`, `launchBrowser`, `cacheFonts`, `harness`, `skipEntrance`, `pool`); `--jobs`,
`--only`, `--verify`, `--verify-full`, `--timings`. Cells: `en` at 390 under reduced
motion, `vi` at 1280 with motion on. A fake server is `context.route('http://presence.test/**', …)`
fulfilling JSON with `Access-Control-Allow-Origin: *` (the host never resolves; routing
happens first), switched on by an init script that stores
`presence-dev = 'http://presence.test/presence'`. Time is `page.clock`, as the dwell step in
`page-chrome.js` uses it — nothing in this client reads a frame. Steps:

| step | asks | fault (`from` → `to`) |
|---|---|---|
| `quiet` | Served plainly (no `presence-dev`), settled, then 5s on the clock: every request the context saw went to the page's own origin or the font hosts, and `#presence` is empty. Counting requests is the whole step; the client's early return leaves nothing else to look for. | **a checkout beats**: `location.hostname === 'wholy.sh' ?` → `location.hostname !== 'wholy.sh' ?` |
| `line` | First beat answered `{"n":7,"d":"2026-10-12"}` → the line reads `7 here now` / `7 người đang ở đây`, computed `opacity` 1; the request was a POST, `text/plain`, body matching `^t=[A-Za-z0-9-]{32,36}&l=(en\|vi)&f=1$`. `online` dispatched, answered `{"n":1}` → empty. Answered `500` → empty. Answered `{"n":3}` → `3 here now`. | **alone is a number**: `n >= 2 ? \`${n} here now\`` → `n >= 1 ? \`${n} here now\``; **a failed beat keeps the number**: `} catch (e) {\n      say(0);` → `} catch (e) {` |
| `hello` | Nothing stored: body has `f=1` and no `d`; after the answer `presence-day` is `2026-10-12`. Stored `2026-10-01`: body has `d=2026-10-01`. Second beat (clock +30s) has `f=0`. | **the day is never kept**: `writeStored('presence-day', d);` → `void d;` |
| `dnt` | Init script defines `navigator.doNotTrack` as `'1'`: body has `a=1` and no `d`; `presence-day` stays unset after the answer. | **do not track is not honoured**: `const anonymous = navigator.doNotTrack === '1' \|\| navigator.globalPrivacyControl === true;` → `const anonymous = false;` |
| `hidden` | After the line shows, `document.visibilityState` is overridden to `'hidden'` (`Object.defineProperty` in-page) and `visibilitychange` dispatched; clock +59s: no further beat; clock +2s: one request with `bye=1` and the line is empty; override back to `'visible'`, dispatch: a beat with `f=0` within 10s and the line is back. | **a hidden page keeps beating**: `else { clearTimeout(timer); hiddenTimer = setTimeout(bye, BYE_AFTER_HIDDEN); }` → `else {}` |
| `print` | `emulateMedia({ media: 'print' })`: `#presence` computed `display` is `none`. | **the line prints**: the `@media print` block above → `''` |
| `reduced` | Under `reducedMotion: 'reduce'`, computed `transition-duration` of `#presence` is `0s`. | **the line fades under reduced motion**: `.footer-presence { transition: none; }` → `''` |

`--verify` runs each fault against the step named; `--verify-full` against every step of
its cell. Under a minute. Add it to CLAUDE.md beside `page-chrome.js`, with the one
sentence that matters: it is the only check that lets the page beat, and it does so
against a fake server on a fake clock.

If `hidden`'s `bye` beacon proves invisible to Playwright's routing, the fallback is to
assert it through the client's own `fetch … keepalive` path by deleting `navigator.sendBeacon`
in the init script — say so in the step's comment, do not loosen the step.

### 6. Commits

One decision each, `TZ=America/New_York`, staged by path, reasoning in the message, and
every hand-off into `docs/open.md` in the same commit.

Kit (`~/code/webframework`, branch `presence`):
1. `ALLOWED_HOSTS_EXTRA`: an instance names its host in the environment.
2. `presence`: models, migration, the beat, its tests.
3. `presence`: stats behind a bearer token, retention, its tests.
4. Docs: the spec, CLAUDE.md, `.env.example`, deploy-fly *Instances*.

Page (`wholy.sh-landing`, worktree `here-now` off `main`):
1. The footer reserves a line (markup + CSS + `JS_EXTRA` + vi.json + rebuilt `vi/`): the
   page says nothing yet; the space is there so it never moves.
2. The client: beats only on wholy.sh, says the count, says nothing when unsure.
3. The note under the ESV colophon, EN and VI, and the regenerated copy docs.
4. `scripts/presence.js` and its CLAUDE.md paragraph.
5. `docs/here-now.md` (the client, the wire, where the server lives — kit path, Fly app,
   stats call — and the privacy posture), the `open.md` lines below, and the work log
   `docs/work-log/2026-10-XX-here-now.md`.

### 7. Waiting on Tam — lines for `docs/open.md`

Under *Decide* (the file has no section for actions; the deploy is the decision carried
out, so it rides with it):
- Here now's server: its own Fly app `wholy-live` (~$3.84/mo, its own database; the plan's
  assumption), the existing `webframework` machine ($0 more, shared database and deploys),
  or a VPS you already pay for. The kit code is the same in all three. Then create it as
  `plans/PLAN-2026-10-12-here-now.md` § 4 says (`fly auth login` first — the Mac's `fly` is
  logged out), keep `PRESENCE_STATS_TOKEN` where you keep secrets, and deploy the page only
  after `curl https://live.wholy.sh/healthz/` answers.
- Here now, later: `auto_stop_machines = 'suspend'` once the bill matters more than the
  first visitor's minute without a line.

Under *Read on the page*:
- "7 here now" and the footer note, in English.
- "7 người đang ở đây" and the Vietnamese note — a reader of the language; both are drafts.

Under *Try on a device*:
- Here now on the phone: a second tab makes 2; a hidden tab drops out within a minute;
  back from sleep the line clears and returns within a beat; Safari's back-forward cache
  keeps the count without a new visit.

## Rejected: Cloudflare Worker + Durable Object

Kept here in enough detail that switching is a decision, not a re-plan. The client in
§ 3 becomes a WebSocket client; the server becomes a Worker and one Durable Object.

**Why not now.** The custom domain needs the wholy.sh zone on Cloudflare (verified: Custom
Domains require an active zone; a subdomain-as-its-own-zone is Enterprise-only), so step
one would ship on `wholy-presence.<account>.workers.dev` or move Tam's DNS off Porkbun.
The social steps that follow would be a second backend, or a rebuild of what the kit has.
The Durable Object API is Cloudflare's alone. None of that is a flaw in the engine, which
is the better one for presence by itself.

**What it would be** (APIs and limits checked against Cloudflare's docs on 2026-10-12):
a `presence/` directory at the wholy.sh repo root (never shipped: `deploy.sh` copies named
paths), `wrangler.jsonc` with `name: "wholy-presence"`, `main: "src/index.js"`,
`compatibility_date: "2026-10-12"`, `durable_objects.bindings: [{name: "ROOM", class_name:
"Room"}]`, `migrations: [{tag: "v1", new_sqlite_classes: ["Room"]}]`,
`observability.enabled: false` (no request logs with addresses); `package.json` with
`wrangler ^4` and its own `.gitignore`. The Worker: `GET /ws` with `Upgrade: websocket`
(else 426), Origin allowlist (`https://wholy.sh`, `http://localhost:*`,
`http://127.0.0.1:*`) else 403, forwarded to `env.ROOM.getByName('wholy')`; `GET /stats`
with the bearer token. The `Room extends DurableObject`: `ctx.acceptWebSocket(ws)` with
the hello (`l`, `d` or `a`) as query params and `serializeAttachment` for the language;
`setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))` so the
client's 30s ping costs nothing and wakes nothing; `webSocketClose`/`webSocketError`
recount; count = `ctx.getWebSockets().length`; broadcast `{"n"}` coalesced to one per
second; any client message other than `ping` closes with 1008; cap 500 sockets (503). State
in `ctx.storage.sql`: `visits(day, lang, kind, n)` and `peaks(day, peak)` — the same schema
as § 1 — day from `Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York'})`. No alarms
and no `setTimeout` held across messages: either prevents hibernation. The client: hello on
open, `{"n","d"}` then `{"n"}`, `ping` every 30s and reconnect if no `pong` in 10s, close
after 60s hidden and reconnect on visible, close on `pagehide`, reconnect on `pageshow`
persisted, backoff 1, 2, 4, 8, 16, 32, 60s with jitter. Free plan: 100k DO requests/day
(one per connection; incoming messages 20:1; outgoing and auto-responses free), 5M rows
read, 100k written, hibernating sockets unbilled; a deploy disconnects every socket, and
in-memory state resets on hibernation, which is why the count is the socket list, not a
variable. Local dev `npx wrangler dev` → `ws://127.0.0.1:8787/ws`; secret
`npx wrangler secret put STATS_TOKEN`. Tests would use Playwright's `page.routeWebSocket`
(present in the installed 1.58.2) instead of `context.route`.

## Rejected, in a line each

- **WebSockets on the kit now** — gunicorn's sync workers cannot hold them; it means
  uvicorn or Channels for the whole kit and a single process or Redis to share the room.
  Right when a feature needs it, wrong as a side effect of a footer line.
- **Server-sent events on the kit** — each open stream pins a sync worker; two workers,
  two readers.
- **A cookie or a sent id** — the brief ruled out cookies; the id turned out unnecessary.
- **Per-thread counts, names, a roster** — Tam decided one line; a roster is a later
  step and needs the identity this one deliberately lacks.
- **Counting hidden tabs** — a tab nobody is looking at is not "here".
- **Polling faster than 30s** — the proxy's 60s idle limit is the only reason a socket
  would need it; a footer line does not.
- **Showing "1 here now"** — alone on a page, the line would be the site talking to
  itself.
- **A Django admin page for the totals** — the token endpoint is what was decided; the
  admin needs a superuser and a login the instance otherwise has no reason to carry.

## Deliberately not in scope

Accounts, posts, who-is-here, anything per-thread; moving wholy.sh's DNS; a dashboard for
the stats (curl and a JSON file are enough for step one); a stable visitor id; Postgres;
more than one machine. The kit's `presence` app is written so none of these needs it torn
up: the beat is what a socket would carry, the tables are what a roster would read, and
the stored day is where an id would go.

## Caveats, recorded so they are not discovered

- Safari's ITP can clear localStorage for a site not visited in seven days of use; a
  returning Safari reader may count as new. The stats are advisory and say so.
- The totals can be fed by anyone who can POST with an `Origin` header set, which is
  anyone with `curl`. The limiter bounds the rate; nothing bounds the intent. Advisory.
- A server deploy drops every beat's answer for the boot (~20–40s with migrations); the
  line empties and comes back within a beat.
- `sendBeacon` on `pagehide` is best-effort everywhere; the 60s window is what makes it
  not matter.
- Fly's prices are per region and move; the figures above are their published `iad`/`ewr`
  numbers on 2026-10-12.
