# Launch-Arming Runbook — External Scheduler, Realtime & Production Posture

> **Scope:** operator runbook for arming everything that ships in this repository but is triggered from OUTSIDE it — the four cron sweep routes, the notification WebSocket sidecar, the Redis fan-out bus, and the production environment posture lines the launch checklist gates on.
> **Audience:** the on-call operator arming production on launch day. No prior familiarity with this repository is assumed.
> **Posture:** every armed surface is fail-closed — an un-armed deployment exposes no cron endpoint at all (bare 404), boots no sidecar (exit 1), and the probe below reports every missing piece as a named FAIL line. Nothing silently no-ops except one hazard this runbook calls out explicitly (fan-out transport degradation).
> **Secrets rule:** this document prints secret NAMES and verification commands ONLY. No secret value, DSN password, or bearer token ever appears here, in the probe output, or in any filed evidence.

---

## Summary

Kottaby ships four externally-triggered maintenance sweeps, a standalone notification WebSocket sidecar, and a Redis-backed fan-out bus. None of them runs by itself:

- **Four cron sweep routes** under `app/api/cron/` — each is a GET-only, bearer-gated endpoint that executes one transactional sweep per authenticated call. An external scheduler MUST call each route at a **≤5-minute cadence** with `Authorization: Bearer ${CRON_SECRET}`.
- **Notification WS sidecar** (`scripts/start-notification-ws.ts`) — a separate process from the Next.js app; it MUST be booted as a launch checklist line and survives behind the Redis bus only.
- **Redis fan-out bus** — the app process publishes notification frames onto Redis; the sidecar subscribes. A transport misconfiguration here degrades SILENTLY (see the hazard section).

One-line purpose: *the sweeps, the realtime pushes, and the database backstops are shipped and tested — but until the environment-side arming below is done and evidenced, none of it actually runs in production.*

**Nothing in this repository proves any external scheduler calls these routes.** Arming is environment-side evidence (deferred-items ledger **D7**): the operator arms the scheduler, runs the probe, records the evidence rows, and signs the §7/§9 ops lines in `docs/planning/PRODUCTION_READINESS.md`.

---

## Why

The launch-readiness checklist blocks launch on scheduler arming, backup scheduling, and a defined RTO/RPO (see `docs/planning/PRODUCTION_READINESS.md` §7 and the scheduler-arming conditions on rows 2.1.2 / 8.12 / 8.24 / 8.25). The behaviors themselves are verified green by the launch gate's suites; what the gate cannot verify from inside the repository is whether the production environment actually TRIGGERS them. The surfaces at stake:

- **Session auto-cancel (B.2):** without the sweep, a session whose 24-hour dual-confirmation window lapses is never auto-cancelled and the held fee never refunded.
- **Subscription expiry:** without the sweep, expired subscriptions never materialize and their lanes never zero.
- **Teacher auto-offline (B.15):** without the sweep, a teacher who walked away stays "online" and keeps receiving matching traffic.
- **Paymob settlement healing:** without the sweep, a purchase whose settlement callback was lost stays `pending` forever.
- **Realtime notifications:** without the sidecar + Redis bus, notification rows still persist (persist-first doctrine — `docs/notifications/realtime-engine.md`) but no live frame is ever pushed.
- **Database backstops:** the `prevent_users_delete` trigger is armed by default, but its GUC opt-out must be provably absent from production; DB TLS must be forced by the connection string.

---

## The Armed Surfaces

### 1. The four cron sweep routes

| Route | Sweep executed per call | Success envelope (`data`) | Service |
|---|---|---|---|
| `GET /api/cron/sweep-sessions` | 24-hour dual-confirmation timeout sweep (B.2) — batch cancel + same-lane refunds | `{ cancelled, refunded }` | `SessionLifecycleService.sweepExpiredSessions` |
| `GET /api/cron/sweep-inactive-teachers` | Inactivity auto-offline sweep (B.15, 15-min default) | `{ offlined }` | `TeacherInactivityService.sweepInactiveTeachers` |
| `GET /api/cron/expire-subscriptions` | Validity-window expiry — batch flip to `expired` + lane zeroings | `{ expired, lanesZeroed }` | `SubscriptionExpiryService.expireDue` |
| `GET /api/cron/reconcile-paymob-payments` | Paymob stuck-`pending` settlement healing via provider inquiry | `{ checked, confirmed, failed, skipped }` | `reconcilePendingPaymobPayments` |

Route files: `app/api/cron/{sweep-sessions,sweep-inactive-teachers,expire-subscriptions,reconcile-paymob-payments}/route.ts` — all four ride the shared envelope factory `backend/lib/gateway/cron-endpoint.ts` so their contracts cannot drift apart.

**Shared endpoint contract** (inherited from the factory — verified by the route test suites):

- **GET-only** — every other verb gets Next.js's own 405.
- **Mode gates fail closed** — unless BOTH `CRON_EXECUTION_MODE=external` AND `CRON_EXTERNAL_ENABLED=true`, the route answers a BARE 404: no envelope, no error code, no `requestId` — indistinguishable from any unknown path. This is the kill switch: a mis-deployed or un-armed environment exposes no cron endpoint at all.
- **Rate-limited before the credential compare** — the `cron-sweep` limiter (100 req/60s per client IP) throttles repeated failed-auth guessing with 429; a correct bearer cannot bypass a spent quota.
- **Timing-safe bearer compare** against `CRON_SECRET` (SHA-256 digests via `node:crypto.timingSafeEqual`); a missing/mismatched/whitespace-only secret is a fail-closed 401. The secret is never accepted via query string.
- **Honest-counts envelope** — success is `{ data: <counts>, requestId }`; zero row identities cross the wire. A thrown sweep failure is masked through the shared error envelope.

### 2. Arming environment variables

The route gates read (inside the handler, per request):

| Variable | Required production value | Default | Verified at |
|---|---|---|---|
| `CRON_EXECUTION_MODE` | `external` | `vercel-daily` | `.env.example:161` |
| `CRON_EXTERNAL_ENABLED` | `true` | `false` | `.env.example:170` |
| `CRON_SECRET` | set — strong random value (e.g. `openssl rand -base64 32`); **never printed, never in argv** | unset | `.env.example:151` |
| `CRON_EXTERNAL_SECRET` | defaults to `CRON_SECRET` when unset | falls back | `.env.example:173-174` |

A **≤5-minute cadence** per route is the launch requirement (the inactivity sweep's own docblock pins the same cadence; the teacher-offline window is 15 minutes, so a 5-minute scheduler keeps auto-offline latency inside one window).

### 3. Scheduling stanzas — copy-pasteable

These extend the backup-timer stanzas in [`docs/ops/disaster-recovery.md`](./disaster-recovery.md) (its §"Scheduling guidance", `:87-125`) with the four route timers. The scheduler MUST inject the bearer from the environment — never inline a secret value in any stanza.

```cron
# /etc/cron.d/kottaby-sweeps — every 5 minutes for each of the four routes
# (staggered minutes keep them off the same tick). Bearer comes from the
# root-owned 0600 /etc/kottaby/cron.env — never inline the value.
*/5 * * * * root . /etc/kottaby/cron.env && curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/sweep-sessions              >> /var/log/kottaby/cron-sweep-sessions.log 2>&1
1-59/5 * * * * root . /etc/kottaby/cron.env && curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/sweep-inactive-teachers  >> /var/log/kottaby/cron-sweep-inactive-teachers.log 2>&1
2-59/5 * * * * root . /etc/kottaby/cron.env && curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/expire-subscriptions         >> /var/log/kottaby/cron-expire-subscriptions.log 2>&1
3-59/5 * * * * root . /etc/kottaby/cron.env && curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/reconcile-paymob-payments   >> /var/log/kottaby/cron-reconcile-paymob-payments.log 2>&1
```

```ini
# /etc/systemd/system/kottaby-cron-sweeps.service
[Unit]
Description=Kottaby cron sweep routes (all four, sequentially)

[Service]
Type=oneshot
EnvironmentFile=/etc/kottaby/cron.env
ExecStart=/usr/bin/curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/sweep-sessions
ExecStart=/usr/bin/curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/sweep-inactive-teachers
ExecStart=/usr/bin/curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/expire-subscriptions
ExecStart=/usr/bin/curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://<app-origin>/api/cron/reconcile-paymob-payments
```

```ini
# /etc/systemd/system/kottaby-cron-sweeps.timer — every 5 minutes (the
# launch-mandated cadence)
[Unit]
Description=Kottaby cron sweep scheduler

[Timer]
OnCalendar=*:0/5
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
```

Platform schedulers (cron-job.org, QStash, GitHub Actions, Vercel Cron on Pro) are equally valid: the only contract is GET with the bearer header at ≤5-minute cadence against each route. Whichever you choose, keep the scheduler's OWN configuration screenshot/export as the operator-side arming evidence (ledger **D7**) — the repository cannot prove it.

**Scheduler kill switch:** setting `CRON_EXTERNAL_ENABLED=false` (or any mode other than `external`) instantly returns every route to a bare 404 — sweeps stop being reachable without any code change. Use this to quiesce during maintenance.

---

## Production Environment Checklist

Every key the armed posture depends on. "Verified at" is the canonical template line in `.env.example` unless noted — the probe and the config tests consume the SAME canonical seam (`backend/lib/env.ts` typed getters), so a value that passes here is the value the app actually resolves.

| Key | Required production value / posture | Verified at |
|---|---|---|
| `CRON_EXECUTION_MODE` | `external` | `.env.example:161` |
| `CRON_EXTERNAL_ENABLED` | `true` | `.env.example:170` |
| `CRON_SECRET` | set (strong random; never echoed/committed) | `.env.example:151` |
| `CRON_EXTERNAL_SECRET` | unset (falls back to `CRON_SECRET`) or set equal to it | `.env.example:173-174` |
| `REDIS_URL` | set — the fan-out bus endpoint | `.env.example:51` |
| `NOTIFICATION_FANOUT_TRANSPORT` | UNSET (ladder resolves to `redis` when `REDIS_URL` is set) or explicitly `redis`. **NEVER `in-process` when `REDIS_URL` is set** — see the hazard section | `.env.example:88-90` |
| `WS_HOST` / `WS_PORT` | the sidecar's bind address (dev default `127.0.0.1:3101`); `WS_PORT=0` binds an ephemeral port — then the probe needs `--ws-url` with the actual bound port | `.env.example:74,77` |
| `WS_ALLOWED_ORIGINS` | the production browser origin(s), exact match, comma-separated; NEVER a wildcard (wildcards are discarded — fail-closed to localhost default) | `.env.example:80-85` |
| `NEXT_PUBLIC_NOTIFICATION_WS_URL` | the public `wss://` edge that proxies the sidecar (build-time inlined) | `.env.example:104-109` |
| `DATABASE_URL` | MUST carry `sslmode=require` — **launch condition** (ledger D15). A plain DSN without it gets NO encryption (`backend/db/client.ts:42-46`); Neon-style hosts enable SSL implicitly, keep the parameter anyway | `.env.example:29` |
| `LOGIN_RATE_LIMIT_MAX` | unset (default 5) or a positive integer — per-account failed-login budget (ledger D22; seam `backend/lib/env.ts:138-146,441-442`) | `.env.example:252` |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | unset (default 900000 = 15 min) or a positive integer — per-account lockout window (ledger D22, same seam) | `.env.example:255` |
| `TEACHER_INACTIVITY_TIMEOUT_MINUTES` | unset (default 15) or the B.15 window the business ratified | `.env.example:101` |
| `ALLOWED_ORIGIN` | the HTTPS origin (production MUST set it — Secure auth cookies depend on it) | `.env.example:131` |
| `TEST_CI` / `TEST_SERVER` | **NEVER SET in production** — they disarm the users-delete guard and bypass rate limits; the DB client fail-fasts in production with them set (`backend/db/client.ts:163-172`) | `backend/db/client.ts:160-172`, `app/api/graphql/rate-limit.ts:48-56` |

---

## The Notification WebSocket Sidecar (launch checklist line)

The realtime lane is a SEPARATE process. Boot it as an explicit launch checklist step:

```bash
bun run scripts/start-notification-ws.ts        # package.json alias: bun run ws
```

- **It cannot boot without the Redis bus.** The entry fail-fasts with exit 1 if the fan-out transport resolves to `in-process` — a standalone sidecar process can never receive in-process fan-out from the Next.js process. Fix the transport, not the script.
- **Liveness oracle — there is no `/health` endpoint.** A LIVE sidecar answers every plain (non-upgrade) HTTP request with **`426 WebSocket upgrade required`** (`backend/ws/notification-ws-server-handshake.ts:57-60`). `curl -s -o /dev/null -w "%{http_code}" http://<WS_HOST>:<WS_PORT>` printing `426` IS the health check.
- **Shutdown is graceful** — SIGTERM/SIGINT unsubscribes the fan-out tap, closes every socket with `1001`, stops the listener, then closes the owned Redis client. Never `kill -9`.
- **Ephemeral-port caveat:** with `WS_PORT=0` the bound port is OS-assigned — the probe then needs `--ws-url http://<WS_HOST>:<actual-port>`.

## Fan-out Transport Degradation Hazard (the one silent failure)

Resolution ladder (`backend/lib/env.ts`, `.env.example:88-90`): an explicit `NOTIFICATION_FANOUT_TRANSPORT` wins; otherwise `redis` when `REDIS_URL` is set; else `in-process`.

**The hazard:** with `REDIS_URL` SET but the transport explicitly `in-process`, the APP still boots and everything looks healthy — but each process builds its own in-process tap, so **multi-process fan-out silently degrades**: notification rows persist, yet frames never reach the sidecar's sockets. There is no crash, no error line. This is the single silent-failure posture this runbook exists to catch — the probe's `verify-cron.fanout-transport` row exists precisely for it. Production rule: **`REDIS_URL` set ⇒ transport MUST resolve to `redis`.**

## Users-Delete-Guard Production Posture (ledger D17 — signed launch note)

The `prevent_users_delete` trigger (`backend/db/migration/14-prevent-users-delete.sql`) blocks every hard `DELETE FROM users`; user deactivation is governance soft delete only. The guard is **GUC-gated**:

- **ARMED whenever `kottaby.users_delete_guard` is UNSET** — the production default. No opt-out is configured anywhere in production.
- The `off` opt-out exists for TEST teardown only: it is pinned connection-time (pg Pool startup-options packet `backend/db/client.ts:189` / PGlite session pin `backend/db/pglite-pool.ts:214`) and applies only under `TEST_CI`/`TEST_SERVER` — which the production fail-fast guard (`backend/db/client.ts:160-172`) forbids in production anyway.
- **Production posture line:** the `off` value is NEVER set in any production connection string, environment file, GUC default, or `ALTER SYSTEM` — arming is the absence of configuration, verified below.

Verification commands (run on the production DB; all read-only):

```sql
-- 1. The trigger exists and fires BEFORE DELETE on users
SELECT tgname FROM pg_trigger WHERE tgrelid = 'users'::regclass AND tgenabled <> 'D' AND NOT tgisinternal;

-- 2. The GUC is absent from the session AND has no database/role-level default
SELECT current_setting('kottaby.users_delete_guard', true) AS session_guc;   -- expect NULL or ''
SELECT setconfig FROM pg_db_role_setting WHERE setconfig::text LIKE '%users_delete_guard%';   -- expect 0 rows
```

Expect: the trigger row present; `session_guc` empty/NULL; zero `pg_db_role_setting` rows. Additionally grep the production environment manifest (never the shell history) for the literal: `grep -R "users_delete_guard" /etc/kottaby/ <deploy env dir>` must return nothing.

## Backup-Timer Evidence Line (REQ-009 AC-3)

The database backup timer is armed per the DR runbook's own scheduling stanzas — [`docs/ops/disaster-recovery.md`](./disaster-recovery.md) §"Scheduling guidance" (`:87-125`). The cadence invariant is **RPO arithmetic**, not a guess: `schedule interval + backup runtime + scheduling jitter ≤ RPO 1h`. Measure the runtime from the run's `manifest.json` (`startedAtUtc` → `finishedAtUtc`); the documented half-hourly stanza assumes single-digit-minute dumps — re-derive the interval if the dataset outgrows it. Operator-side timer evidence (`systemctl list-timers` output or `crontab -l` capture) is recorded as the §7.1 ops sign-off line (ledger **D7**; the drill evidence itself is task 4.1's, `outcome/backup-timer-signoff.md`).

## Parent-Link On-Demand Cadence (ledger D13 / REQ-012 AC-5)

Scheduled parent-link sweep/reminder wiring is waived-with-sign-off to the canonical doc's cron-stream backlog ticket (`docs/parents/parent-link-request.md:87,123`). The launch posture is ON-DEMAND, and this runbook states the cadence that bounds the re-request lockout window (a silently-lapsed pending row blocks a fresh `requestLink` until the sweep materializes it — `parent-link-request.chaos.test.ts:801`):

```bash
bun run ops:sweep-link-requests          # materialize every lapsed pending → expired (idempotent; LIFTS the lockout)
bun run ops:remind-link-requests         # send pre-expiry reminders (default 24h horizon; lapsed rows are never its business)
```

**Recommended operational cadence: run the sweep at least once per operator shift and before any parent reports a "stuck" link request; run the reminder daily.** Zero-row re-runs are safe and idempotent.

## No Forgot-Password Endpoint (operator note)

The application ships NO self-service forgot-password endpoint — by design. Password reset is admin-initiated only (`test/workflows/admin/admin-password-reset.journey.test.ts`). Do not file a launch gap when a password-reset scheduler/bypass request arrives; route such requests to an administrator.

---

## Arming Evidence Procedure — `verify-cron.ts`

The live probe that records the arming evidence. It corroborates the armed scheduler surfaces in one run: the four route envelopes, the fan-out transport resolution, and the sidecar liveness.

```bash
bun run scripts/launch/verify-cron.ts [--url <app-base-url>] [--ws-url <sidecar-base-url>]
```

- The **bearer is read from the `CRON_SECRET` environment only** — never from argv (a `--secret` token is rejected as unknown). Run it in a shell that has the production secret loaded (e.g. `. /etc/kottaby/cron.env` first).
- `--url` — the production app origin (default `http://localhost:3000`; production always passes it).
- `--ws-url` — the sidecar's base URL when it is not on the env-seam default (`http://<WS_HOST>:<WS_PORT>`, default `127.0.0.1:3101`).

**Emitted evidence rows** (one JSON `ProbeLine` per stdout line, in order):

| Row | PASS when | Arming fact it evidences |
|---|---|---|
| `verify-cron.bearer` | emitted only as FAIL when `CRON_SECRET` is unset/whitespace | the bearer exists |
| `/api/cron/sweep-sessions` | 2xx; `envelope: cancelled=N, refunded=N` | the B.2 sweep is armed and reachable |
| `/api/cron/sweep-inactive-teachers` | 2xx; `envelope: offlined=N` | the B.15 sweep is armed and reachable |
| `/api/cron/expire-subscriptions` | 2xx; `envelope: expired=N, lanesZeroed=N` | the expiry sweep is armed and reachable |
| `/api/cron/reconcile-paymob-payments` | 2xx; `envelope: checked=N, confirmed=N, failed=N, skipped=N` | the reconciliation sweep is armed and reachable |
| `verify-cron.fanout-transport` | `REDIS_URL` set AND transport resolves to `redis` | the bus is configured; no silent degradation |
| `verify-cron.sidecar-healthcheck` | sidecar answers plain GET with `426` | the sidecar process is live |

Envelope recording discipline: sweep **counts** are recorded as `name=value`; every non-numeric payload value is recorded as its field NAME only (never echoed); an unreachable route is a named `route unreachable` FAIL — never a silent skip. A non-2xx route answer is `route gate fail-closed: status N` — 404 means the mode gates are off (kill switch active); 401 means the bearer is wrong. **Exit 0 iff every row is PASS.**

**Evidence contract (the D7 sign-off input):** run the probe in the ARMED launch environment, save the full stdout, and file it beside the launch report. Every FAIL row blocks arming sign-off until fixed. The probe's output carries no secrets by construction (bearer and Redis URL values are never echoed) — safe to commit.

## Launch-Day Arming Sequence (cold-operator checklist, in order)

1. **Set the arming environment** — `CRON_EXECUTION_MODE=external`, `CRON_EXTERNAL_ENABLED=true`, `CRON_SECRET` (strong random), on the production app environment. Restart the app so the gates read the new values.
2. **Verify the mode gates with the WRONG bearer** (proves the surface exists but is closed): `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer deliberately-wrong" <origin>/api/cron/sweep-sessions` → expect **401**. (A 404 here means the mode gates are still off — fix step 1. Any other code is an investigation.)
3. **Set the production posture keys** per the Environment Checklist — `REDIS_URL`, transport resolution (do NOT set `NOTIFICATION_FANOUT_TRANSPORT=in-process`), `WS_HOST`/`WS_PORT`/`WS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_NOTIFICATION_WS_URL`, `DATABASE_URL` with `sslmode=require`, `ALLOWED_ORIGIN` HTTPS.
4. **Verify the users-delete-guard posture** — run the three SQL checks above; confirm zero `users_delete_guard` occurrences in the environment manifest; confirm `TEST_CI`/`TEST_SERVER` are unset.
5. **Boot the WS sidecar** — `bun run scripts/start-notification-ws.ts`; confirm the log line `Notification WS sidecar started` with `transport: "redis"`.
6. **Arm the external scheduler** — install the cron/systemd/platform stanzas (or their platform equivalent) at ≤5-minute cadence; keep the scheduler configuration export as operator-side evidence.
7. **Run the arming probe** — `bun run scripts/launch/verify-cron.ts --url https://<origin> [--ws-url <sidecar-url>]`; every row must be PASS (exit 0).
8. **Record the evidence** — save the probe stdout + the scheduler config export + the GUC check outputs; fill the sign-off table below; file them with the launch report.
9. **Confirm the backup timer** per the DR runbook stanzas; capture `systemctl list-timers` / `crontab -l` output as the §7.1 evidence.

### Arming sign-off table (fill at launch)

| Evidence piece | Recorded artifact | Verified by (name) | Date |
|---|---|---|---|
| `verify-cron.ts` full output — 7/7 PASS | | | |
| External scheduler config export (all four routes, ≤5-min cadence) | | | |
| Sidecar boot log + live 426 answer | | | |
| Users-delete-guard GUC posture checks (3 SQL outputs + manifest grep) | | | |
| Backup-timer evidence (`systemctl list-timers` / `crontab -l` capture) | | | |
| Production env checklist reviewed against `.env.example`/this table | | | |

---

## What NOT to Do

- **Never inline the secret in a stanza, ticket, log, or this runbook's evidence.** Header injection comes from the environment file (root-owned, `0600`); `curl -H "Authorization: Bearer ${CRON_SECRET}"` only.
- **Never set `NOTIFICATION_FANOUT_TRANSPORT=in-process` on a deployment with `REDIS_URL` set** — that is the silent-degradation hazard, not a tuning knob.
- **Never accept a probe run with FAIL rows as arming evidence** — "mostly armed" is un-armed; the exit code is the contract.
- **Never treat a daily-only cron cadence as armed** — each route needs ≤5-minute cadence (the daily floor exists only for the BACKUP timer, and even that needs the half-hourly stanza to satisfy RPO 1h).
- **Never set `kottaby.users_delete_guard=off` — anywhere, ever, in production.** The trigger's armed state IS the absence of the setting.
- **Never run production with `TEST_CI`/`TEST_SERVER` set** — they disarm the users-delete guard and bypass rate limiting; the DB client fail-fasts, but do not rely on the crash.
- **Never kill the sidecar with `kill -9`** — graceful SIGTERM closes sockets with `1001` and releases the Redis subscription cleanly.

---

## Related Documents

- [`docs/planning/PRODUCTION_READINESS.md`](../planning/PRODUCTION_READINESS.md) — the launch checklist this runbook's evidence feeds (§7 ops lines, §9 sign-off; scheduler-arming condition noted on row 2.1.2)
- [`docs/ops/disaster-recovery.md`](./disaster-recovery.md) — the sibling ops runbook (backup timer stanzas `:87-125`, RPO/RTO arithmetic, quarterly cold drill)
- `scripts/launch/verify-cron.ts` — the arming probe (this runbook's evidence instrument)
- `backend/lib/gateway/cron-endpoint.ts` — the shared route contract (mode gates, bearer compare, envelopes)
- `docs/notifications/realtime-engine.md` — persist-first doctrine; sidecar/Redis fan-out architecture
- `docs/parents/parent-link-request.md` — the on-demand sweep/reminder primitives this runbook's cadence line covers
- `docs/billing/paymob-gateway.md` — the Paymob reconciliation surface the fourth route heals

---

## Appendix: Recorded Environment Evidence

**Honest posture statement.** Scheduler arming is environment-side (ledger D7) — no in-repo artifact can prove it. What follows is the probe's LIVE output captured in this repository's development environment on **2026-10-09**, recorded to demonstrate the probe's legs and to state this environment's posture honestly: the pieces that are missing here are named as MISSING, never as armed.

### Run A — environment as-is (no sidecar, no CRON_SECRET, no armed web server)

`bun run scripts/launch/verify-cron.ts` → exit 1 — 7 rows, 1 PASS / 6 FAIL:

```
{"rowId":"verify-cron.bearer","result":"FAIL","detail":"CRON_SECRET is not set — the routes cannot be authenticated (fail-closed)"}
{"rowId":"/api/cron/sweep-sessions","result":"FAIL","detail":"not probed — CRON_SECRET is not set (fail-closed: no unauthenticated request is sent)"}
{"rowId":"/api/cron/sweep-inactive-teachers","result":"FAIL","detail":"not probed — CRON_SECRET is not set (fail-closed: no unauthenticated request is sent)"}
{"rowId":"/api/cron/expire-subscriptions","result":"FAIL","detail":"not probed — CRON_SECRET is not set (fail-closed: no unauthenticated request is sent)"}
{"rowId":"/api/cron/reconcile-paymob-payments","result":"FAIL","detail":"not probed — CRON_SECRET is not set (fail-closed: no unauthenticated request is sent)"}
{"rowId":"verify-cron.fanout-transport","result":"PASS","detail":"REDIS_URL is set and the fan-out transport resolves to the Redis bus"}
{"rowId":"verify-cron.sidecar-healthcheck","result":"FAIL","detail":"sidecar unreachable: Unable to connect. Is the computer able to access the url?"}
```

### Run B — sidecar boot → liveness leg → clean shutdown

Sidecar booted on a non-default port (`WS_PORT=3199 bun run scripts/start-notification-ws.ts`) to avoid colliding with any concurrently running dev sidecar; Redis bus selected:

```
[INFO] Notification WS sidecar listening [{"host":"127.0.0.1","port":3199}]
[INFO] Notification WS sidecar started [{"host":"127.0.0.1","port":3199,"transport":"redis"}]
```

`curl` liveness oracle: plain GET answered **426**. Probe re-run with `--ws-url http://127.0.0.1:3199` → exit 1 — 7 rows, **2 PASS** (the unchanged five posture rows plus):

```
{"rowId":"verify-cron.sidecar-healthcheck","result":"PASS","detail":"status 426 — the sidecar answered a non-upgrade liveness probe (WebSocket upgrade required)"}
```

Shutdown: SIGTERM → the sidecar logged `shutting down [{"signal":"SIGTERM"}]` then `shut down [{"host":"127.0.0.1","port":3199}]` — port 3199 verified CLOSED afterward, no sidecar process left behind.

### This environment's honest D7 gap list (NOT arming evidence)

| Arming piece | Status here | Why |
|---|---|---|
| `REDIS_URL` → Redis bus transport resolution | **PASS, live** | Redis listens locally; the canonical seam resolves `redis` |
| WS sidecar liveness (426 oracle) | **PASS, live** (Run B — booted, probed, shut down cleanly for this record) | no long-running sidecar is kept in this dev environment |
| `CRON_SECRET` bearer | **MISSING** | not set in this environment (dev) |
| Armed web server (route 2xx envelopes) | **MISSING — deliberately not armed** | arming a dev server would fire the four REAL sweeps (incl. the Paymob provider reconciliation) against the shared dev database mid-development; the 2xx envelope path is pinned by the probe's unit tests instead |
| External scheduler | **MISSING (by definition)** | environment-side, ledger D7 — nothing in-repo can prove it; armed and evidenced at launch per this runbook |

The 2xx route-envelope PASS rows are recorded by re-running the probe in the ARMED launch environment (Launch-Day Arming Sequence, step 7) — that output, all-PASS, is the arming evidence the §7/§9 ops sign-off lines consume.
