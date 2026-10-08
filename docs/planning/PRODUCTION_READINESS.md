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
| 1.1.1 | No user, student, or teacher record can be hard-deleted | Attempt hard-delete via SQL — must fail | ☐ |
| 1.1.2 | All deletions use soft delete (`users.is_deleted = true`) | Verify admin delete endpoint sets `is_deleted=true`, `deleted_at=now()` | ☐ |
| 1.1.3 | Soft-deleted users cannot access the platform | Login as soft-deleted user — must return 403 | ☐ |
| 1.1.4 | Soft-deleted users' historical data is preserved | Verify sessions, reports, financial transactions remain after soft delete | ☐ |
| 1.1.5 | Admin can reactivate soft-deleted users | Reactivate — `is_deleted=false`, `deleted_at=null`, login works | ☐ |

**Decision Refs:** A.7 (governance on users), INV-U1, INV-U4, INV-U5, FR-1.4

### 1.2 Financial Record Immutability

| # | Criterion | Verification | Status |
|---|---|---|---|
| 1.2.1 | `student_payments` records are immutable once created | Attempt to UPDATE a student_payments record — must fail | ☐ |
| 1.2.2 | `teacher_transaction` records are immutable once created | Attempt to UPDATE a teacher_transaction record — must fail | ☐ |
| 1.2.3 | Corrections are handled via new adjustment transactions only | Verify admin manual adjustments create NEW transactions, not modify existing | ☐ |
| 1.2.4 | All financial records have `created_at` timestamps | Verify all financial records have non-null `created_at` | ☐ |

**Decision Refs:** INV-W6, INV-PAY2, FR-5.7

### 1.3 Audit Trail Completeness

| # | Criterion | Verification | Status |
|---|---|---|---|
| 1.3.1 | Every admin action is logged in `audit_logs` | Perform every admin action type — verify audit_log record exists for each | ☐ |
| 1.3.2 | Audit log records are immutable (append-only) | Attempt to UPDATE or DELETE an audit_log record — must fail | ☐ |
| 1.3.3 | Audit log captures: actor_id, action_type, entity_type, entity_id, details, created_at | Verify all fields are populated for every audit log entry | ☐ |
| 1.3.4 | Admin can filter audit trail by actor, action type, entity, and date range | Verify filtering works correctly | ☐ |
| 1.3.5 | All 7 audit_action_type values are exercised (create, update, delete, override, adjust, suspend, reactivate) | Verify each action type appears in the audit log | ☐ |

**Decision Refs:** A.5 (audit_logs), FR-10.5

### 1.4 Data Retention

| # | Criterion | Verification | Status |
|---|---|---|---|
| 1.4.1 | All session logs, reports, evaluations, and recitation records are stored permanently | Verify no purge/delete jobs exist for these tables | ☐ |
| 1.4.2 | Evaluation records are permanently retained for dispute resolution | Verify evaluations cannot be hard-deleted (only soft-delete via `is_deleted`) | ☐ |
| 1.4.3 | Homework records are permanently retained | Verify no purge jobs for home_work table | ☐ |

**Decision Refs:** INV-E2, INV-E6, FR-11

---

## 2. Financial & Escrow Safeguards

### 2.1 Dual-Confirmation Timeout

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.1.1 | Session completion requires dual confirmation (teacher + student) | Verify session cannot be finalized without both confirmations | ☐ |
| 2.1.2 | 24-hour timeout auto-cancels unconfirmed sessions | Create session, wait 24h (or simulate) — verify auto-cancel | ☐ |
| 2.1.3 | Auto-cancelled sessions release held funds | Verify `fee_held` is released and balance is not decremented | ☐ |
| 2.1.4 | `confirmation_deadline` is set to `now + 24h` on session creation | Verify deadline is correctly set | ☐ |
| 2.1.5 | Both `confirmed_by_student_at` and `confirmed_by_teacher_at` are recorded | Verify timestamps are set on confirmation | ☐ |

**Decision Refs:** B.2 (24h timeout), FR-5.5

### 2.2 Escrow Hold & Release

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.2.1 | Fee is held at session request (`fee_held = true`) | Verify fee_held is set on session creation | ☐ |
| 2.2.2 | Balance is held (not decremented) at request | Verify student balance is not decremented until dual confirmation | ☐ |
| 2.2.3 | Balance is decremented only upon dual confirmation | Verify decrement happens after both confirmations | ☐ |
| 2.2.4 | Teacher wallet is credited only upon dual confirmation | Verify earning transaction is created after dual confirmation | ☐ |
| 2.2.5 | Cancelled sessions release held funds (no decrement, no wallet credit) | Verify cancellation releases fee_held and creates no earning | ☐ |
| 2.2.6 | Session fee is platform-set (not negotiated) | Verify fee is determined by plan/subject, not teacher or student input | ☐ |

**Decision Refs:** B.3 (platform-set fees), B.4 (escrow hold-at-request), INV-S3, INV-W4

### 2.3 Double-Spend Prevention

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.3.1 | Student cannot request session with zero balance | Verify request is rejected with 422 | ☐ |
| 2.3.2 | Concurrent session requests for the same balance are prevented | Attempt two simultaneous requests — only one succeeds | ☐ |
| 2.3.3 | Balance cannot go negative | Verify check constraint `balance >= 0` is enforced | ☐ |
| 2.3.4 | Wallet balance cannot go negative | Verify check constraint `wallet.balance >= 0` is enforced | ☐ |
| 2.3.5 | Transaction amounts cannot be negative | Verify check constraint `amount >= 0` is enforced | ☐ |

**Decision Refs:** INV-B1, INV-B4, INV-W1, INV-W8

### 2.4 Dispute Resolution

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.4.1 | Student can dispute a completed session | Verify session status changes to `disputed` | ☐ |
| 2.4.2 | Admin can arbitrate disputes (refund, partial refund, uphold) | Verify all three arbitration outcomes work | ☐ |
| 2.4.3 | Refund credits student balance and debits teacher wallet | Verify financial adjustments are correct | ☐ |
| 2.4.4 | All dispute actions are logged in audit_logs | Verify audit log entries for dispute resolution | ☐ |

**Decision Refs:** B.18 (admin arbitration)

### 2.5 Withdrawal Safety

| # | Criterion | Verification | Status |
|---|---|---|---|
| 2.5.1 | Withdrawal requests start as `pending` | Verify new withdrawal has status=pending | ☐ |
| 2.5.2 | Admin approval transitions to `completed` and decrements wallet | Verify approval flow | ☐ |
| 2.5.3 | Admin rejection transitions to `failed` and does NOT decrement wallet | Verify rejection flow | ☐ |
| 2.5.4 | Withdrawal amount cannot exceed wallet balance | Verify request is rejected with 422 | ☐ |
| 2.5.5 | Withdrawal transactions are immutable after completion | Verify no modification possible | ☐ |

**Decision Refs:** INV-W5, INV-W6, FR-5.6

---

## 3. Real-Time Reliability

### 3.1 Presence Heartbeat

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.1.1 | WebSocket heartbeat updates `users.last_active_at` | Verify heartbeat updates timestamp | ☐ |
| 3.1.2 | 15-minute inactivity marks teacher as unavailable | Verify `is_online=false` after 15 min of no heartbeat | ☐ |
| 3.1.3 | Teacher in active session is NOT auto-offlined | Verify in-session lock takes priority over inactivity timeout | ☐ |
| 3.1.4 | Teacher can toggle back to Available after resuming activity | Verify toggle works after reconnection | ☐ |

**Decision Refs:** B.15 (15-min inactivity), A.7 (last_active_at)

### 3.2 Session Disconnection Recovery

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.2.1 | Graceful handling of WebSocket disconnection during session | Verify session continues if teacher/student reconnects | ☐ |
| 3.2.2 | Session state is preserved during temporary disconnection | Verify session status does not change on disconnect | ☐ |
| 3.2.3 | Reconnection restores real-time communication | Verify messages flow after reconnection | ☐ |
| 3.2.4 | Notification queue delivers missed notifications on reconnection | Verify pending notifications are delivered | ☐ |

### 3.3 In-Session Concurrency Locking

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.3.1 | Teacher is hidden from directory during active session | Verify in-session teacher does not appear in directory | ☐ |
| 3.3.2 | `teacher.is_online = false` during active session | Verify is_online is false when session status=started | ☐ |
| 3.3.3 | No other student can request a session with an in-session teacher | Verify request is rejected | ☐ |
| 3.3.4 | Teacher returns to Available after session concludes (if still active) | Verify is_online returns to true after session completion | ☐ |

**Decision Refs:** INV-A2, INV-A3, INV-A4, INV-S6, FR-4.3

### 3.4 Notification Delivery

| # | Criterion | Verification | Status |
|---|---|---|---|
| 3.4.1 | Session request notifications are delivered in real-time | Verify teacher receives notification within 1 second | ☐ |
| 3.4.2 | Session completion notifications are delivered to parents | Verify parent receives notification on session completion | ☐ |
| 3.4.3 | Notifications are persisted in database for offline users | Verify notification record exists even if user is offline | ☐ |
| 3.4.4 | Users can retrieve unread notifications on login | Verify notification API returns unread notifications | ☐ |
| 3.4.5 | All 7 notification types are exercised | Verify each notification_type is triggered correctly | ☐ |

**Decision Refs:** A.4 (notifications), FR-9.1, FR-9.2, FR-9.3

---

## 4. Security

### 4.1 Authentication & Authorization

| # | Criterion | Verification | Status |
|---|---|---|---|
| 4.1.1 | JWT tokens are issued with correct user_id and role | Verify token contents | ☐ |
| 4.1.2 | RBAC middleware enforces role-based access on all endpoints | Verify each role can only access permitted endpoints | ☐ |
| 4.1.3 | Expired tokens are rejected | Verify 401 on expired token | ☐ |
| 4.1.4 | Tampered tokens are rejected | Verify 401 on tampered token | ☐ |
| 4.1.5 | Passwords are hashed (not stored in plaintext) | Verify password_hash column contains hashed values | ☐ |
| 4.1.6 | Soft-deleted, suspended, and blocked users are denied access | Verify 403 for each governance state | ☐ |

**Decision Refs:** A.7 (governance on users), C.1 (parent role)

### 4.2 Input Validation & Injection Prevention

| # | Criterion | Verification | Status |
|---|---|---|---|
| 4.2.1 | All API inputs are validated (type, length, format) | Verify invalid inputs return 422 | ☐ |
| 4.2.2 | SQL injection is prevented (parameterized queries) | Attempt SQL injection — must fail | ☐ |
| 4.2.3 | XSS is prevented (output encoding) | Attempt XSS — must be sanitized | ☐ |
| 4.2.4 | CSRF protection is in place | Verify CSRF token validation | ☐ |
| 4.2.5 | Rate limiting on authentication endpoints | Verify rate limiting on login, password reset | ☐ |

### 4.3 Data Protection

| # | Criterion | Verification | Status |
|---|---|---|---|
| 4.3.1 | Passwords are hashed with bcrypt or equivalent | Verify hashing algorithm | ☐ |
| 4.3.2 | Sensitive data is not logged in plain text | Verify logs do not contain passwords, tokens, or PII | ☐ |
| 4.3.3 | API responses do not leak internal IDs or sensitive fields | Verify response payloads are minimal | ☐ |
| 4.3.4 | Database connections use SSL/TLS | Verify connection encryption | ☐ |
| 4.3.5 | Environment variables are used for secrets (not hardcoded) | Verify no secrets in source code | ☐ |

---

## 5. State Machine Invariant Verification

### 5.1 Session Lifecycle Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.1.1 | INV-S1: No transition from `completed` to `started` or `scheduled` | Attempt transition — must fail | ☐ |
| 5.1.2 | INV-S2: No transition from `cancelled` to any other state | Attempt transition — must fail | ☐ |
| 5.1.3 | INV-S3: Earning transaction only on dual confirmation | Verify no earning without both confirmations | ☐ |
| 5.1.4 | INV-S4: Session must have both teacher_id and student_id (NOT NULL) | Verify NOT NULL constraints | ☐ |
| 5.1.5 | INV-S5: Teacher must be certified at session creation | Verify is_approved=true check | ☐ |
| 5.1.6 | INV-S6: Teacher is_online=false during started session | Verify in-session lock | ☐ |
| 5.1.7 | INV-S7: Report only for completed session | Verify report submission requires completed status | ☐ |
| 5.1.8 | INV-S8: Homework only when report is submitted | Verify homework creation requires report | ☐ |

### 5.2 Teacher Verification Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.2.1 | INV-TV1: Cannot certify without 5 sessions or admin cold-start | Verify certification requires 5 evaluations or admin override | ☐ |
| 5.2.2 | INV-TV2: 5 distinct evaluators (no duplicate) | Verify same evaluator cannot evaluate same applicant twice | ☐ |
| 5.2.3 | INV-TV3: Cooldown must expire before re-purchase | Verify re-purchase rejected during cooldown | ☐ |
| 5.2.4 | INV-TV4: Tajweed cooldown = 30 days, Hifz cooldown = 90 days | Verify cooldown periods | ☐ |
| 5.2.5 | INV-TV5: Admin override supersedes automated result | Verify admin can certify/reject/grant re-evaluation | ☐ |
| 5.2.6 | INV-TV6: Failed applicant retains student privileges during cooldown | Verify failed applicant can subscribe and attend sessions | ☐ |

### 5.3 Subscription & Balance Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.3.1 | INV-B1: Balances are non-negative integers | Verify check constraints and default 0 | ✅ REQ-010 (Task 1.1 — CHECK-floor tiers `student.repository.test.ts`, schema `students.ts:42-45`) |
| 5.3.2 | INV-B2: Full session count credited on activation | Verify balance credited immediately | ✅ REQ-013/017/018 (Tasks 1.1/2.1/2.2 — exact-delta lanes `subscription-activation.service.test.ts`, journey `subscription-purchase.journey.test.ts`) |
| 5.3.3 | INV-B3: Unused sessions expire at end of interval (no carryover) | Verify expiry zeroes balance | ☐ WHY: expiry invariant is DEV1-008 scope (deferred item D5) — no expiry surface exists this milestone |
| 5.3.4 | INV-B4: Cannot request session with zero balance | Verify request rejected | ✅ REQ-020/021 (Tasks 1.1/2.3 — denial + chaos `session-lifecycle.service.test.ts`, GraphQL pin `session-booking-balance.test.ts`) |
| 5.3.5 | INV-B5: Segregated balances (Hifz/Tajweed/Reviews) | Verify correct-lane credit on activation and supported-lane hold/debit on booking (trial → hifz → tajweed ladder; `reviews` remains credit-only — never debited by booking holds) | ✅ REQ-015/018 (Tasks 1.1/2.3 — segregated-lane tiers `student.repository.test.ts`, lane-hit hold/debit ladder `session-lifecycle.service.test.ts`, webhook idempotency `subscription-activation.service.test.ts`) |
| 5.3.6 | INV-B6: Admin can extend validity window | Verify admin extension works | ☐ |

### 5.4 Wallet & Transaction Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.4.1 | INV-W1: wallet.balance >= 0 | Verify check constraint | ☐ |
| 5.4.2 | INV-W2: wallet.total_earning >= 0 | Verify check constraint | ☐ |
| 5.4.3 | INV-W3: Each teacher has exactly one wallet | Verify unique constraint on wallet.teacher_id | ☐ |
| 5.4.4 | INV-W4: Earning only on dual confirmation | Verify earning transaction timing | ☐ |
| 5.4.5 | INV-W5: Withdrawal pending → completed/failed | Verify withdrawal state transitions | ☐ |
| 5.4.6 | INV-W6: Financial records immutable | Verify no UPDATE/DELETE on financial records | ☐ |
| 5.4.7 | INV-W7: Earning linked to session_id; withdrawal/bonus may have null | Verify nullable session_id | ☐ |
| 5.4.8 | INV-W8: Transaction amount >= 0 | Verify check constraint | ☐ |

### 5.5 Parent-Child Link Invariants

| # | Invariant | Verification | Status |
|---|---|---|---|
| 5.5.1 | INV-P1: Parent cannot monitor without student confirmation | Verify unconfirmed parent has no access | ☐ |
| 5.5.2 | INV-P2: Parent access is read-only in MVP | Verify parent cannot modify data | ☐ |
| 5.5.3 | INV-P3: Parent receives notification on child's session completion | Verify notification delivery | ☐ |
| 5.5.4 | One parent per student (B.12) | Verify second parent link rejected | ☐ |
| 5.5.5 | Parent can link to multiple children (B.13) | Verify same parent_id on multiple students | ☐ |
| 5.5.6 | Link request expires after 7 days (B.14) | Verify expiry after 7 days | ☐ |

---

## 6. Performance & Load Testing

| # | Criterion | Target | Verification | Status |
|---|---|---|---|---|
| 6.1 | API response time (95th percentile) | < 500ms | Load test with 100+ concurrent users | ☐ |
| 6.2 | Matching algorithm execution | < 200ms | Test with 100+ available teachers | ☐ |
| 6.3 | WebSocket connection stability | 100+ concurrent | Maintain 100+ WebSocket connections for 1 hour | ☐ |
| 6.4 | Database query performance | No full table scans | Run EXPLAIN ANALYZE on all queries | ☐ |
| 6.5 | N+1 query elimination | Zero N+1 queries | Verify with query logging | ☐ |
| 6.6 | Index coverage | All FKs indexed | Verify indexes on all foreign keys | ☐ |
| 6.7 | Pagination | All list endpoints paginated | Verify pagination on directory, sessions, notifications | ☐ |

---

## 7. Disaster Recovery

| # | Criterion | Verification | Status |
|---|---|---|---|
| 7.1 | Database backup is performed daily | Verify backup schedule | ☐ |
| 7.2 | Backup can be restored to staging | Perform test restore | ☐ |
| 7.3 | All data is verified after restore | Run data consistency checks | ☐ |
| 7.4 | Recovery Time Objective (RTO) is defined | Document RTO (e.g., 4 hours) | ☐ |
| 7.5 | Recovery Point Objective (RPO) is defined | Document RPO (e.g., 1 hour) | ☐ |
| 7.6 | Disaster recovery plan is documented | Verify DR plan exists and is accessible | ☐ |
| 7.7 | DR plan has been tested | Perform DR drill | ☐ |

---

## 8. Decision Verification (All 33 Resolved Decisions)

| # | Decision | Verification | Status |
|---|---|---|---|
| 8.1 | A.1: parents table exists | Verify table in schema | ☐ |
| 8.2 | A.2: students.parent_id FK exists | Verify column and FK | ☐ |
| 8.3 | A.3: students.handshake_code unique | Verify unique constraint | ☐ |
| 8.4 | A.4: notifications table exists | Verify table in schema | ☐ |
| 8.5 | A.5: audit_logs table exists (immutable) | Verify table and append-only | ☐ |
| 8.6 | A.6: teacher.subjects field exists | Verify column | ☐ |
| 8.7 | A.7: governance fields on users table | Verify fields on users, not on students | ☐ |
| 8.8 | A.8: session.session_type enum exists | Verify column and enum | ☐ |
| 8.9 | A.9: subscriptions.status enum exists | Verify column and enum | ☐ |
| 8.10 | A.10: session.intent enum exists | Verify column and enum | ☐ |
| 8.11 | B.1: 80% evaluation pass threshold | Verify threshold in evaluation logic | ☐ |
| 8.12 | B.2: 24-hour dual confirmation timeout | Verify timeout and auto-cancel | ☐ |
| 8.13 | B.3: Platform-set session fees | Verify fee is platform-determined | ☐ |
| 8.14 | B.4: Escrow hold-at-request, decrement-at-completion | Verify escrow flow | ☐ |
| 8.15 | B.5: Re-evaluation paid by teacher (wallet deduction) | Verify wallet deduction | ☐ |
| 8.16 | B.6: applicants table for failed applicants | Verify table and lifecycle | ☐ |
| 8.17 | B.7: teacher record only after verification | Verify teacher record creation timing | ☐ |
| 8.18 | B.8/C.2: subscriptions.user_id (generic) | Verify column name and FK | ☐ |
| 8.19 | B.9: Offline payment fields on subscriptions | Verify payment_method, payment_reference, payment_verified_at | ☐ |
| 8.20 | B.10: On-demand matching model | Verify no fixed assignments | ☐ |
| 8.21 | B.11: Surah/Juz enum for homework | Verify surah_juz_ref enum and columns | ✅ kottaby#300 (Tasks 2/5 — `surah_juz_ref` pgEnum + TS enum at 144 members (114 surahs + 30 juz); mirror-parity + 22P02 backstop green; see `docs/curriculum/surah-juz-ref-vocabulary.md`) |
| 8.22 | B.12: One parent per student | Verify single parent_id FK | ☐ |
| 8.23 | B.13: Parent links multiple children | Verify multiple students with same parent_id | ☐ |
| 8.24 | B.14: 7-day link request expiry | Verify expiry logic | ☐ |
| 8.25 | B.15: 15-minute inactivity timeout | Verify auto-offline after 15 min | ☐ |
| 8.26 | B.16: Configurable request handling | Verify teacher.request_preference enum | ☐ |
| 8.27 | B.17: Prorated plan changes | Verify proration logic | ☐ |
| 8.28 | B.18: Admin arbitration for disputes | Verify disputed status and arbitration | ☐ |
| 8.29 | C.1: parent in user_role enum | Verify enum value | ☐ |
| 8.30 | C.3: evaluations.evaluated_id and evaluator_id | Verify both columns and FKs | ☐ |
| 8.31 | C.4: reports.teacher_id removed | Verify column does not exist | ☐ |
| 8.32 | C.5: recitation.session_id (unique, 1:1) | Verify column and unique constraint | ☐ |
| 8.33 | All enums validated | Verify all enums are defined in the Drizzle schema (`backend/db/schema/`) | ☐ |

---

## 9. Launch Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Engineering Manager | | | |
| Dev 1 (Student & Parent) | | | |
| Dev 2 (Teacher Lifecycle) | | | |
| Dev 3 (Matching & Admin) | | | |
| Product Owner | | | |

### Final Launch Criteria

- [ ] All Section 1 (Data Integrity) items verified
- [ ] All Section 2 (Financial Safeguards) items verified
- [ ] All Section 3 (Real-Time Reliability) items verified
- [ ] All Section 4 (Security) items verified
- [ ] All Section 5 (State Machine Invariants) items verified
- [ ] All Section 6 (Performance) targets met
- [ ] All Section 7 (Disaster Recovery) items verified
- [ ] All Section 8 (33 Decisions) verified
- [ ] Drizzle schema in `backend/db/schema/` type-checks (`bun tsgo`)
- [ ] `bun run scripts/validate-mermaid.ts` passes on all planning docs
- [ ] All Milestone 4 tickets completed
- [ ] All 5 sign-offs obtained

**🚀 Launch Approved:** _______ (Date: _______)
