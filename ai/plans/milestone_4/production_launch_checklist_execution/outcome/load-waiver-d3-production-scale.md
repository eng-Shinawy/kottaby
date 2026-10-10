# D3 Waiver Package — Production-Scale Load Runs (rows 6.1–6.3 production limbs)

**Prepared by:** Task 4.2 executor (Load drill execution) — 2026-10-09
**Status:** SIGNED 2026-10-10 — every waiver row below carries a named owner and its signatory (Ahmed; collected interactively from the repo owner via structured sign-off prompt, 2026-10-10; see also `docs/planning/PRODUCTION_READINESS.md` §9). An unsigned waiver would remain a launch FAIL per the Launch Gate rule (`PRODUCTION_READINESS.md:12`) and `computeVerdict` (tasks.md 4.4).
**Ledger anchor:** deferred-items.md **D3** (✅ resolved-pointer, drill-conditional) — "production-scale runs recorded as launch-drill evidence rows or signed waivers (tasks 4.2)"; the sustained program belongs to the 8-SP sibling ticket `docs/planning/TICKETS.md:2911` (Dev 3), NEVER absorbed by this 5-SP ticket.
**Task-text authority (tasks.md 4.2):** "The scaled dev-environment baseline … is recorded in the launch report as the automated evidence; the production-scale runs … are executed against the production-candidate environment during launch week and recorded as LAUNCH-DRILL evidence rows, OR explicitly waived with sign-off (D3)."

## Why the waiver route is the disposition prepared by this task

1. **No production-candidate environment exists at plan-execution time.** The drill was executed against THIS environment — the local dev stack (PostgreSQL `127.0.0.1:5432`, Redis `127.0.0.1:6379`, Next dev server on `127.0.0.1:3210`, WS sidecar on `127.0.0.1:3211`). Dev-scale numbers prove the procedure; they NEVER claim production scale.
2. **The task text binds production-scale execution to launch week**, against the production-candidate environment — an operator-side condition (D7-class), not repo work.
3. **Single-IP load is masked by the platform's own ingress defenses** (recorded as-found in `outcome/load-drill/load-test-2026-10-09T13-41-41Z.json`): the gateway-wide per-IP limiter (`graphqlRateLimiter`, 100 requests / 60 s per client IP, `app/api/graphql/rate-limit.ts:21`) rejected 52,141 / 52,388 drill requests with 429, and the WS handshake bucket (burst 5, refill 1 per 2000 ms per IP, `backend/ws/notification-ws-server-constants.ts:8-17`) paced the soak's opens. A production drill MUST drive from distributed source IPs — otherwise the ingress defenses mask the serving-path percentiles (2.14-outcome §G drill implication, mirrored here).

## Waiver rows (each: owner + signatory + evidence)

### W-1 — Row 6.1 production limb: 100+ concurrent users, p95 < 500 ms, production scale

- **Waived:** the 100+ concurrent-user p95 < 500 ms run against the production-candidate environment during launch week.
- **Why:** no production-candidate environment exists at plan time; production-scale execution is a launch-week, operator-side condition (D3).
- **Named owner:** Dev 3 (the load program's ticket owner, `docs/planning/MILESTONE_PLAN.md:364` / `TICKETS.md:2911` — the 8-SP sustained-program sibling, currently IN PROGRESS, see "Sibling state" below).
- **Signatory:** Ahmed (2026-10-10) — collected interactively from the repo owner (Ahmed) via structured sign-off prompt, 2026-10-10
- **Dev-scale evidence filed (procedure proven, scale honestly NOT claimed):**
  - Command: `LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… bun run scripts/load/load-test.ts --url http://127.0.0.1:3210 --users 100 --duration-s 120`
  - Artifact: `outcome/load-drill/load-test-2026-10-09T13-41-41Z.json` (+ console log `load-test-console-2026-10-09T13-41-41Z.log`)
  - As-found: 52,388 requests, rps 435.7, overall p50 219.3 / p95 298.9 / p99 353.0 ms, status {200: 247, 429: 52,141}; **200-only (serving path under single-IP throttled-flood conditions): p50 541.7 / p95 848.4 / p99 1048.0 ms** — the row-6.1 target is **NOT demonstrated at dev scale**, honestly recorded; the overall percentiles measure the 429 fast path.
- **Launch-week alternative (voids this waiver):** re-run the registry command `bun run scripts/load/load-test.ts --url <server-url>` with the real production-candidate URL **from distributed source IPs**, and record the result as a LAUNCH-DRILL evidence row instead of signing this waiver.

### W-2 — D3 matching limb: 100+ teacher matching at production scale

- **Waived:** the matching run at production data volume/population (the sustained-program limb; the checklist row 6.2 as-written — "Test with 100+ available teachers", < 200 ms — is already satisfied ✅ at dev scale).
- **Why / owner / signatory:** same as W-1 (Dev 3; **signed: Ahmed, 2026-10-10**).
- **Dev-scale evidence filed:** `bun run scripts/load/matching-latency.ts` → `outcome/load-drill/matching-latency-2026-10-09T13-39-31Z.json` — 100 seeded teachers (rolled back after the run; pre-existing 31 teacher rows verified untouched), 110 eligible online, real matching browse runs [10.553, 5.666, 3.153] ms — median 5.666 ms, worst 10.553 ms vs the 200 ms row budget (2000 ms generous bound).

### W-3 — Row 6.3 production limb: 100+ WebSocket connections held for 1 hour

- **Waived:** the 1-hour soak at production scale (the sustained-program limb; checklist row 6.3 was flipped ✅ by tasks 3.1/3.2 on the 60 s dev soak).
- **Why / owner / signatory:** same as W-1 (Dev 3; **signed: Ahmed, 2026-10-10**).
- **Dev-scale evidence filed:** sidecar via `WS_PORT=3211 bun run scripts/start-notification-ws.ts` (Redis bus transport, `drill-sidecar-3211.log`); `bun run scripts/load/ws-soak.ts --url ws://127.0.0.1:3211 --sockets 100 --duration-s 60` → `outcome/load-drill/ws-soak-2026-10-09T13-46-27Z.json` — **100/100 sockets completed the paced handshake, held the full 60 s window, 0 unexplained drops, 0 open failures** (within the `WS_MISSED_PONG_LIMIT = 2` envelope). Sidecar shut down after; ports verified closed.

## Sibling state (honest update to the 3.3 audit input)

The 8-SP sibling ticket "Load Testing & Performance Optimization" (`TICKETS.md:2911`) is **IN PROGRESS** as of this task: its plan directory `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/` exists (specs/plan/tasks; tasks.md at 47 `[x]` / 16 `[ ]` at the time of this check, outcomes filed through 8.2). The 3.3 ticket-state audit recorded it "NOT STARTED" because its path scope covered `ai/plans/milestone_4/` and `ai/finished_plans/` only. **4.4/4.5 must re-audit the sibling's landing state at sign-off** — if the sustained program lands before launch, its evidence supersedes this waiver for the limbs it covers.

## Conditions attached to any launch-week drill (per 2.14 §G, mirrored)

1. Distributed source IPs for the HTTP drill (or the per-IP gateway limiter masks the serving percentiles — 100 req/60 s per IP).
2. Paced/spread WS handshakes (per-IP handshake bucket: burst 5, then 1 per 2000 ms).
3. `probe-explain-analyze.ts` / `probe-indexes.ts` / `matching-latency.ts` need only the DB URL (read-only / rolled-back; safe on any environment snapshot).
4. `load-test.ts` requires `LOAD_TEST_EMAIL`/`LOAD_TEST_PASSWORD` env credentials (never argv, never printed, never in artifacts).
