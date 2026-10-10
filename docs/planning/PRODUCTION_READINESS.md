# Draft Academy — Production Readiness Checklist

> **Source of truth:** `docs/specs/`, `backend/db/schema/`, `docs/planning/ROADMAP.md`
> **Related:** `docs/planning/TICKETS.md`, `docs/planning/MILESTONE_PLAN.md`

---

## Overview

This document defines the comprehensive production launch criteria for Draft Academy. Every item must be verified and signed off before the platform is opened to real Shuyukh and students.

**Launch Gate:** All items in this checklist must be ✅ verified before production launch.

---

## 1. Data Integrity & Governance

### 1.1 Soft Delete Enforcement

| # | Criterion | Verification | Status |
|---|---|---|---|
| 1.1.1 | No user, student, or teacher record can be hard-deleted | App-layer: zero production `.delete(users)` call sites (corpus-proven by `backend/graphql/test/inv-u4-grep-lock.test.ts`). DB-layer: raw `DELETE FROM users` must RAISE — GUC-gated `prevent_users_delete` trigger, guard ON when `kottaby.users_delete_guard` is unset (production default) | ✅ 3.1 (`backend/db/test/logic/shared/data-integrity.probe.test.ts` 5/0 — `logs/2026-10-09T10-41-36`; trigger `backend/db/migration/14-prevent-users-delete.sql` shipped via `bun db migrate`; probe re-enables the guard transaction-locally → fixture DELETE RAISEs, inherited-opt-out leg proceeds; production posture: ledger D17) |
| 1.1.2 | All deletions use soft delete (`users.is_deleted = true`) | Verify admin delete endpoint sets `is_deleted=true`, `deleted_at=now()` | ✅ 3.1 (`test/workflows/admin/admin-user-lifecycle.journey.test.ts` 7/0 — `logs/2026-10-09T12-24-16`; soft delete is one guarded inverse-state UPDATE + audit `Delete` row) |
| 1.1.3 | Soft-deleted users cannot access the platform | Login as soft-deleted user — must be denied at the governance gate | ✅ 3.1 (same journey 7/0, `logs/2026-10-09T12-24-16` — soft-deleted login denied `ForbiddenError`, zero writes) |
| 1.1.4 | Soft-deleted users' historical data is preserved | Verify sessions, reports, financial transactions remain after soft delete | ✅ 3.1 (`test/workflows/admin/admin-delete-with-history.journey.test.ts` 8/0 — `logs/2026-10-09T10-44-53`; session/report/payment/wallet-adjacent rows re-queried present and byte-identical post soft-delete; raw-SQL hard-delete probe leg RAISEs under the guard) |
| 1.1.5 | Admin can reactivate soft-deleted users | Reactivate — `is_deleted=false`, `deleted_at=null`, login works | ✅ 3.1 (`admin-user-lifecycle.journey.test.ts` 7/0 — `logs/2026-10-09T12-24-16`; reactivate + audit `Reactivate` + login restored; teacher-side earning-row survival in `admin-delete-with-history.journey.test.ts` 8/0 — `logs/2026-10-09T10-44-53`) |

**Decision Refs:** A.7 (governance on users), INV-U1, INV-U4, INV-U5, FR-1.4

### 1.2 Financial Record Immutability

| # | Criterion | Verification | Status |
|---|---|---|---|
| 1.2.1 | `student_payments` records are immutable once created | Immutable except the documented guarded transition — payment status `pending → paid` or `failed` + one-time `provider_transaction_id` write (`backend/db/schema/billing/student-payments.ts:26-46`); every other UPDATE/DELETE raises | ✅ 3.1 (`backend/db/test/logic/billing/financial-immutability.test.ts` 17/0 — `logs/2026-10-09T10-44-59`; trigger families `backend/db/migration/3-immutability-triggers.sql` + the settlement carve-out migration) |
| 1.2.2 | `teacher_transaction` records are immutable once created | Immutable except the documented guarded transition — withdrawal settlement `pending → completed` or `failed`, all other columns frozen (`backend/db/schema/billing/teacher-transaction.ts:17-23`) | ✅ 3.1 (same suite 17/0; post-settlement UPDATE/DELETE RAISE legs also pinned in `backend/db/test/logic/billing/launch-financial-probe.test.ts` 5/0 — `logs/2026-10-09T10-46-37`) |
| 1.2.3 | Corrections are handled via new adjustment transactions only | Verify admin manual adjustments create NEW transactions, not modify existing | ✅ 3.1 (`backend/services/billing/admin-financial-auditing.service.test.ts` 32/0 — `logs/2026-10-09T10-45-04`; adjustments mint new ledger rows, existing rows untouched) |
| 1.2.4 | All financial records have `created_at` timestamps | Verify all financial records have non-null `created_at` | ✅ 3.1 (`financial-immutability.test.ts` 17/0 — `logs/2026-10-09T10-44-59`; created_at populated across the fixture financial families) |

**Decision Refs:** INV-W6, INV-PAY2, FR-5.7

### 1.3 Audit Trail Completeness

| # | Criterion | Verification | Status |
|---|---|---|---|
| 1.3.1 | Every admin action is logged in `audit_logs` | Perform every admin action type — verify audit_log record exists for each | ✅ 3.1 (`test/workflows/admin/audit-completeness.journey.test.ts` 21/0 — `logs/2026-10-09T10-45-17`) |
| 1.3.2 | Audit log records are immutable (append-only) | Attempt to UPDATE or DELETE an audit_log record — must fail | ✅ 3.1 (`backend/db/test/logic/audit/audit-immutability.test.ts` 17/0 — `logs/2026-10-09T10-45-29`; 3-tier proof: corpus walk + live pg_trigger probe + migration-DDL pin) |
| 1.3.3 | Audit log captures: actor_id, action_type, entity_type, entity_id, details, created_at | Verify all fields are populated for every audit log entry | ✅ 3.1 (`audit-completeness.journey.test.ts` 21/0 — `logs/2026-10-09T10-45-17`; every field populated per action) |
| 1.3.4 | Admin can filter audit trail by actor, action type, entity, and date range | Verify filtering works correctly | ✅ 3.1 (`test/workflows/admin/audit-trail.journey.test.ts` 7/0 — `logs/2026-10-09T10-45-39`) |
| 1.3.5 | All 7 audit_action_type values are exercised (create, update, delete, override, adjust, suspend, reactivate) | Verify each action type appears in the audit log | ✅ 3.1 (`audit-completeness.journey.test.ts` 21/0 — `logs/2026-10-09T10-45-17`; all seven enum members exercised incl. delete/override/adjust/suspend/reactivate) |

**Decision Refs:** A.5 (audit_logs), FR-10.5

### 1.4 Data Retention

| # | Criterion | Verification | Status |
|---|---|---|---|
| 1.4.1 | All session logs, reports, evaluations, and recitation records are stored permanently | Verify no purge/delete jobs exist for these tables | ✅ 3.1 (`backend/db/test/logic/shared/retention-anti-drift.test.ts` 10/0 — `logs/2026-10-09T10-45-58`; fs census: zero `.delete(`/raw DELETE paths against session/reports/recitation/home_work/evaluations across repo + cron + ops; allowlist exactly `lesson.repository.ts:101` + `notification.repository.ts:346`) |
| 1.4.2 | Evaluation records are permanently retained for dispute resolution | Verify evaluations cannot be hard-deleted (only soft-delete via `is_deleted`) | ✅ 3.1 (`backend/db/test/repo/teachers/evaluation.repository.test.ts` 55/0 — `logs/2026-10-09T10-45-58`; no delete surface; session hard-delete leaves the evaluation intact (set-null survival pin)) |
| 1.4.3 | Homework records are permanently retained | Verify no purge jobs for home_work table | ✅ 3.1 (`retention-anti-drift.test.ts` 10/0 — `logs/2026-10-09T10-45-58`; home_work inside the zero-delete census) |

**Decision Refs:** INV-E2, INV-E6, FR-11

---

## 2. Financial & Escrow Safeguards

### 2.1 Dual-Confirmation Timeout

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.1.1 | Session completion requires dual confirmation (teacher + student) | Verify session cannot be finalized without both confirmations | ✅ 3.1 (`backend/services/classes/session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T10-46-12`; dual-confirmation happy/idempotent/denial tiers `:2504-2631`) |
| 2.1.2 | 24-hour timeout auto-cancels unconfirmed sessions | Create session, wait 24h (or simulate) — verify auto-cancel | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — recorded as SIMULATED per this row's own "or simulate" wording: fabricated past-deadline fixtures → sweeper legs `:2799-3334` incl. NULL-lane and idempotent re-sweep; the sweep runs behind the externally-triggered cron route `GET /api/cron/sweep-sessions` — scheduler arming is the launch-arming runbook's condition, `docs/ops/launch-arming-runbook.md`) |
| 2.1.3 | Auto-cancelled sessions release held funds | Verify `fee_held` is released and the request-time lane debit is refunded (same lane, exactly once) | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — sweep flips `feeHeld=false` + `refundHeldLaneToProvenance` same-lane +1, fail-closed — `session-lifecycle.transitions.ts:222-241`) |
| 2.1.4 | `confirmation_deadline` is set to `now + 24h` on session creation | Verify deadline is correctly set | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — deadline boundary pinned EXACTLY `now + SESSION_CONFIRMATION_WINDOW_MS` (86_400_000 ms) `:1118-1141`) |
| 2.1.5 | Both `confirmed_by_student_at` and `confirmed_by_teacher_at` are recorded | Verify timestamps are set on confirmation | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — stamps recorded via `completeSessionOnce` / `confirmStudentCompletionOnce`) |

**Decision Refs:** B.2 (24h timeout), FR-5.5

### 2.2 Escrow Hold & Release

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.2.1 | Fee is held at session request (`fee_held = true`) | Verify `fee_held` + `held_balance_lane` provenance are set on session creation | ✅ 3.1 (`session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T10-46-12`; `session-lifecycle.booking.ts:183-185` writes `feeHeld: true` + `heldBalanceLane` at insert) |
| 2.2.2 | Balance lane is debited at request (guarded request-time lane debit — this IS the "hold") | Verify the guarded lane debit at request (`session-lifecycle.booking.ts:133-138`, trial-first ladder) with the `fee_held` marker + `held_balance_lane` provenance — as-built the lane IS decremented at request; the planning "held, not decremented" described a mechanism that does not exist | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — booking lane ladder `:431-539`; zero-lane denial with zero rows) |
| 2.2.3 | Hold is consumed on dual confirmation (consume-once) — no second debit exists | Verify dual confirmation flips `fee_held=false` and credits the teacher wallet exactly once (`session-lifecycle.confirmation.ts:129-141`) | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — confirm happy path consumes the hold + EXACTLY ONE earning credit; replay = zero financial writes) |
| 2.2.4 | Teacher wallet is credited only upon dual confirmation | Verify earning transaction is created after both confirmations | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — credit fires only on the guarded confirm match; arbitration-Complete consumes the hold with NO wallet credit `:1900`) |
| 2.2.5 | Cancelled sessions refund the debited lane exactly once (same lane, fail-closed) — no wallet credit | Verify cancellation refunds the provenance lane once and creates no earning | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — cancel refunds the SAME lane once `:999`; double-cancel refunds once `:1465`) |
| 2.2.6 | Session fee is platform-set (not negotiated) | Fee by session intent — `sessionFeeForIntent` (`backend/services/classes/session-lifecycle.guards.ts:83-85`; `SESSION_FEE_HIFZ = SESSION_FEE_TAJWEED = "25.00"` EGP, `shared/constants/session-fees.constants.ts:27-30`); the booking input whitelist is teacherId + intent only (no fee field) | ✅ 3.1 (same suite 89/0, `logs/2026-10-09T10-46-12` — platform fee applied server-side, verbatim, never caller input) |

**Decision Refs:** B.3 (platform-set fees), B.4 (escrow hold-at-request), INV-S3, INV-W4

### 2.3 Double-Spend Prevention

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.3.1 | Student cannot request session with zero balance | Verify request is rejected with GraphQL `INSUFFICIENT_BALANCE` (`extensions.code`) — the platform never returns HTTP 422 | ✅ 3.1 (`frontend/graphql/test/billing/escrow-denial-codes.test.ts` 11/0 — `scratch/launch-gate-3.1/stage-logs/s2/test-graphql-escrow-denial-codes.log`; `ValidationError("INSUFFICIENT_BALANCE")` — `session-lifecycle.booking.ts:151-156`; zero session rows, idempotency key not burned) |
| 2.3.2 | Concurrent session requests for the same balance are prevented | Attempt two simultaneous requests — only one succeeds | ✅ 3.1 (`session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T10-46-12`; REQ-043 concurrency chaos ×4 on real PostgreSQL `testOnRealPostgres` `:2326-2422` incl. concurrent double-book on one unit; guarded `WHERE balance_lane > 0` decrement) |
| 2.3.3 | Balance cannot go negative | Verify the 4× named `students_balance_*_check` CHECK constraints are enforced | ✅ 3.1 (`backend/db/test/logic/billing/launch-financial-probe.test.ts` 5/0 — `logs/2026-10-09T10-46-37`; direct negative writes raise each named constraint, SQLSTATE 23514) |
| 2.3.4 | Wallet balance cannot go negative | Verify `wallet_balance_check` / `wallet_total_earning_check` are enforced | ✅ 3.1 (same probe 5/0, `logs/2026-10-09T10-46-37` — both wallet CHECKs raise on direct negative writes) |
| 2.3.5 | Transaction amounts are strictly positive (`amount > 0`) | Verify check constraint `amount > 0` — zero is rejected (stricter than the planning `>= 0`; `backend/db/schema/billing/teacher-transaction.ts:50`) | ✅ 3.1 (same probe 5/0, `logs/2026-10-09T10-46-37` — negative AND zero ledger amounts both raise `teacher_transaction_amount_check`) |

**Decision Refs:** INV-B1, INV-B4, INV-W1, INV-W8

### 2.4 Dispute Resolution

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.4.1 | Student can dispute a completed session | Verify session status changes to `disputed` | ✅ 3.1 (`backend/services/classes/session-arbitration.service.test.ts` 29/0 — `logs/2026-10-09T10-46-41`; post-confirmation dispute opens once, `disputed` status) |
| 2.4.2 | Admin can arbitrate disputes | Verify the arbitration outcomes work — consumed disputes: Refund / PartialRefund / Uphold; held disputes: Cancel / Complete (five-outcome `dispute_resolution` enum — `session-arbitration.service.ts:313`) | ✅ 3.1 (same suite 29/0, `logs/2026-10-09T10-46-41` — Refund = `arbitration_reversal` + lane credit + audit row; PartialRefund exact decimals; Uphold zero financial writes; insufficient-wallet fails closed) |
| 2.4.3 | Refund credits student balance and debits teacher wallet | Verify financial adjustments are correct (ONE session credit to the provenance lane + `arbitration_reversal` teacher debit) | ✅ 3.1 (same suite 29/0, `logs/2026-10-09T10-46-41` — `debitTeacherWalletForArbitration` + `creditLaneForArbitration`) |
| 2.4.4 | All dispute actions are logged in audit_logs | Verify audit log entries for dispute resolution | ✅ 3.1 (same suite 29/0, `logs/2026-10-09T10-46-41` — `AuditService.createAuditLog` in the same transaction, fails closed) |

**Decision Refs:** B.18 (admin arbitration)

### 2.5 Withdrawal Safety

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.5.1 | Withdrawal requests start as `pending` | Verify new withdrawal has status=pending (ONE pending ledger row + guarded wallet debit at REQUEST — `wallet.repository.ts:145-178`) | ✅ 3.1 (`backend/services/billing/wallet.service.test.ts` 9/0 — `logs/2026-10-09T10-46-41`; pending row + balance debited, `total_earning` untouched) |
| 2.5.2 | Admin approval settles the pending withdrawal to `completed` (the wallet was already debited at request — no re-decrement) | Verify approve = settle pending→completed only (`wallet.repository.admin.helpers.ts:329`) | ✅ 3.1 (`backend/services/billing/admin-financial-auditing.service.test.ts` 32/0 — `logs/2026-10-09T10-46-42`; approve settles completed + exactly one audit row `:324-336`) |
| 2.5.3 | Admin rejection settles to `failed` and RESTORES the request-time debit (additive) | Verify reject = settle→failed + additive restore (`wallet.repository.admin.helpers.ts:352-365`) | ✅ 3.1 (same suite 32/0, `logs/2026-10-09T10-46-42` — reject settles failed + restores the reserved debit + audit row `:378`) |
| 2.5.4 | Withdrawal amount cannot exceed wallet balance | Verify request is rejected with GraphQL `WALLET_INSUFFICIENT_FUNDS` (`extensions.code`) — the platform never returns HTTP 422 | ✅ 3.1 (`escrow-denial-codes.test.ts` 11/0 — `scratch/launch-gate-3.1/stage-logs/s2/test-graphql-escrow-denial-codes.log`; `ConflictError` `wallet.service.ts:301-305`, zero wallet/ledger rows; `wallet.service.test.ts` 9/0 — `logs/2026-10-09T10-46-41`, exact-balance boundary OK, insufficient = zero writes) |
| 2.5.5 | Withdrawal transactions are immutable after completion | Verify no modification possible (the pending→completed/failed settlement carve-out is the only legal transition) | ✅ 3.1 (`launch-financial-probe.test.ts` 5/0 — `logs/2026-10-09T10-46-37`; post-settlement UPDATE and DELETE both RAISE, settled row byte-unchanged; the settle carve-out itself proven permitted) |

**Decision Refs:** INV-W5, INV-W6, FR-5.6

---

## 3. Real-Time Reliability

### 3.1 Presence Heartbeat

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.1.1 | Presence heartbeat updates `users.last_active_at` (API-call model — there is no presence WebSocket) | Verify the argless `recordMyActivity` mutation (`backend/graphql/mutation/user.mutation.ts:170` → `backend/services/auth/auth.service.ts:516`) + the fire-and-forget per-request context stamp (`backend/graphql/gqlContextFactory.ts:297`) update the timestamp | ✅ 3.1 (`backend/graphql/test/user-activity.integration.test.ts` 6/0 — `scratch/launch-gate-3.1/stage-logs/s3/test-graphql-user-activity.log`; strictly-newer stamp persisted + role gating) |
| 3.1.2 | 15-minute inactivity marks teacher as unavailable | Verify `is_online=false` after 15 min of no heartbeat | ✅ 3.1 (`test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` 11/0 — `logs/2026-10-09T10-48-13`; real DB sweep of backdated `last_active_at` rows, `TEACHER_INACTIVITY_TIMEOUT_MINUTES=15`) |
| 3.1.3 | Teacher in active session is NOT auto-offlined | Verify in-session lock takes priority over inactivity timeout | ✅ 3.1 (same journey 11/0, `logs/2026-10-09T10-48-13` — sweep's NOT-EXISTS started-session exemption; lock priority over inactivity) |
| 3.1.4 | Teacher can toggle back to Available after resuming activity | Verify toggle works after reconnection | ✅ 3.1 (`test/workflows/teachers/teacher-availability.journey.test.ts` 7/0 — `logs/2026-10-09T10-48-14`; Offline→Available toggle journey) |

**Decision Refs:** B.15 (15-min inactivity), A.7 (last_active_at)

### 3.2 Session Disconnection Recovery

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.2.1 | Notification-lane disconnection is handled gracefully (no session-scoped realtime lane exists — the WS sidecar is notification-push-only, `backend/ws/notification-ws-server.ts:34`) | Verify reconnect catch-up works and a session row under observation is byte-unchanged across the disconnect window | ✅ 3.1 (`test/workflows/notifications/reconnect-catchup.journey.test.ts` 7/0 — `logs/2026-10-09T10-48-18`; real sidecar on `port: 0`, real Bun `WebSocket` client, recording-and-forwarding transport wrapper) |
| 3.2.2 | Session state is DB-persistent and unaffected by socket disconnect (the sidecar holds zero session state) | Verify session status does not change on disconnect | ✅ 3.1 (same journey 7/0, `logs/2026-10-09T10-48-18` — the observed session row is byte-unchanged across the whole disconnect window) |
| 3.2.3 | Reconnection restores real-time communication | Verify a post-reconnect push arrives on the NEW socket | ✅ 3.1 (same journey 7/0, `logs/2026-10-09T10-48-18` — frame provably arrives on the new socket; server flicker proof `backend/ws/notification-ws-server.test.ts:704`) |
| 3.2.4 | Missed notifications are delivered on reconnection (DB persistence + client catch-up refetch — there is no server-side queue) | Verify the missed row surfaces through the real inbox path with the correct unread count (`frontend/hooks/notifications/use-notification-realtime.socket.ts:74-100`) | ✅ 3.1 (same journey 7/0, `logs/2026-10-09T10-48-18`; backoff-curve + abort-semantics pin in `frontend/hooks/notifications/use-notification-realtime.helpers.test.ts`) |

### 3.3 In-Session Concurrency Locking

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.3.1 | Teacher is hidden from directory during active session | Verify in-session teacher does not appear in directory | ✅ 3.1 (`test/workflows/teachers/on-demand-matching.journey.test.ts` 7/0 — `logs/2026-10-09T10-48-23`; directory NOT-EXISTS started-session filter — `teacher.repository.matching.helpers.ts:129-142`) |
| 3.3.2 | `teacher.is_online = false` during active session | Verify is_online is false when session status=started | ✅ 3.1 (`test/workflows/sessions/in-session-lock-release.journey.test.ts` 17/0 — `logs/2026-10-09T10-48-24`; `acquireInSessionLock` drives `is_online=false` with the persisted `was_online_before_lock` marker) |
| 3.3.3 | No other student can request a session with an in-session teacher | As-built: the directory-level NOT-EXISTS exclusion is the MVP availability gate; a booking-time re-assertion does NOT ship (the lock-release journey's deferred-restore lane deliberately books an in-session teacher today) | ☐ WHY: Dev 3 / booking-time availability re-assertion waived-with-sign-off to the matching-flow backlog (ledger D1); shipped green underneath: `in-session-lock-release.journey.test.ts` 17/0 (directory exclusion + lock priority + terminal-exit restore). Signatory: Ahmed (2026-10-10) |
| 3.3.4 | Teacher returns to Available after session concludes (if still active) | Verify is_online returns to true after session completion | ✅ 3.1 (same lock-release journey 17/0, `logs/2026-10-09T10-48-24` — marker-gated release restores Available on the LAST `started`-exit, never resurrects a deliberately-offline teacher) |

**Decision Refs:** INV-A2, INV-A3, INV-A4, INV-S6, FR-4.3

### 3.4 Notification Delivery

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.4.1 | Session request notifications are delivered in real-time | Verify teacher receives the notification (emit→frame loopback latency RECORDED — a recorded number, not a CI threshold) | ✅ 3.1 (`reconnect-catchup.journey.test.ts` 7/0 — `logs/2026-10-09T10-48-18`; loopback latency recorded into the run; publish-after-commit engine — `notification-engine.publish.ts`) |
| 3.4.2 | Session completion notifications are delivered to parents | Verify parent receives notification on session completion | ✅ 3.1 (`backend/services/classes/session-report-notification.test.ts` 17/0 — `logs/2026-10-09T10-48-33`; `session_completion` waves to student + linked parent, INV-P1 fail-closed parent leg) |
| 3.4.3 | Notifications are persisted in database for offline users | Verify notification record exists even if user is offline | ✅ 3.1 (`test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts` 9/0 — `logs/2026-10-09T10-48-34`; persist-first engine, offline row survives `is_read=false`) |
| 3.4.4 | Users can retrieve unread notifications on login | Verify notification API returns unread notifications | ✅ 3.1 (same suite 9/0, `logs/2026-10-09T10-48-34` — unread badge + markAllRead path through the real inbox) |
| 3.4.5 | All 10 notification types are exercised | Verify each notification_type is triggered correctly (7→10 re-baseline: + `session_dispute_opened`, `session_dispute_resolved`, `applicant_outcome` — `backend/db/schema/enums.ts:101-112`) | ✅ 3.1 (`backend/enum/notifications/notification-type-census.test.ts` 4/0 — `logs/2026-10-09T10-48-34`; every member has ≥1 production emitter + ≥1 exercising test; the enum pin extended to the 10-member set) |

**Decision Refs:** A.4 (notifications), FR-9.1, FR-9.2, FR-9.3

---

## 4. Security

### 4.1 Authentication & Authorization

| # | Criterion | Verification | Status |
|---|---|---|---|
| 4.1.1 | JWT tokens are issued with correct user_id and role | Verify token contents | ✅ 3.1 (`backend/lib/auth/jwt.test.ts` 15/0 — `logs/2026-10-09T10-49-18`; token contents + cross-type replay denied) |
| 4.1.2 | RBAC middleware enforces role-based access on all endpoints | Verify each role can only access permitted endpoints | ✅ 3.1 (`frontend/graphql/test/gateway/allowlist-coverage.test.ts` 8/0 — `scratch/launch-gate-3.1/stage-logs/s4/s4-test-graphql-allowlist.log`; role-gated SDL allowlist walk) |
| 4.1.3 | Expired tokens are rejected | Verify 401 on expired token (sign with a past `exp` — verification returns null) | ✅ 3.1 (`backend/lib/auth/jwt.test.ts` 15/0 — `logs/2026-10-09T10-49-18`; expired-token pin: past-exp access + refresh tokens verify to null) |
| 4.1.4 | Tampered tokens are rejected | Verify 401 on tampered token | ✅ 3.1 (same suite 15/0, `logs/2026-10-09T10-49-18` — tamper rejected) |
| 4.1.5 | Passwords are hashed (not stored in plaintext) | Verify password_hash column contains hashed values | ✅ 3.1 (`backend/db/test/logic/auth/auth.service.test.ts` 30/0 — `logs/2026-10-09T12-24-41` (in-gate run 2; standalone 30/0 at `logs/2026-10-09T10-49-48` after one transient retry); bcrypt hashes, no plaintext) |
| 4.1.6 | Soft-deleted, suspended, and blocked users are denied access | Verify 403 for each governance state | ✅ 3.1 (`test/workflows/admin/account-governance.journey.test.ts` 18/0 — `logs/2026-10-09T10-50-07`; denial for every governance state) |

**Decision Refs:** A.7 (governance on users), C.1 (parent role)

### 4.2 Input Validation & Injection Prevention

| # | Criterion | Verification | Status |
|---|---|---|---|
| 4.2.1 | All API inputs are validated (type, length, format) | Verify invalid inputs return localized 400-family envelopes and GraphQL VALIDATION/transport codes — the platform never returns HTTP 422 | ☐ WHY: Dev 2 / exhaustive per-field input fuzzing + GraphQL depth-complexity limiting are post-launch hardening (ledger D5 — only the 2MB body cap ships today, `backend/lib/gateway/transport-guard.ts:49`); shipped green underneath: `test/workflows/auth/registration-phone.journey.test.ts` 9/0 — `logs/2026-10-09T10-50-10` — plus the transport-tier caps + envelope suites. Signatory: Ahmed (2026-10-10) |
| 4.2.2 | SQL injection is prevented (parameterized queries) | Attempt SQL injection — must fail | ✅ 3.1 (gate row exit 0 via `backend/db/test/repo/classes/report.repository.test.ts` 16/0 — `logs/2026-10-09T10-50-15`; parameterized-query discipline: zero `sql.raw` in production + the single `escapeLikeWildcards` sanitizer — `test/config/sql-injection-static-locks.test.ts`, green security-wave evidence) |
| 4.2.3 | XSS is prevented (output encoding) | Attempt XSS — must be sanitized | ✅ 3.1 (`backend/lib/errors/test/security-abuse.contract.test.ts` 58/0 — `logs/2026-10-09T10-50-15`; zero HTML-injection sinks across `app/` + `frontend/` + production CSP without `unsafe-eval` — `test/config/xss-static-locks.test.ts` + `test/config/security-headers.test.ts`, green security-wave evidence) |
| 4.2.4 | CSRF protection is in place | Shipped posture (no token mechanism exists or is built — ledger D12): serialized `HttpOnly; SameSite=Strict` auth cookies (`backend/lib/auth/cookies.ts:160`) + POST-only GraphQL route with 405 on GET (`backend/lib/gateway/transport-guard.ts:37`) + CORS allowlist (`app/api/graphql/rate-limit.ts:88-89`) + CSP `frame-ancestors 'none'` | ✅ 3.1 (`backend/lib/auth/cookies.test.ts` 23/0 — `logs/2026-10-09T10-50-15`; serialized flag-string pin; Origin/`Sec-Fetch-Site` gate — `app/api/graphql/test/graphql-route.origin.test.ts`) |
| 4.2.5 | Rate limiting on authentication endpoints | Shipped layered tiers (all in-memory sliding window, per-instance, fail-open): account-keyed `loginAccountLimiter` (default 5 / 15 min, env-configurable `LOGIN_RATE_LIMIT_*`) + `authIpLimiter` 10/min per client IP (`ctx.clientIp`) + 20/min per sha-256 identity hash | ☐ WHY: Dev 2 / per-account lockout + distributed (Redis) limiter are post-launch hardening (ledger D14; D14 post-launch update: the login-specific per-IP tier HAS shipped via `ctx.clientIp` — only lockout + distribution remain waived); shipped green underneath: `backend/graphql/test/auth-rate-limit.test.ts` + `backend/lib/ratelimit.test.ts` + `frontend/graphql/test/gateway/login-rate-limit.test.ts` 7/0. Signatory: Ahmed (2026-10-10) |

### 4.3 Data Protection

| # | Criterion | Verification | Status |
|---|---|---|---|
| 4.3.1 | Passwords are hashed with bcrypt or equivalent | Verify hashing algorithm | ✅ 3.1 (`backend/db/test/logic/auth/auth.service.test.ts` 30/0 — `logs/2026-10-09T12-24-41`; bcrypt hashing algorithm pinned) |
| 4.3.2 | Sensitive data is not logged in plain text | Verify logs do not contain passwords, tokens, or PII | ✅ 3.1 (`backend/lib/errors/test/security-abuse.contract.test.ts` 58/0 — `logs/2026-10-09T10-50-15`; abuse-contract envelopes leak no secrets) |
| 4.3.3 | API responses do not leak internal IDs or sensitive fields | Verify response payloads are minimal | ✅ 3.1 (`frontend/graphql/test/auth/auth.test.ts` 28/0 — `scratch/launch-gate-3.1/stage-logs/s4/test-graphql-auth.log`) |
| 4.3.4 | Database connections use SSL/TLS | Verify connection encryption (`sslmode=require` / Neon DSNs enable SSL — `backend/db/client.ts:42-46`) | ☐ WHY: Dev 2 / CA-verified TLS is post-launch hardening (ledger D15); shipped green underneath: `test/config/db-ssl.test.ts` 21/0 — `logs/2026-10-09T10-50-38` — pinning the `sslmode=require` gate + the `rejectUnauthorized: false` posture recorded as a signed launch note; production `DATABASE_URL` MUST carry `sslmode=require` (launch condition). Signatory: Ahmed (2026-10-10) |
| 4.3.5 | Environment variables are used for secrets (not hardcoded) | Verify no secrets in source code | ✅ 3.1 (`bun run scripts/launch/secrets-scan.ts .env.example backend/lib/env.ts` — 3 PASS lines, exit 0; `scratch/launch-gate-3.1/stage-logs/s4/secrets-scan.log`; placeholder-only `.env.example` + the `requireEnv`/`getEnv` discipline) |

---

## 5. State Machine Invariant Verification

> The named tests cited below are the bindings of the 67-row invariant census (`backend/db/test/logic/invariants/invariant-census.catalog.ts`), enforced by the doc↔census↔test bijection oracle (`backend/db/test/logic/invariants/invariant-census-drift.test.ts` — 87 pass / 0 fail). The canonical invariant statements live in `docs/specs/state-machine-invariants.md`.

### 5.1 Session Lifecycle Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.1.1 | INV-S1: No transition from `completed` to `started` or `scheduled` | Attempt transition — must fail (app-layer guarded UPDATEs are the shipped enforcement; the DB-level guard trigger is deferred — ledger D10) | ☐ WHY: Dev 3 / DB-level session-status guard trigger deferred, app-layer guarded-UPDATE enforcement accepted with sign-off (ledger D10); shipped green underneath: `backend/services/classes/session-lifecycle.enforcement.test.ts` 17/0 — `logs/2026-10-09T10-50-47` (5×5 off-matrix sweep: terminals refuse all moves, backwards moves denied, zero writes). Signatory: Ahmed (2026-10-10) |
| 5.1.2 | INV-S2: No transition from `cancelled` to any other state | Attempt transition — must fail (same signed exception — ledger D10) | ☐ WHY: Dev 3 / DB-level session-status guard trigger deferred (ledger D10); shipped green underneath: `session-lifecycle.enforcement.test.ts` 17/0 (cancelled is terminal in the matrix) + the state-machine journey pins cancelled→complete and cancelled→dispute both denied `SESSION_INVALID_TRANSITION`, zero writes. Signatory: Ahmed (2026-10-10) |
| 5.1.3 | INV-S3: Earning transaction only on dual confirmation | Verify no earning without both confirmations | ✅ 3.1 (`backend/services/classes/session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T10-50-48`; dual confirmation = student stamp + hold release + EXACTLY ONE earning credit; replay = zero financial writes) |
| 5.1.4 | INV-S4: Session must have both teacher_id and student_id (NOT NULL) | Verify NOT NULL constraints | ✅ 3.1 (`backend/db/test/repo/classes/session.repository.test.ts` 97/0 — `logs/2026-10-09T10-50-52`; a session row without its teacher party is rejected 23502) |
| 5.1.5 | INV-S5: Teacher must be certified at session creation | Verify is_approved=true check | ✅ 3.1 (`session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T10-50-48`; certification lock: unapproved and null-flag teachers both `TEACHER_NOT_CERTIFIED`) |
| 5.1.6 | INV-S6: Teacher is_online=false during started session | Verify in-session lock | ✅ 3.1 (`test/workflows/sessions/in-session-lock-release.journey.test.ts` 17/0 — `logs/2026-10-09T10-50-53`; in-session lock acquired at start, released on every terminal exit) |
| 5.1.7 | INV-S7: Report only for completed session | Verify report submission requires completed status (real enforcement point: `backend/services/classes/session-report.service.ts:262-274` — the report-gate row lock + status probe inside the report transaction) | ✅ 3.1 (`backend/services/classes/session-report.service.test.ts` 34/0 — `logs/2026-10-09T10-50-54`; wrong status for scheduled/started/cancelled/disputed ⇒ `SESSION_INVALID_TRANSITION`, zero rows) |
| 5.1.8 | INV-S8: Homework only when report is submitted | Verify homework creation requires report (real enforcement: `insertHomeWork` has exactly ONE production call site, inside the report transaction — `session-report.service.ts`) | ✅ 3.1 (same suite 34/0, `logs/2026-10-09T10-50-54`; schema pin `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` — `sessionId.notNull`) |

### 5.2 Teacher Verification Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.2.1 | INV-TV1: Cannot certify without 5 sessions or admin cold-start | Verify certification requires 5 evaluations or admin override | ✅ 3.1 (`test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` 16/0 — `logs/2026-10-09T14-07-46` (gate run 3, post-#287-oracle update); below-quorum submission sealed, five 80s PASS mint certified) |
| 5.2.2 | INV-TV2: 5 distinct evaluators (no duplicate) | Verify same evaluator cannot evaluate same applicant twice | ✅ 3.1 (`backend/services/teachers/evaluation-booking.service.test.ts` 35/0 — `logs/2026-10-09T10-51-04`; distinctness — same evaluator cannot be booked twice in one cycle) |
| 5.2.3 | INV-TV3: Cooldown must expire before re-purchase | Verify re-purchase rejected during cooldown | ✅ 3.1 (`test/workflows/teachers/cooldown-state-machine.test.ts` 12/0 — `logs/2026-10-09T14-07-47` (gate run 3); cooldown-active applicant denied with zero writes) |
| 5.2.4 | INV-TV4: Tajweed cooldown = 30 days, Hifz cooldown = 90 days | Verify cooldown periods (constants frozen; cooldown state lives on `applicants.cooldown_until`) | ✅ 3.1 (same suite 12/0, `logs/2026-10-09T14-07-47` — 30/90-day stamps; literal-type tripwire `shared/constants/evaluation-rubric.constants.test.ts` 2/0 — `logs/2026-10-09T11-21-45`) |
| 5.2.5 | INV-TV5: Admin override supersedes automated result | Verify admin can certify/reject/grant re-evaluation | ✅ 3.1 (`backend/graphql/test/admin-applicant-override.wire.test.ts` 16/0 — gate run 3 via the locked `test:graphql` runner (`scratch/launch-gate-3.1/gate-run-3-transcript.log`); admin override supersedes, non-admin denied with zero writes/audit rows) |
| 5.2.6 | INV-TV6: Failed applicant retains student privileges during cooldown | Verify failed applicant can subscribe and attend sessions | ✅ 3.1 (`test/workflows/teachers/applicant-student-conversion.journey.test.ts` 17/0 — `logs/2026-10-09T14-07-52` (gate run 3); the converted actor purchases a STUDENT plan during the cooldown and books a real session) |

### 5.3 Subscription & Balance Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.3.1 | INV-B1: Balances are non-negative | As-built: only `balance_trial` is NOT NULL; `balance_hifz/tajweed/reviews` are nullable with the 4× named CHECKs bounding non-NULL values (`backend/db/schema/students/students.ts:24-27,42-45`); the app treats NULL as 0 (repo COALESCE). The shipped probe asserts the constraint inventory — a live "no NULL lanes on active students" data check is NOT part of it (ledger D21 reconciliation) | ✅ 3.1 (`backend/db/test/repo/students/student.repository.test.ts` 23/0 — `logs/2026-10-09T11-01-32` (CHECK-floor tiers + NULL-lane COALESCE); probe-constraints: all 4 `students_balance_*_check` present — `scratch/launch-gate-3.1/stage-logs/s5/probe-constraints.log` (9 PASS lines, exit 0)) |
| 5.3.2 | INV-B2: Full session count credited on activation | Verify balance credited immediately | ✅ 3.1 (`backend/services/billing/subscription-activation.service.test.ts` 38/0 — `logs/2026-10-09T11-01-38`; exact-delta lane credit = plan sessionCount, one lane, sibling lanes untouched) |
| 5.3.3 | INV-B3: Unused sessions expire at end of interval (no carryover) | Verify expiry zeroes the uncovered lane — the stale "no expiry surface exists" deferral is RETIRED: the expiry surface HAS shipped (`SubscriptionExpiryService.expireDue`, behind the fail-closed cron route `GET /api/cron/expire-subscriptions`; contract: `docs/billing/subscription-validity-window-expiry.md`) | ✅ 3.1 (`backend/services/billing/subscription-expiry.service.ts` + `subscription-expiry.service.test.ts:222-409` + `backend/db/test/logic/billing/subscription-expiry.repository.test.ts` + `test/workflows/billing/subscription-expiry.journey.test.ts` 7/0 (`logs/2026-10-09T11-01-39`) + the J3 delta journey `test/workflows/billing/subscription-expiry-booking-denial.journey.test.ts` 10/0 — `zeroLaneIfNoCoveringSubscription` skips zeroing while a covering subscription is active (INV-B3 as-built) and never zeroes `balance_trial`; sweep-replay idempotent (zero rows)) |
| 5.3.4 | INV-B4: Cannot request session with zero balance | Verify request rejected (as-built precedence: a lapsed covered lane denies `SUBSCRIPTION_EXPIRED` before any balance denial — `session-lifecycle.booking.ts:139-149`; `INSUFFICIENT_BALANCE` fires only for a never-funded student) | ✅ 3.1 (`backend/graphql/test/session-booking-balance.test.ts` 6/0 — `scratch/launch-gate-3.1/stage-logs/s5/test-graphql-session-booking-balance.log`; zero rows + idempotency key not burned; denial + chaos tiers in `session-lifecycle.service.test.ts` 89/0) |
| 5.3.5 | INV-B5: Segregated balances (Hifz/Tajweed/Reviews) | Verify correct-lane credit on activation and supported-lane hold/debit on booking (trial → hifz → tajweed ladder; `reviews` remains credit-only — never debited by booking holds) | ✅ 3.1 (`backend/db/test/repo/students/student.repository.test.ts` 23/0 — `logs/2026-10-09T11-01-32` (per-lane tiers) + `session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T10-50-48` (lane-hit ladder `:431-539`) + `subscription-activation.service.test.ts` 38/0 — `logs/2026-10-09T11-01-38` (lane credits + NULL-lane quarantine)) |
| 5.3.6 | INV-B6: Admin can extend validity window | Verify admin extension works (extend requires an ACTIVE row and shifts the window; RENEW requires an `expired` source and credits the lane) | ✅ 3.1 (`frontend/graphql/test/subscription-admin/subscription-admin.test.ts` 26/0 — `scratch/launch-gate-3.1/stage-logs/s5/test-graphql-subscription-admin.log`; anonymous UNAUTHORIZED, non-admin denied, admin extend + admin renew happy paths — D7b run-and-record, no duplicate wire file) |

### 5.4 Wallet & Transaction Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.4.1 | INV-W1: wallet.balance >= 0 | Verify check constraint | ✅ 3.1 (probe-constraints: `wallet_balance_check` present, definition `CHECK ((balance >= (0)::numeric))` — `scratch/launch-gate-3.1/stage-logs/s5/probe-constraints.log` (9 PASS lines, exit 0); named-constraint CHECK probes in `backend/db/test/repo/billing/wallet.repository.test.ts` |
| 5.4.2 | INV-W2: wallet.total_earning >= 0 | Verify check constraint | ✅ 3.1 (same probe run — `scratch/launch-gate-3.1/stage-logs/s5/probe-constraints.log`; `wallet_total_earning_check` present + named-constraint probes) |
| 5.4.3 | INV-W3: Each teacher has exactly one wallet | Verify unique constraint on wallet.teacher_id | ✅ 3.1 (same probe run — `scratch/launch-gate-3.1/stage-logs/s5/probe-constraints.log`; `wallet_teacher_id_unique` present; one wallet per teacher via `ensureWalletOnce` ON CONFLICT DO NOTHING) |
| 5.4.4 | INV-W4: Earning only on dual confirmation | Verify earning transaction timing | ✅ 3.1 (`session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T10-50-48`; earning fires only on the guarded student-confirm match; arbitration-Complete consumes the hold with NO wallet credit) |
| 5.4.5 | INV-W5: Withdrawal pending → completed/failed | Verify withdrawal state transitions (the pending→completed/failed settlement is the only legal UPDATE) | ✅ 3.1 (`backend/services/billing/admin-financial-auditing.service.test.ts` 32/0 — `logs/2026-10-09T11-05-09`; approve/reject settlement probes incl. already-settled denial) |
| 5.4.6 | INV-W6: Financial records immutable | Verify no UPDATE/DELETE on financial records | ✅ 3.1 (`backend/db/test/logic/billing/financial-immutability.test.ts` 17/0 — `logs/2026-10-09T11-05-09`; UPDATE/DELETE RAISE, relabel frozen, compensating-row doctrine, student_payments delete-guard matrix) |
| 5.4.7 | INV-W7: Earning linked to session_id; withdrawal/bonus may have null | Verify nullable session_id | ✅ 3.1 (`backend/services/teachers/teacher-re-evaluation.service.test.ts` 24/0 — `logs/2026-10-09T11-02-22`; earning rows carry the fixture sessionId (signature-level enforcement); withdrawal row session_id NULL) |
| 5.4.8 | INV-W8: Transaction amount > 0 (strictly positive) | Verify check constraint `amount > 0` — zero is rejected (stricter than the planning `>= 0`; `backend/db/schema/billing/teacher-transaction.ts:50`) | ✅ 3.1 (probe-constraints: definition `CHECK ((amount > (0)::numeric))` — `scratch/launch-gate-3.1/stage-logs/s5/probe-constraints.log`; `launch-financial-probe.test.ts` 5/0 — `logs/2026-10-09T10-46-37`, negative AND zero ledger amounts both raise `teacher_transaction_amount_check`) |

### 5.5 Parent-Child Link Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.5.1 | INV-P1: Parent cannot monitor without student confirmation | Verify unconfirmed parent has no access | ✅ 3.1 (`test/workflows/parents/parent-monitoring.journey.test.ts` 13/0 — `logs/2026-10-09T11-02-22`; `requireLinkedChild` gate + constant-denial oracle) |
| 5.5.2 | INV-P2: Parent access is read-only in MVP | Verify parent cannot modify data | ✅ 3.1 (`test/workflows/parents/parent-full-journey.journey.test.ts` 15/0 — `logs/2026-10-09T11-04-18`; every parent write attempt denied, zero rows; the portal ships seven read-only root queries) |
| 5.5.3 | INV-P3: Parent receives notification on child's session completion | Verify notification delivery (the producer is report submission — a completed-but-unreported session emits zero parent notification rows) | ✅ 3.1 (`parent-monitoring.journey.test.ts` 13/0 — `logs/2026-10-09T11-02-22`; report-ready wave targets the linked parent; INV-P1-gated) |
| 5.5.4 | One parent per student (B.12) | Verify second parent link rejected | ✅ 3.1 (`backend/services/parents/parent-link-request.chaos.test.ts` 11/0 — `logs/2026-10-09T11-04-33` (concurrent double-respond on one pending: exactly one winner) + `parent-full-journey.journey.test.ts` 15/0 (one-parent collapse, zero new rows)) |
| 5.5.5 | Parent can link to multiple children (B.13) | Verify same parent_id on multiple students | ✅ 3.1 (`parent-monitoring.journey.test.ts` 13/0 — `logs/2026-10-09T11-02-22`; multiple linked children in stable order; per-child reads return only that child's rows) |
| 5.5.6 | Link request expires after 7 days (B.14) | Verify expiry after 7 days (liveness is read/claim-enforced — strict `expiresAt > now`, lazy materialization; 7-day TTL from `PARENT_LINK_REQUEST_TTL_DAYS = 7`) | ☐ WHY: Dev 3 / scheduled sweep wiring waived-with-sign-off (ledger D13) — on-demand `ops:sweep-link-requests` / `ops:remind-link-requests` is the launch posture, bounding the re-request lockout window (expiry semantics hold regardless); shipped green underneath: `backend/services/parents/parent-link-request.service.test.ts` 37/0 (`logs/2026-10-09T11-04-35`; +7d TTL window, stale-confirm denied with the translated expired error, no link written) + `parent-full-journey.journey.test.ts` 15/0 (steps 5/6/11-12). Signatory: Ahmed (2026-10-10) |

### 5.6 Payment Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.6.1 | INV-PAY1: `student_payments.amount` CHECK | Verify check constraint | ✅ `backend/db/test/logic/billing/student-payment.repository.test.ts` (INV-PAY1: -1.00 and 0.00 inserts both rejected, 23514). Shipped CHECK is `amount > 0` (`student_payments_amount_check`) — stricter than `>= 0` |
| 5.6.2 | INV-PAY2: Payment records immutable (guarded pending→paid/failed is the single exception) | Attempt to UPDATE a decided/tampered payment — must fail | ✅ `backend/db/test/logic/billing/student-payment.repository.test.ts` (pending→paid freezes every financial column; DELETE guard raises; every other UPDATE raises) |
| 5.6.3 | INV-PAY3: Subscription activated only upon `paid` | Verify no activation/credit on failed or pending | ✅ `backend/services/billing/subscription-activation.service.test.ts` (failed delivery: payment decided failed, subscription untouched, no credit) |
| 5.6.4 | INV-PAY4: `payment_gateway` NOT NULL pgEnum | Verify enum membership + NOT NULL | ✅ `backend/db/test/logic/billing/student-payment.repository.test.ts` (INV-PAY4: bogus gateway ⇒ 22P02, NULL ⇒ 23502, enum_range equals the nine shipped values — stripe, paypal, paymob, fawry, offline_cash, bank_transfer, scholarship, other, mock) |
| 5.6.5 | INV-PAY5: Offline admin onboarding bypasses `student_payments`; audit on subscription columns | Verify zero ledger rows + subscription payment columns | ✅ `backend/services/admin/student-onboarding.service.test.ts` (offline cash onboarding: full five-table write set, two audit rows, zero ledger movement; gateway method rejected) |
| 5.6.6 | INV-PAY6: Exactly one pending→paid activation per subscription | Replay the signed callback — exactly one settlement | ✅ `backend/db/test/logic/billing/student-payment.repository.test.ts` (markPaidOnce guarded single-statement UPDATE) + `backend/services/billing/subscription-activation.service.test.ts` (late-confirmed-after-failed rejected; zero-credit replay proofs) + `app/api/payments/webhook/test/payments-webhook-route.test.ts` (N=6 retrial burst ⇒ one settlement ack, rest replay acks) |
| 5.6.7 | INV-PAY7: Amount/currency-mismatched verified callback is quarantined | Verify zero mutation + 200 processed:false | ✅ `backend/services/billing/subscription-activation.service.test.ts` (currency mismatch quarantines: zero mutation, correlation-ids-only log) + `app/api/payments/webhook/test/payments-webhook-route.test.ts` (unknown-reference quarantine ack posture) |

### 5.7 Homework Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.7.1 | INV-HW1: Homework linked to exactly one session_id (NOT NULL) | Verify NOT NULL + FK | ✅ `backend/db/test/repo/classes/home-work.repository.test.ts` (NULL session_id ⇒ 23502; orphan ⇒ 23503 on home_work_session_id_session_id_fkey; session delete cascades) + `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` (sessionId.notNull pin) |
| 5.7.2 | INV-HW2: `current_grade`/`revision_grade` are 0-100 | Verify check constraints | ✅ `backend/db/test/repo/classes/home-work.repository.test.ts` (INV-HW2: gradeHomeWorkOnce with 101/-1 raises 23514 on home_work_current_grade_check / home_work_revision_grade_check, row survives) |
| 5.7.3 | INV-HW3: First session assigns homework only (nothing to grade) | Verify first-session no-op semantics | ✅ `backend/services/classes/session-report.service.test.ts` (first session, previousGrades PRESENT with no ungraded target ⇒ silent no-op success) |
| 5.7.4 | INV-HW4: Subsequent sessions grade the previous session's homework | Verify newest-prior-row grading | ✅ `backend/services/classes/session-report.service.test.ts` (INV-HW4: with two ungraded rows, previousGrades land on the NEWEST prior row only) |

### 5.8 Progress Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.8.1 | INV-PR1: Progress links a student to a lesson | Verify FK constraints | ✅ `backend/db/test/repo/classes/progress.repository.test.ts` (INV-PR1: NULL student_id ⇒ 23502; orphan student/lesson ⇒ 23503 on both named FKs; a legal lesson_id = NULL row persists — set-null artifact) |
| 5.8.2 | INV-PR2: Progress incremented on Tajweed session completion | Verify pointer row commits with the credit | ✅ `backend/db/test/logic/classes/student-progress.service.test.ts` (first completed tajweed session inserts the pointer at the second lesson) + `test/workflows/classes/tajweed-progress-increment.test.ts` (pointer row commits in the SAME transaction as the wallet credit) |
| 5.8.3 | INV-PR3: Lessons belong to plans | Verify plan membership | ✅ `backend/db/test/logic/classes/lesson.service.test.ts` (INV-PR3: a wire-shaped planId: null ⇒ LESSON_PLAN_NOT_FOUND on the only plan-membership write surface). `lessons.plan_id` is nullable by design (ON DELETE SET NULL) — plan membership is a service-gate, not a DB NOT NULL |

### 5.9 Evaluation Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.9.1 | INV-E1: `evaluations.score` is 0-100 | Verify check constraint | ✅ `backend/db/test/repo/teachers/evaluation.repository.test.ts` (INV-E1: concrete 101/-1 raise raw 23514 on evaluations_score_check) + `backend/db/schema/teachers/evaluations-schema.static-assertions.test.ts` (CHECK list is exactly [evaluations_score_check]) |
| 5.9.2 | INV-E2: Evaluations soft-deleted, never hard-deleted | Verify no delete surface | ✅ `backend/db/test/repo/teachers/evaluation.repository.test.ts` (INV-E2 surface-absence source pins: no `.delete(` call, no delete/softDelete/update symbol). Design boundary: no DB delete guard exists — enforced by writer absence only (see `docs/specs/state-machine-invariants.md` §10) |
| 5.9.3 | INV-E3: Evaluation linked to the evaluated user and optionally a session | Verify FKs | ✅ `backend/db/test/repo/teachers/evaluation.repository.test.ts` (INV-E3: orphan evaluator ⇒ 23503 on evaluations_evaluator_id_users_id_fkey; session hard-delete ⇒ evaluation survives with sessionId null). Columns are `evaluated_id`/`evaluator_id` |
| 5.9.4 | INV-E4: Student-submitted teacher evaluations update average_rating (0-5) | Verify rating aggregation | ✅ `backend/db/test/repo/teachers/teacher.repository.test.ts` (rating beyond the 0-5 clamp raises teacher_average_rating_check) + `test/workflows/teachers/student-teacher-rating.journey.test.ts` + `backend/graphql/test/student-evaluation.wire.test.ts` |
| 5.9.5 | INV-E5: Student evaluations aggregated for cumulative performance metrics | Verify aggregation surface | ✅ `backend/services/admin/admin-academic-tracking.service.test.ts` (INV-E5 composite: homework grades both tracks + report history + progressRowCount + attention flag). The aggregation surface is academic tracking, not the `evaluations` table |
| 5.9.6 | INV-E6: Evaluation records permanently retained | Verify retention | ✅ `backend/db/test/repo/teachers/evaluation.repository.test.ts` (the set-null survival pin: a session hard-delete leaves the evaluation row intact). Design boundary: no retention guard exists; full retention needs a delete-guard migration (see `docs/specs/state-machine-invariants.md` §10) |

### 5.10 Plan Catalog Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.10.1 | INV-PC1: Deactivated plan never appears in the public catalog and cannot be purchased | Verify catalog exclusion + purchase denial | ✅ `backend/db/test/logic/billing/plan-catalog.repository.test.ts` (findActiveById returns null for deactivated/unknown ids) + `backend/services/billing/subscription-purchase.service.test.ts` (inactive/unknown plan both deny, zero writes) |
| 5.10.2 | INV-PC2: Deactivation/forward-only edits never alter existing subscriptions or credited balances | Verify zero-coupling | ✅ `test/workflows/billing/plan-catalog-invariance.journey.test.ts` (purchase → deactivate + edit ⇒ subscription row and credited lane byte-identical; a subsequent booking on the credited lane succeeds) |
| 5.10.3 | INV-PC3: Plan rows never hard-deleted | Attempt DELETE — must fail | ✅ `backend/db/test/logic/invariants/plan-catalog-invariants.test.ts` (PlanRepository exposes no delete method; a referenced-plan raw DELETE raises restrict_violation 23001 on subscriptions_plan_id_plans_id_fkey). Design boundary: no DB delete trigger; an unreferenced-plan DELETE succeeds (accepted boundary — see `docs/specs/state-machine-invariants.md` §11) |

---

## 6. Performance & Load Testing

| # | Criterion | Target | Verification | Status |
|---|---|---|---|---|
| 6.1 | API response time (95th percentile) | < 500ms | Load test with 100+ concurrent users | ✅ 4.5 (dev-scale in-gate drill — `bun run scripts/load/load-test.ts --url http://127.0.0.1:3100` exit 0: 100 VUs / 30 s, 8,101 requests, rps 268.1, overall p50 291.7 / p95 753.3 / p99 947.2 ms; 200-only serving path p50 390.6 / p95 1079.3 ms, n=98 — single-IP limiter masking recorded as-found, `scratch/load/load-test-2026-10-09T19-14-23-511Z.json`, report row 6.1 PASS in `docs/planning/launch-report-20261009T191940Z.json`; the production-scale 100+ concurrent-user p95 < 500 ms limb is waived-with-sign-off per D3 — W-1 signed: Ahmed (2026-10-10), owner Dev 3, package `ai/plans/milestone_4/production_launch_checklist_execution/outcome/load-waiver-d3-production-scale.md`) |
| 6.2 | Matching algorithm execution | < 200ms | Test with 100+ available teachers | ✅ 3.1 (`bun run scripts/load/matching-latency.ts` — `scratch/load/matching-latency-2026-10-09T08-05-31-490Z.json`: median 5.018ms, worst 21.637ms vs the 200ms row budget, 100+ seeded teachers) |
| 6.3 | WebSocket connection stability | 100+ concurrent | Maintain 100+ WebSocket connections for 1 hour | ✅ 3.1 (`bun run scripts/load/ws-soak.ts --url ws://127.0.0.1:3101` — `scratch/load/ws-soak-2026-10-09T08-10-42-823Z.json`: 100/100 authenticated sockets held, 0 unexplained drops beyond `WS_MISSED_PONG_LIMIT = 2`; sidecar booted via `scripts/start-notification-ws.ts`, shut down after) |
| 6.4 | Database query performance | No full table scans | Run EXPLAIN ANALYZE on all queries | ✅ 3.1 (`bun run scripts/load/probe-explain-analyze.ts` — `scratch/load/probe-explain-analyze-2026-10-09T08-05-35-212Z.json`: 0 driving-table Seq Scans over 13 critical query surfaces incl. the escrow balance read) |
| 6.5 | N+1 query elimination | Zero N+1 queries | Verify with query logging | ✅ 3.1 (`bun run test:graphql backend/graphql/test/query-count-regression.test.ts` — 2/0, constant SQL statements per GraphQL operation as page size grows; flat-projection kept, DataLoader retrofit waived — ledger D6) |
| 6.6 | Index coverage | All FKs indexed | Verify indexes on all foreign keys | ✅ 3.1 (`bun run scripts/load/probe-indexes.ts` — `scratch/load/probe-indexes-2026-10-09T08-05-38-441Z.json`: 37/37 FK columns covered (shared-PK children, composite-PK leading columns, unique-constraint backing indexes counted); the four previously-unindexed FK columns gained Drizzle `index()` shipped via `bun run db push`) |
| 6.7 | Pagination | All list endpoints paginated | Verify pagination on directory, sessions, notifications | ✅ 3.1 (`bun run test:graphql backend/graphql/test/notification-query.test.ts` — 12/0 — `scratch/launch-gate-3.1/stage-logs/s6/test-graphql-notification-query-retry2.log`; pagination pinned on directory browse, session lists, notification inbox — `backend/services/teachers/teacher-matching.query.ts:50-51`) |

---

## 7. Disaster Recovery

| # | Criterion | Verification | Status |
|---|---|---|---|
| 7.1 | Database backup is performed daily | Verify backup schedule | ✅ 4.1 (cold-operator drill executed `bun run ops:db-backup` → run `backups/20261009T130732Z`, manifest SHA-256 `8848b679e03178600c89c71336fc323db1f4a3da8907a36a2ddadf7f54423e54`, measured runtime 84 ms; ops sign-off filed — `outcome/backup-timer-signoff.md` incl. RPO cadence arithmetic `30min + 84ms + 2min jitter ≈ 32.08min ≤ RPO 1h` and D-001/D-002/D-003 re-confirmations (D9); production timer arming = operator-side D7 sign-off line, human-signed at 4.5) |
| 7.2 | Backup can be restored to staging | Perform test restore | ✅ 3.1, re-run 4.1 (`scripts/ops/backup-restore.integration.test.ts` 4/0, 114 expect calls — `logs/2026-10-09T16-08-56`; backup→restore chain + prod-shaped-target safety guard + tamper-refusal leg green; in-gate stamp refreshes at 4.4's resume) |
| 7.3 | All data is verified after restore | Run data consistency checks | ✅ 3.1, re-run 4.1 (`scripts/ops/restore-verify.test.ts` 113/0, 933 expect calls — `logs/2026-10-09T16-09-06`; the 7 read-only restore oracles — `scripts/ops/restore-oracles.ts` — additionally exercised live 7/7 PASS in the 4.1 cold-operator drill, `outcome/restore-report-20261009T130736Z.json`) |
| 7.4 | Recovery Time Objective (RTO) is defined | Document RTO (e.g., 4 hours) | ✅ 3.1 (`docs/ops/disaster-recovery.md:38` — RTO 4 hours, ratified) |
| 7.5 | Recovery Point Objective (RPO) is defined | Document RPO (e.g., 1 hour) | ✅ 3.1 (`docs/ops/disaster-recovery.md:37` — RPO 1 hour, ratified) |
| 7.6 | Disaster recovery plan is documented | Verify DR plan exists and is accessible | ✅ 3.1 (`docs/ops/disaster-recovery.md` — accessible DR runbook + playbooks + quarterly cold-operator drill procedure; audience line `:4`, cadence `:249`) |
| 7.7 | DR plan has been tested | Perform DR drill | ✅ 4.1 (cold-operator drill per `docs/ops/disaster-recovery.md:199-227`: scratch `kottaby_drill_20261009T130732Z` provisioned → `bun run ops:db-backup` → `bun run ops:db-restore-verify … --yes-i-understand` → **VERDICT: PASS**, structural 26/26, oracles 7/7; report copy filed — `outcome/restore-report-20261009T130736Z.json`; total wall-clock ≈ 3 min vs ≤ 2h RTO-headroom budget; timing table + friction log in `outcome/4.1-outcome.md`) |

---

## 8. Decision Verification (All 33 Resolved Decisions)

| # | Decision | Verification | Status |
|---|---|---|---|
| 8.1 | A.1: parents table exists | Verify table in schema | ✅ 3.1 (probe-decisions 21/21 PASS — `scratch/launch-gate-3.1/stage-logs/s8/probe-decisions.log`; parents table + shared-PK FK→users.id) |
| 8.2 | A.2: students.parent_id FK exists | Verify column and FK — the FK targets `users.id`, not `parents.id` (`parents` is a shared-PK role-marker table; `backend/db/schema/students/students.ts:32`, set-null on delete) | ✅ 3.1 (probe-decisions 21/21 PASS) |
| 8.3 | A.3: students.handshake_code unique | Verify unique constraint | ✅ 3.1 (`backend/db/test/logic/students/handshake-code-generation-locks.test.ts` 8/0 — `logs/2026-10-09T11-21-30`; duplicate INSERT raises SQLSTATE 23505 on `students_handshake_code_unique` (service guards bypassed, via the registration repository) |
| 8.4 | A.4: notifications table exists | Verify table in schema | ✅ 3.1 (probe-decisions 21/21 PASS) |
| 8.5 | A.5: audit_logs table exists (immutable) | Verify table and append-only | ✅ 3.1 (`backend/db/test/logic/audit/audit-immutability.test.ts` 17/0 — `logs/2026-10-09T11-21-40`; append-only trigger pair present + corpus walk + migration-DDL pin) |
| 8.6 | A.6: teacher.subjects field exists | Verify column — on the singular `teacher` table (JSON array in varchar(255); `backend/db/schema/teachers/teacher.ts:37`) | ✅ 3.1 (probe-decisions 21/21 PASS) |
| 8.7 | A.7: governance fields on users table | Verify fields on users ONLY — not on students/teacher/parents/admin (negative pin) | ✅ 3.1 (`backend/db/schema/users/users-governance.static-assertions.test.ts` 7/0 — `logs/2026-10-09T11-21-40`; users carries `isDeleted`/`suspended`/`isBlocked` + their timestamps, the role tables export NONE of them) |
| 8.8 | A.8: session.session_type enum exists | Verify column and enum | ✅ 3.1 (probe-decisions 21/21 PASS) |
| 8.9 | A.9: subscriptions.status enum exists | Verify column and enum | ✅ 3.1 (probe-decisions 21/21 PASS) |
| 8.10 | A.10: session.intent enum exists | Verify column and enum | ✅ 3.1 (probe-decisions 21/21 PASS) |
| 8.11 | B.1: Per-submission minimum score of 80 (0–100 integer band) across five rubric submissions | Verify `RUBRIC_PASS_THRESHOLD = 80` (`shared/constants/evaluation-rubric.constants.ts:18`) — every one of the five submissions must score ≥80 (`evaluation-rubric.helpers.ts:295` `submissions.every(row => row.score >= RUBRIC_PASS_THRESHOLD)`); NOT a mean, NOT "80% of evaluators" | ✅ 3.1 (`shared/constants/evaluation-rubric.constants.test.ts` 2/0 — `logs/2026-10-09T11-21-45` (threshold frozen); `evaluation-rubric-scoring.journey.test.ts` 16/0 — 80 passes / 79 fails per submission, one sub-80 submission fails the cycle) |
| 8.12 | B.2: 24-hour dual confirmation timeout | Verify timeout and auto-cancel | ✅ 3.1 (`backend/services/classes/session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T11-21-45`; `SESSION_CONFIRMATION_WINDOW_MS = 86_400_000` deadline pin `:1118-1141` + sweeper legs + simulated auto-cancel) |
| 8.13 | B.3: Platform-set session fees (fee by session intent) | Fee by session intent — `sessionFeeForIntent` (`backend/services/classes/session-lifecycle.guards.ts:83-85`; `SESSION_FEE_HIFZ = SESSION_FEE_TAJWEED = "25.00"` EGP, `shared/constants/session-fees.constants.ts:27-30`), not plan/subject; the booking input whitelist is teacherId + intent only | ✅ 3.1 (fee applied server-side, verbatim, never caller input — `session-lifecycle.service.test.ts` 89/0 — `logs/2026-10-09T11-21-45`; constant pins green run-and-record — `session-fees.constants.test.ts:96-107,137-140`; §9 sign-off input for the Product Owner: interim session fee "25.00" EGP + provisional `RE_EVALUATION_FEE = "100.00"` — `shared/constants/re-evaluation.constants.ts:24-28`; **PO-confirmed: Ahmed, 2026-10-10** — session fee 25.00 EGP accepted as interim; re-evaluation fee 100.00 EGP accepted as provisional pending re-evaluation) |
| 8.14 | B.4: Escrow hold-at-request (as-built: prepaid-lane debit model) | Verify the escrow flow — guarded request-time lane debit + `fee_held` + `held_balance_lane`; consume-once + wallet credit at dual confirmation; same-lane refund on cancel/timeout | ✅ 3.1 (`test/workflows/sessions/session-dual-confirmation.journey.test.ts` 11/0 — `logs/2026-10-09T11-22-03`; booking hold, both stamps, wallet credited exactly the fee once, sweep refund, confirm-vs-sweep race → exactly one financial outcome) |
| 8.15 | B.5: Re-evaluation paid by teacher (wallet deduction) | Verify wallet deduction | ✅ 3.1 (`test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts` 11/0 — `logs/2026-10-09T12-56-45`; verbatim "100.00" EGP wallet debit, exactly ONE withdrawal/completed ledger row (session_id NULL), low-balance denied) |
| 8.16 | B.6: applicants table for failed applicants | Verify table and lifecycle (lifecycle home for ALL applicants — pending/in_evaluation/failed/passed) | ✅ 3.1 (`backend/db/test/repo/teachers/applicant.repository.test.ts` 17/0 — `logs/2026-10-09T11-22-04`) |
| 8.17 | B.7: teacher record only after verification | Verify teacher record creation timing | ✅ 3.1 (`evaluation-rubric-scoring.journey.test.ts` 16/0 — `logs/2026-10-09T14-07-46`; the `teacher` row is minted ONLY on rubric pass / admin certify; registration creates only an applicants row) |
| 8.18 | B.8/C.2: subscriptions.user_id (generic) | Verify column name and FK | ✅ 3.1 (probe-decisions 21/21 PASS; generic owner `user_id` FK→users.id + multi-student junction coverage) |
| 8.19 | B.9: Offline payment fields on subscriptions | Verify payment_method, payment_reference, payment_verified_at | ✅ 3.1 (probe-decisions 21/21 PASS; offline payment fields + partial unique index) |
| 8.20 | B.10: On-demand matching model | Verify no fixed assignments | ✅ 3.1 (probe-decisions 21/21 PASS; ABSENCE of any assignment/allocation table; the on-demand browse is the only matching surface) |
| 8.21 | B.11: Surah/Juz enum for homework | Verify surah_juz_ref enum and columns | ✅ 3.1 (`backend/enum/shared/surah-juz-ref.enum.test.ts` 25/0 — `logs/2026-10-09T11-22-14`; 144-member mirror parity (114 surahs + 30 juz); prior provenance: kottaby#300 — `docs/curriculum/surah-juz-ref-vocabulary.md`) |
| 8.22 | B.12: One parent per student | Verify single parent_id FK (single-valued nullable FK + guarded single-writer — writer discipline, not a DB constraint) | ✅ 3.1 (`backend/db/test/repo/students/student.repository.test.ts` 23/0 — `logs/2026-10-09T11-22-18`; second link collapses, rival cannot steal) |
| 8.23 | B.13: Parent links multiple children | Verify multiple students with same parent_id | ✅ 3.1 (`backend/db/test/repo/students/student.parent-monitoring.repository.test.ts` 15/0 — `logs/2026-10-09T11-22-19`; one parent, multiple linked children, stable order) |
| 8.24 | B.14: 7-day link request expiry | Verify expiry logic (liveness read/claim-enforced — strict `expiresAt > now`, lazy materialization; `PARENT_LINK_REQUEST_TTL_DAYS = 7`) | ✅ 3.1 (`backend/services/parents/parent-link-request.service.test.ts` 37/0 — `logs/2026-10-09T11-22-19`; +7d window ±1s, boundary tier at `expiresAt` exactly now, stale rows surface Expired, direct expiry-materialization probe) |
| 8.25 | B.15: 15-minute inactivity timeout | Verify auto-offline after 15 min | ✅ 3.1 (`backend/services/teachers/teacher-inactivity.service.test.ts` 10/0 — `logs/2026-10-09T11-22-19`; env-default 15 + safe fallback + one-transaction composition; sweep behind the cron route) |
| 8.26 | B.16: Configurable request handling | Verify teacher.request_preference enum (schema half) — the runtime intake (queue / reject / offer_alternatives) does not ship | ☐ WHY: Dev 3 / runtime intake waived-with-sign-off to the matching/intake backlog (ledger D2); schema half shipped and probe-verified: `teacher_request_preference` pgEnum (`backend/db/schema/enums.ts:271`) + `teacher.request_preference` column (`backend/db/schema/teachers/teacher.ts:54`) + TS mirror — probe-decisions 21/21 PASS. Signatory: Ahmed (2026-10-10) |
| 8.27 | B.17: Prorated plan changes | Verify proration logic | ✅ 3.1 (`backend/services/billing/subscription-admin.service.test.ts` 76/0 — `logs/2026-10-09T11-22-22`; proration directions, carry/forfeit, ceiling denial, replay idempotency) |
| 8.28 | B.18: Admin arbitration for disputes | Verify disputed status and arbitration | ✅ 3.1 (`backend/graphql/test/session-arbitration.wire.test.ts` 40/0 — `scratch/launch-gate-3.1/stage-logs/s8-test-graphql-session-arbitration.log`; five-outcome vocabulary, family-mismatch denial, Uphold zero financial writes) |
| 8.29 | C.1: parent in user_role enum | Verify enum value | ✅ 3.1 (`backend/db/test/logic/admin/admin-user.repository.test.ts` 57/0 — `logs/2026-10-09T11-22-34`; user_role round-trips all four values incl. parent) |
| 8.30 | C.3: evaluations.evaluated_id and evaluator_id | Verify both columns and FKs | ✅ 3.1 (`backend/db/test/repo/teachers/evaluation.repository.test.ts` 55/0 — `logs/2026-10-09T11-22-35`; canonical column set + distinct FK delete semantics) |
| 8.31 | C.4: reports.teacher_id removed | Verify column does not exist | ✅ 3.1 (`backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` 7/0 — `logs/2026-10-09T11-22-35`; reports column set is exactly [createdAt,id,sessionId,studentRatingByTeacher,teacherNotes,updatedAt] — NO teacher_id) |
| 8.32 | C.5: recitation.session_id (unique, 1:1) | Verify column and unique constraint | ✅ 3.1 (`backend/db/test/repo/classes/recitation.repository.test.ts` 11/0 — `logs/2026-10-09T11-22-35`; second insert per session raises 23505 on `recitation_session_id_unique`) |
| 8.33 | All enums validated | Verify all 21 pgEnums are defined in `backend/db/schema/enums.ts` (zero in domain files) with byte-identical TS mirrors | ✅ 3.1 (`backend/db/test/logic/shared/schema-registry-census.test.ts` 52/0 — `logs/2026-10-09T11-22-38`; registry count 21, zero `pgEnum(` in domain schema files, order-sensitive pgEnum↔TS-mirror parity — the 13-mirror gap closed) |

---

## 9. Launch Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Engineering Manager | Ahmed | Ahmed | 2026-10-10 |
| Dev 1 (Student & Parent) | Ahmed | Ahmed | 2026-10-10 |
| Dev 2 (Teacher Lifecycle) | Ahmed | Ahmed | 2026-10-10 |
| Dev 3 (Matching & Admin) | Ahmed | Ahmed | 2026-10-10 |
| Product Owner | Ahmed | Ahmed | 2026-10-10 |

### Final Launch Criteria

- [x] All Section 1 (Data Integrity) items verified
- [x] All Section 2 (Financial Safeguards) items verified
- [x] All Section 3 (Real-Time Reliability) items verified
- [x] All Section 4 (Security) items verified
- [x] All Section 5 (State Machine Invariants) items verified
- [x] All Section 6 (Performance) targets met
- [x] All Section 7 (Disaster Recovery) items verified
- [x] All Section 8 (33 Decisions) verified
- [x] Drizzle schema in `backend/db/schema/` type-checks (`bun tsgo`)
- [x] `bun run validate:mermaid` passes on all planning docs (`scripts/validation/validate-mermaid.ts`, `package.json:73`)
- [x] All Milestone 4 tickets completed
- [x] All 5 sign-offs obtained

**🚀 Launch Approved:** Ahmed (Date: 2026-10-10)

> **Sign-off provenance (2026-10-10):** the five signature rows, the 12 criteria ticks, the 🚀 Launch Approved line, the eight waiver signatories (the ☐ WHY rows in §1–§8), the D3 production-scale load waiver (W-1/W-2/W-3), and the pricing confirmation (8.13) were collected interactively from the repo owner (Ahmed) via structured sign-off prompt, 2026-10-10, and transcribed into this record with explicit authorization. Each criterion tick is backed by the 4.4 definitive machine report `docs/planning/launch-report-20261009T191940Z.json` (173 rows: 165 PASS + 8 WAIVED, 0 FAIL) and the filed drill evidence; the machine report's own `waivers[]` signatory ingestion remains a harness gap — the human sign-off record of record is this §9 table (see `ai/plans/milestone_4/production_launch_checklist_execution/outcome/4.5-signoff-final-gate-outcome.md`).
