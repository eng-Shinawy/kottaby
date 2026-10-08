# Research: PRODUCTION_READINESS.md §3 — Real-Time Reliability (rows 3.1.1–3.4.5)
Date: 2026-10-08

## Area

Section 3's planning vocabulary predates two shipped architectural rulings, so several rows must be re-mapped before they can be verified. First, there is **no presence WebSocket**: the only realtime surface is the notification-push sidecar (`backend/ws/**`, standalone Bun process, entry `scripts/start-notification-ws.ts`), which is **push-only** — client application frames are ignored (`backend/ws/notification-ws-server.ts:34`, `backend/ws/AGENTS.md:29`) and it carries zero presence state. Presence is implemented as **heartbeat-as-API-call** (`docs/teachers/teacher-availability.md:344`): an argless `recordMyActivity` GraphQL mutation + a fire-and-forget per-request activity stamp in the GraphQL context factory, both writing `users.last_active_at`, consumed by a DB-side 15-minute inactivity sweep (PR #308: `TeacherInactivityService.sweepInactiveTeachers` + guarded batch repo primitive + cron route). Second, there is **no session-scoped realtime channel at all** — a "session" is a DB row; the sidecar pushes notifications only — so rows 3.2.1/3.2.2 (session survival across WS disconnect) describe a lane that does not exist. In-session locking (PR #309) is real and thorough: `acquireInSessionLock`/`releaseInSessionLock`/`setAvailabilityIntent` writer trio with a persisted `was_online_before_lock` marker, a matching-directory NOT-EXISTS filter, sweep lock-priority exemption, and 4 journey-tested terminal exits — but the **booking-time availability gate was deferred** (ledger D4): a student CAN still book an in-session teacher today. Notification delivery (3.4.x) is the strongest area: 10 types (checklist says 7), engine with fail-open emit-idempotency, post-commit realtime publish (in-process or Redis pub/sub fanout), DB persistence with unread-count index, inbox queries, and 4-tier + journey test locks.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 3.1.1 | "WS heartbeat updates `users.last_active_at`" | NOT via WS. `recordMyActivity` mutation `backend/graphql/mutation/user.mutation.ts:170` → `AuthService.recordMyActivity` `backend/services/auth/auth.service.ts:516`; per-request stamp `backend/graphql/gqlContextFactory.ts:297` (`UserRepository.updateLastActiveAtIfStale`); client hook `frontend/hooks/presence/use-teacher-presence-heartbeat.ts:49` (5-min cadence), mounted `frontend/views/dashboard/layout/DashboardLayout.tsx:126` | VERIFIED (vocab remap) |
| 3.1.2 | 15-min inactivity → teacher unavailable | `TeacherInactivityService.sweepInactiveTeachers` `backend/services/teachers/teacher-inactivity.service.ts:72-86`; `TeacherRepository.sweepInactiveOnlineOnce` `backend/db/repo/teachers/teacher.repository.ts:774` (predicates `:783-785`); env `TEACHER_INACTIVITY_TIMEOUT_MINUTES=15` `.env.example:101`; cron `app/api/cron/sweep-inactive-teachers/route.ts:36` | VERIFIED |
| 3.1.3 | In-session teacher NOT auto-offlined | Sweep NOT-EXISTS started-session exemption `backend/db/repo/teachers/teacher.repository.ts:783-785` (recheck `:807-809`); journey lock-priority step `test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts:32-33` | VERIFIED |
| 3.1.4 | Teacher toggles back Available after activity | `TeacherRepository.setAvailabilityIntent` `backend/db/repo/teachers/teacher.repository.ts:685` (Available-direction guard `:700`); same-transaction activity stamp `backend/services/teachers/teacher-availability.service.ts:303` | VERIFIED |
| 3.2.1 | Graceful WS disconnect during session | No session-scoped WS lane exists; sidecar is notification-push-only (`backend/ws/notification-ws-server.ts:34`). No code, no test. | MISSING |
| 3.2.2 | Session state preserved on disconnect | Trivially true (sessions are DB rows; `backend/ws` holds no session state) but ZERO verification artifact exists | MISSING |
| 3.2.3 | Reconnection restores realtime comm | Server: reconnect-flicker test `backend/ws/notification-ws-server.test.ts:704`, missed-pong reap `:682`. Client: backoff+reconnect `frontend/hooks/notifications/use-notification-realtime.socket.ts:182,208-210`; delays `use-notification-realtime.helpers.ts:76-78`. Client leg UNTESTED | PARTIAL |
| 3.2.4 | Missed notifications delivered on reconnect | No server queue. Client catch-up refetch on RE-connect `frontend/hooks/notifications/use-notification-realtime.socket.ts:74-100` (fires at `:266`); polling floor 120s `frontend/views/notifications/hooks/useNotificationsFeedState.ts:24`. Catch-up path UNTESTED | PARTIAL |
| 3.3.1 | In-session teacher hidden from directory | Matching filter chain `backend/db/repo/teachers/teacher.repository.matching.helpers.ts:129-142`: `isOnline=true` `:131`, `isApproved=true` `:132`, NOT-EXISTS started `:136` | VERIFIED |
| 3.3.2 | `is_online=false` during started session | `acquireInSessionLock` `backend/db/repo/teachers/teacher.repository.ts:460-465` (marker COALESCE + `isOnline:false`), composed in `startSession` `backend/services/classes/session-lifecycle.service.ts:312` | VERIFIED |
| 3.3.3 | Booking in-session teacher rejected | NOT IMPLEMENTED. `bookSessionInTx` asserts certification ONLY `backend/services/classes/session-lifecycle.booking.ts:245-261`; deferred ledger D4 `ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md:23` ("a student can book an offline/in-session teacher today"); journey J4 exploits it deliberately | MISSING |
| 3.3.4 | Return to Available after session ends | `releaseInSessionLock` `backend/db/repo/teachers/teacher.repository.ts:558` (restore `:578`), wrapper `backend/services/classes/session-lifecycle.transitions.ts:265-266`, composed at `session-lifecycle.service.ts:433,521,693` + governance cancel `session-admin-governance.helpers.ts:387` | VERIFIED |
| 3.4.1 | Session-request notification realtime | `notifyTeacherOfSessionRequest` `backend/services/classes/session-request-notification.service.ts:219` (emit `:200/:210`); callers `session-lifecycle.service.ts:228`, `evaluation-booking.service.ts:130`; publish-after-commit `backend/services/notifications/notification-engine.publish.ts:22+`. "≤1s" latency: no probe | VERIFIED |
| 3.4.2 | Completion notification → parents | `NotificationType.SessionCompletion` `backend/services/classes/session-report-notification.service.ts:117`; parent leg INV-P1 gate `:77-79` (LEFT-JOIN proof); student+parent locale inversion | VERIFIED |
| 3.4.3 | Notifications persisted for offline users | Engine persists first: `NotificationRepository.createReturning` `backend/services/notifications/notification-engine.service.ts:60-77`; table `backend/db/schema/notifications/notifications.ts:30-49` (`(user_id,is_read)` index `:47`) | VERIFIED |
| 3.4.4 | Unread retrieval (on login/feed) | Query fields `myNotifications` `backend/graphql/query/notifications/notification.query.ts:53`, `myUnreadNotificationCount` `:94`; engine `notification-engine.service.ts:124,139`; mounted feed polls 120s | VERIFIED |
| 3.4.5 | "All 7 types exercised" | TEN types in schema `backend/db/schema/enums.ts:101-112` (7→10: + dispute opened/resolved, applicant_outcome). All 10 have production emitters (see Coverage). Checklist count stale | PARTIAL (re-baseline 7→10) |

**Counts: VERIFIED 11 · PARTIAL 3 (3.2.3, 3.2.4, 3.4.5) · MISSING 3 (3.2.1, 3.2.2, 3.3.3) · DEFERRED 0**

## Existing Coverage

| Artifact | What it already asserts |
|---|---|
| `backend/db/test/repo/teachers/teacher.repository.test.ts:1950` | `sweepInactiveOnlineOnce` matrix: stale swept, NULL-activity swept, fresh skipped, offline skipped, **started-session skipped (3.1.3)**, exact-cutoff NOT swept, replay=0, honest count |
| `backend/services/teachers/teacher-inactivity.service.test.ts` | Cutoff arithmetic from env getter, one-transaction composition, zero-count pass-through, `outerTx` SAVEPOINT seam |
| `test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` | End-to-end sweep vs real DB: backdated `users.last_active_at` rows (never fake timers), Offline→Available toggle, lock priority (3.1.3), release→re-sweep self-heal |
| `app/api/cron/sweep-inactive-teachers/test/sweep-inactive-teachers-route.test.ts` | Cron envelope: GET-only, bearer secret, kill switch, masked payloads, `{offlined}` shape |
| `backend/db/test/repo/teachers/teacher.repository.test.ts:674` / `:894` / `:1408` | `acquireInSessionLock` capture-and-lock; marker-gated last-exit release (incl. `active_sessions_remain` defer); direction-guarded toggle (Available blocked while started — 3.1.4/3.3.4) |
| `test/workflows/sessions/in-session-lock-release.journey.test.ts` | J1 lock→denied toggle→restore; J2 never-resurrect (both variants); J3 admin-governance cancel release + `no_lock_held`; J4 deferred restore (two students book the same online teacher — proves 3.3.3 gap) |
| `test/workflows/teachers/teacher-availability.journey.test.ts` | Toggle journey incl. re-availability after inactivity |
| `backend/graphql/test/user-activity.integration.test.ts` | `recordMyActivity` integration matrix: argless mutation persists a strictly-newer `last_active_at` (`:373`), role gating |
| `backend/graphql/test/context-activity-stamp.test.ts` | Per-request context stamp throttle (staleness window, no backwards moves) |
| `backend/db/test/logic/auth/auth.service.test.ts:807` | `recordMyActivity` one-transaction repo seam (heartbeat describe) |
| `frontend/hooks/presence/use-teacher-presence-heartbeat.test.ts` | Client hook: teacher-only gating, 5-min cadence fire, visibility stop, failure silence |
| `backend/db/test/repo/teachers/teacher.repository.test.ts:2620` / `:3192` | `listMatchingCandidates` eligibility chain (isOnline+isApproved+governance+NOT-EXISTS started — 3.3.1) + browse filters |
| `test/workflows/teachers/on-demand-matching.journey.test.ts` | Matching flow journey (directory read-side) |
| `backend/ws/notification-ws-server.test.ts` (25 tests) | Tier 1 push delivery + routing isolation `:500,517,543`; Tier 2 malformed-bus/egress allowlist/shutdown `:566+`; Tier 3 missed-pong reap `:682` + **reconnect flicker ×6 → one live socket receives next push `:704` (3.2.3 server leg)**; Tier 4 auth/origin/throttle/caps/inbound-ignore `:740+` |
| `backend/services/notifications/notification-engine.emit.test.ts` | Emit validation fail-closed `:256`; idempotency claim/duplicate/fail-open `:501`; **outer-rollback ⇒ no ghost push `:780`**; post-commit publisher `:832`; own-commit path `:941`; retraction |
| `backend/services/notifications/notification-engine.inbox.test.ts` | List filter×pagination `:276`; bounds/empty `:367`; unread-count badge `:478`; markRead/markAllRead `:496,528`; concurrent mark storm `:575` |
| `test/workflows/notifications/j1-targeted-single-recipient.test.ts` | Teacher session-request delivery: single recipient, cross-actor visibility both ways, spied fanout transport (no WS frames) |
| `test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts` | Batch fan-out, **offline parent B still sees persisted `is_read=false` row (3.4.3)**, unread=1 → markAllRead → badge 0 (3.4.4) |
| `test/workflows/notifications/admin-broadcast.journey.test.ts` + `broadcast-retraction.journey.test.ts` | Broadcast lifecycle + retraction journeys |
| `backend/services/classes/session-report-notification.test.ts` | Completion waves: `session_completion` typed rows, student+parent emission, parent-leg fail-closed (INV-P1); `:868` pins no stray `session_completion` in report path |
| `backend/services/classes/session-request-notification.service.test.ts:524` | Completion/intake wave envelopes + recipient-locale inversion |
| `backend/services/classes/session-dispute-notification.service.test.ts` | Dispute opened/resolved notification waves |
| Per-type emitter service tests (co-located `*.test.ts`) | `parent-link-request.service.ts`, `admin-broadcast.service.ts`, `subscription-activation.service.ts` (payment_confirmation), `evaluation-rubric.helpers.ts` + `cold-start-certification.service.ts` (evaluation_result), `applicant-lifecycle.helpers.ts` (applicant_outcome) all carry co-located suites |
| `backend/services/notifications/realtime/*.test.ts` + `emit-idempotency.test.ts` + `redis-claim-cache.test.ts` | Transport factory ladder, Redis pub/sub + in-process transports, fanout degradation, fail-open claims |

## Gaps

1. **3.3.3 — booking-time availability gate (the one true functional gap).** `bookSessionInTx` takes `lockForCertificationCheck` and rejects only `TEACHER_NOT_FOUND`/`TEACHER_NOT_CERTIFIED` (`session-lifecycle.booking.ts:245-261`). No `is_online` / in-session predicate anywhere in the booking path (grep of the file for `is_online|isOnline` returns nothing). The matching browse hides in-session teachers, but a direct request against a known teacher id succeeds. Ledger D4 resolved this as a *pointer* to the Dev 3 matching ticket (`TICKETS.md:1457`), and the matching browse shipped WITHOUT adding the booking re-assertion — the pointer's target work never landed. Launch needs either (a) a product ruling that directory hiding is the MVP gate (then reword the checklist row), or (b) a `ConflictError` gate in `bookSessionInTx` (e.g. reuse the started-session NOT-EXISTS predicate) + service tests + journey update (J4 currently *depends* on the gap).
2. **3.2.1/3.2.2 — no artifact, and no lane.** There is no session-scoped WebSocket: the sidecar pushes notifications only (`notification-ws-server.ts:34`; `backend/ws/AGENTS.md` "push-only"). Session state lives in Postgres, so a socket disconnect cannot affect it — but zero code or test names this guarantee. The launch plan should either reword both rows to the real architecture ("notification lane survives disconnect; session state is DB-persistent") and verify via the reconnect journey below, or mark them N/A-by-architecture with sign-off.
3. **3.2.3/3.2.4 — client reconnect + catch-up is implemented but UNTESTED.** No test file exists for `use-notification-realtime`/`.socket`/`.helpers` (repo-wide grep for a test importing the hook returns nothing). The catch-up refetch (`socket.ts:74-100`), backoff curve (`helpers.ts:76-78`), and 4401/4009 abort semantics (`use-notification-realtime.ts:19-25`) have no verification artifact. Server-side flicker is covered (`notification-ws-server.test.ts:704`); the client leg is not.
4. **3.4.1 — latency SLA unprobed.** "Within 1 second" has no timing test anywhere (grep for latency/1s probes in notification tests: none). Realtime path is emit→commit→publish→fanout→WS frame; a journey probe or E2E timing assertion is needed to sign the row.
5. **3.4.5 — type inventory drift.** Checklist says 7 types; schema has 10 (`enums.ts:101-112`). All 10 emit in production code, and co-located suites cover each emitting service, but no single inventory test pins "every enum member has ≥1 emitter + ≥1 exercising test". One static test (like the enum-parity patterns used elsewhere) would close it.
6. **Operational wiring (verification, not code):** the sweep has no internal scheduler — the cron route is externally triggered (`route.ts:28-30`, ops arms `CRON_EXECUTION_MODE=external` + `CRON_EXTERNAL_ENABLED=true`, fires ≤5-min cadence). Launch sign-off must verify the production scheduler actually fires it. Likewise `NOTIFICATION_FANOUT_TRANSPORT` must resolve to the Redis bus in production (`REDIS_URL` present — `.env.example:90`) or multi-process fanout silently degrades to in-process (single-process only).

## Harness Recommendations

- **Do NOT invent new code for 3.1.x/3.3.x/3.4.x** — the verification plan should ride the existing 4-tier ladder: repo (`backend/db/test/repo/`) → service (`backend/services/**` co-located) → GraphQL integration (`backend/graphql/test/`, dev-server suites) → journey (`test/workflows/<domain>/`). Every VERIFIED row above already has artifacts at all applicable tiers; the plan's job is to EXECUTE them against the production schema and record results, not to re-verify by reading.
- **3.1.1 wording fix:** re-baseline the row to "heartbeat (API-call model) updates `users.last_active_at`" and cite `recordMyActivity` + context stamp; a WS-heartbeat probe would fail by design.
- **3.3.3 decision task:** a launch-plan task should first ask product (accept directory-only gating vs. add booking gate). If the gate is added: extend `backend/services/classes/session-lifecycle.booking.ts` with the started-session NOT-EXISTS rejection (reuse `SessionStatus.Started` predicate idiom), add `session-lifecycle.booking.test.ts` denial tier, and UPDATE `test/workflows/sessions/in-session-lock-release.journey.test.ts` J4 (which currently relies on double-booking succeeding).
- **3.2.x reconnection journey (new, closes gaps 2-3):** add `test/workflows/notifications/reconnect-catchup.journey.test.ts` — boot the real sidecar via `startNotificationWsServer` on `port: 0` with an in-process transport (the `notification-ws-server.test.ts:499` tier pattern), connect a real Bun `WebSocket` client, kill the socket, emit a notification while disconnected, reconnect, and assert (a) the client's catch-up refetch surfaces the missed row from `myNotifications` (3.2.4), and (b) a post-reconnect push arrives on the new socket (3.2.3). Assert session-row status is byte-unchanged across the disconnect window to give 3.2.2 a concrete artifact. For the client hook's backoff/abort logic, add `frontend/hooks/notifications/use-notification-realtime.helpers.test.ts` (pure-function backoff curve — no DOM needed) plus a socket-session test with stubbed timers.
- **3.4.1 latency probe:** extend the reconnect journey or a `test/integration/` smoke with a wall-clock assertion around emit→frame (sub-second on loopback); record the number in the checklist sign-off rather than a hard CI threshold (CI jitter).
- **3.4.5 inventory pin:** one static test beside `backend/enum/notifications/notification-type.enum.test.ts` (or extend it) asserting every `NotificationType` member appears in ≥1 non-test emitter file and ≥1 test file — the enum-parity pattern already used elsewhere in the repo.
- **Ops/launch-day script:** a small `scripts/` probe (pattern: existing `scripts/ops/sweep-expired-link-requests.ts`) that (1) GETs `/api/cron/sweep-inactive-teachers` with the production bearer and asserts `{offlined}` envelope, (2) verifies `NOTIFICATION_FANOUT_TRANSPORT` resolves to redis when `REDIS_URL` is set (import `resolveFanoutTransport` seam), (3) boots the sidecar healthcheck. Register under `scripts/health/` conventions if a launch checklist runner exists.
- **DB probes for sign-off rows:** direct SQL checks belong in `backend/db/test/` style probes or a one-off psql list: `teacher.was_online_before_lock` NULL for all teachers (no leaked locks — complements 3.3.4), and a stale-`last_active_at` online teacher count before/after a sweep pass (3.1.2 live proof).

## Evidence Appendix

```ts
// backend/db/repo/teachers/teacher.repository.ts:460-465 — the in-session lock (3.3.2)
export async function acquireInSessionLock(id: number, tx: DBTransaction): Promise<TeacherSelectType | null> {
  // ...set({ wasOnlineBeforeLock: sql`COALESCE(${teacher.wasOnlineBeforeLock}, ${teacher.isOnline})`,
  //        isOnline: false, ...

// backend/db/repo/teachers/teacher.repository.ts:783-785 — sweep victims (3.1.2 + 3.1.3 exemption)
// eq(teacher.isOnline, true),
// sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${teacher.id} AND (${users.lastActiveAt} IS NULL OR ${users.lastActiveAt} < ${cutoff}))`,
// sql`NOT EXISTS (SELECT 1 FROM ${session} WHERE ${session.teacherId} = ${teacher.id} AND ${session.status} = ${SessionStatus.Started})`

// backend/db/repo/teachers/teacher.repository.matching.helpers.ts:131-136 — directory hiding (3.3.1)
//   eq(teacher.isOnline, true), eq(teacher.isApproved, true),
//   sql`not exists (select 1 from ${session} where ${session.teacherId} = ${teacher.id} and ${session.status} = ${SessionStatus.Started})`,

// backend/services/classes/session-lifecycle.booking.ts:254-260 — certification-ONLY gate (3.3.3 gap)
//   if (lockedTeacher.isApproved !== true) { ... throw new ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified); }
//   // no is_online / in-session predicate anywhere in bookSessionInTx

// backend/graphql/gqlContextFactory.ts:297 — per-request activity stamp (3.1.1)
//   void UserRepository.updateLastActiveAtIfStale(activityUserId, staleBefore, activityNow).catch(error => {

// backend/ws/notification-ws-server.ts:34 — push-only protocol (3.2.1/3.2.2 have no session lane)
// * Client application frames are ignored (push-only protocol, REQ-034).

// frontend/hooks/notifications/use-notification-realtime.socket.ts:74-77 — catch-up (3.2.4)
// /** REQ-025 catch-up: refetch inbox page 1 + unread count (self-heal). */
//   // (a) the explicit unfiltered page-1 + count refetch ... network-only

// backend/services/notifications/notification-engine.service.ts:60-62 — persist-then-publish (3.4.3)
//   if (tx !== undefined) { const row = await withTransaction(tx, txArg => NotificationRepository.createReturning(insert, txArg)); ...

// backend/db/schema/enums.ts:101-112 — TEN notification types (3.4.5 re-baseline)
//   "session_request", "session_completion", "session_cancellation", "parent_link_request",
//   "system_broadcast", "payment_confirmation", "evaluation_result",
//   "session_dispute_opened", "session_dispute_resolved", "applicant_outcome",

// app/api/cron/sweep-inactive-teachers/route.ts:36-38 — externally-triggered sweep (3.1.2 ops dependency)
//   export const GET = createCronSweepEndpoint({ run: () => TeacherInactivityService.sweepInactiveTeachers(), ...

// backend/ws/notification-ws-server.test.ts:704 — server-side reconnect proof (3.2.3)
//   test("reconnect flicker ×6 ends with exactly one live connection that receives the next push", ...)
```

**Vocabulary corrections for the checklist (planning → reality):** "WebSocket heartbeat" → `recordMyActivity` API-call heartbeat + per-request context stamp; "notification queue" → DB persistence + client catch-up refetch + 120s polling floor; "7 notification types" → 10; "session disconnection recovery" → notification-lane reconnect only (no session-scoped socket exists).
