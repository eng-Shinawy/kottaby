# Requirements — Dispute Resolution with Admin Arbitration

<!-- Plan Directory: ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/ -->
<!-- Outcome Directory: ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/outcome/ -->
<!-- Related: plan.md · tasks.md · deferred-items.md -->

## Document Information

- **Feature Name**: Dispute Resolution with Admin Arbitration
- **Ticket**: `docs/planning/TICKETS.md` §"Dispute Resolution with Admin Arbitration" (lines 2509–2561), Dev 3, Milestone 3, 5 pts
- **Blocked By (ticket-level)**: Dual-Confirmation Completion Handshake (24h Timeout) — DEV3-012, shipped (see `docs/sessions/session-lifecycle.md` + `ai/finished_plans/milestone_2_matching_notifications_escrow/dual-confirmation-completion-handshake/`)
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-11
- **Stakeholders**: Students (dispute initiators), Teachers (earning holders), Admin governance (arbiters)

## Introduction

The platform completes sessions via a dual-confirmation handshake: the teacher marks complete and, on student confirmation, the held session fee is consumed and the teacher's wallet is credited. Decision **B.18** (`docs/specs/open-decisions-and-gaps.md:177-181`) then grants the student a recourse: after dual confirmation, the student may dispute the session; the session enters `disputed`; an admin reviews the case (report, homework, evaluations, audit trail) and issues a **binding** arbitration decision — refund, partial refund, or uphold — with every decision recorded in `audit_logs` (A.5).

The codebase already ships the **pre-completion** dispute surface (DEV3-012/004): a participant can open a dispute on a `scheduled | started` session (hold frozen), and an admin can resolve it into `cancelled` (same-lane refund of the hold) or `completed` (hold consumed, no wallet credit) via `resolveSessionDispute`. This ticket implements the explicitly deferred sibling: **post-confirmation** disputes whose escrow is already consumed and whose wallet is already credited — plus their financial reversal, notifications, and admin review surface.

### Feature Summary

Post-confirmation student disputes with binding three-outcome admin arbitration (refund / partial refund / uphold), compensating wallet ledger entries, admin case review, notifications, and audit logging.

### Business Value

- Trust & safety: students have a credible post-facto recourse; admins exercise binding discretion grounded in evidence.
- Financial correctness: reversals honor INV-W1/W2/W6/W8 (wallet non-negativity, immutable ledger, compensating rows).
- PRODUCTION_READINESS §2.4 (`docs/planning/PRODUCTION_READINESS.md:104-113`) and item 8.28 (`:335`) gate launch on this feature.

### Scope

**In scope**
- Student-only dispute opening on post-completion sessions (dual confirmation done, escrow consumed, wallet credited): `completed → disputed`.
- Admin arbitration of post-confirmation disputes with exactly three outcomes: **Refund**, **Partial Refund**, **Uphold** — all landing the session back on `completed` with distinct financial side effects, one `override` audit row each.
- A discriminated arbitration surface: disputed rows with `fee_held = true` keep the shipped `Cancel | Complete` vocabulary; disputed rows with `fee_held = false` (consumed escrow) accept only `Refund | PartialRefund | Uphold`.
- Admin case-review read surface: session detail, session report (incl. `studentRatingByTeacher`), homework, recitation record, and the session-scoped audit trail.
- Notifications: admins notified on dispute open; both participants notified on arbitration resolution (post-confirmation flow only).
- Extension of the existing admin `/disputes` UI (classification-aware resolve dialog, partial-amount input, case review) and the student sessions row action.
- Journey tests (`test/workflows/`), 100%-coverage repo tests, service tests, GraphQL tests, locale parity.

**Out of scope (with owners)**
- Pre-completion dispute behavior changes (shipped by DEV3-012; state `scheduled|started → disputed → cancelled|completed` untouched; its no-notification ruling at `docs/sessions/session-lifecycle.md:159` stands).
- Payment-gateway refunds (Paymob/Stripe chargebacks) — no writer for `PaymentStatus.Refunded` exists; remains deferred (`ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/deferred-items.md:63`).
- Withdrawal approval / manual bonus adjustments — owned by the *Admin Financial Auditing* ticket (`docs/planning/TICKETS.md:2564-2615`).
- Admin browse/reschedule/cancel/reassign/join — owned by *Admin Session Governance* (canonical arbitration boundary: `docs/admin/admin-session-governance.md:96-103`).
- Student-rates-teacher evaluation content — owned by the milestone-3 *Student Evaluation Submission (Teacher Rating)* ticket; the case-review read surfaces whatever evaluation rows exist today (the report's `studentRatingByTeacher`) and documents the forward integration point.
- A dispute time-window limit (e.g. "within N days of completion") — no source document defines one; deferred (see `deferred-items.md`).

## Requirements

### Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an AI agent or developer, I want to establish an error baseline before implementation and track outcomes persistently, so that I can distinguish new issues from pre-existing ones and avoid repeating past research.

#### Acceptance Criteria

1. WHEN implementation begins THEN system SHALL record baseline error counts (`bun tsgo 2>&1 | grep "error TS" | wc -l`, `bun biome:check` warnings, `bun run scripts/lint-service.ts --json --id baseline`) into `/tmp/baseline-*.txt`.
2. WHEN implementation begins THEN the deferred-items ledger SHALL exist at `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/deferred-items.md`.
3. WHEN an executing agent starts any task THEN it SHALL read ALL existing files in `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/outcome/`.
4. WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` and flip the task checkbox `[ ]` → `[x]` in `tasks.md`.
5. WHEN any file is modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 before proceeding; the agent SHALL also complete the semantic review checklist (race conditions, env-config, deferred items, cross-layer, enums) that the script cannot check.

### Requirement 0.5: Translation System & Enum Import Compliance

**User Story:** As a developer, I want compile-time type-safe translations and correct enum imports, so that i18n/type errors surface at build time.

#### Acceptance Criteria (verified against the shipped system)

1. WHEN a client component renders user-facing text THEN it SHALL use `useAppTranslation(Sessions)` with a namespace handle from `shared/locale/namespaces/registry.ts` (the handle is exported as `Sessions` from `shared/locale/namespaces/sessions/sessions.namespace.ts:4` and imported from the `@/shared/locale` barrel — verified consumer: `frontend/views/admin/disputes/AdminDisputesContainer.tsx:12,65`) — NOT a string literal and NOT a `Translation` enum (no such enum exists; type schema is `shared/locale/types/message.ts:21-41`).
2. WHEN translation content is accessed THEN it SHALL use property access (`t.someKey`), never function calls (`t('key')`).
3. WHEN a server component renders user-facing text THEN it SHALL use `await getTranslations(locale)` (single arg) and access content as `t.sessionsTranslations.someKey`.
4. WHEN a GraphQL resolver returns user-facing text THEN it SHALL use `ctx.t("errorsTranslations")`-style namespace loaders bound to `ctx.locale` (pattern: `backend/graphql/shared/admin-prelude.ts:31-33`).
5. WHEN a new namespace is needed THEN its trio SHALL be created under `shared/locale/{types,en,ar}/<ns>/` and registered in `shared/locale/namespaces/registry.ts:27-47`, and its `*-namespace.parity.test.ts` SHALL pass.
6. WHEN an enum is used in a runtime expression (cast, comparison, object literal) THEN it SHALL be imported as a value import, never `import type`.

### Requirement 1: Post-Confirmation Dispute Opening (Student)

**User Story:** As a student, I want to dispute a session after dual confirmation, so that an admin can arbitrate a session I consider unsatisfactory despite my earlier confirmation.

#### Acceptance Criteria

1. WHEN the confirmed student of a session submits a dispute with a required reason THEN the system SHALL set `session.status = 'disputed'`, persist `dispute_reason` and `disputed_at`, and return the updated session.
2. IF the session is not `completed`, OR lacks a student confirmation stamp (`confirmed_by_student_at`), OR still holds its fee (`fee_held = true`) THEN the system SHALL reject with `SESSION_INVALID_TRANSITION` (via the shared miss classifier).
3. IF the caller is not the session's student THEN the system SHALL fail oracle-collapsed with `SESSION_NOT_FOUND` (non-participants must not learn disputed-state existence).
4. WHEN the transition write runs THEN it SHALL be ONE guarded `UPDATE ... WHERE status='completed' AND confirmed_by_student_at IS NOT NULL AND fee_held=false AND student_id=<caller>` — exactly-once; a concurrent duplicate submission gets the state-conflict classification, never a second row effect.
5. WHEN the reason is empty/whitespace or exceeds 500 chars THEN the system SHALL reject with `ValidationError` using the existing `normalizeRequiredReasonText` guard (`backend/services/classes/session-lifecycle.guards.ts:137`).
6. WHEN a post-confirmation dispute opens THEN zero audit rows SHALL be written (dispute opening is a participant action; mirroring the shipped pre-completion behavior) and the escrow/wallet state SHALL remain untouched until arbitration.

#### Additional Details
- **Priority**: High · **Complexity**: Medium
- **Dependencies**: DEV3-012 confirmation columns (`confirmed_by_student_at`, `fee_held`) — shipped.
- **Assumptions**: Ticket language binds post-confirmation disputing to the student; teachers retain only the shipped pre-completion dispute path.

### Requirement 2: Arbitration Outcome — Full Refund

**User Story:** As an admin, I want to resolve a post-confirmation dispute as a full refund, so that the student is made whole and the teacher's earning is reversed.

#### Acceptance Criteria

1. WHEN an admin resolves a post-confirmation (`fee_held = false`) disputed session with `Refund` THEN the system SHALL set `session.status='completed'`, persist `resolution_note`/`resolved_at`, debit the teacher wallet by the full `session.fee`, and credit the student's originally-held balance lane by one session credit — all in ONE database transaction.
2. WHEN the teacher wallet balance is insufficient for the debit THEN the system SHALL fail closed (zero financial writes, session remains `disputed`) with the existing `WALLET_INSUFFICIENT_FUNDS` error class.
3. WHEN the teacher wallet or its earning row is unreachable THEN the system SHALL reject without partial writes (transaction rollback).
4. IF the recorded provenance lane (`held_balance_lane`) is NULL (never-held defensive case) THEN the student credit leg SHALL be skipped as a no-op, mirroring `refundHeldLaneToProvenance` semantics (`backend/services/classes/session-lifecycle.transitions.ts:222`); the teacher debit still applies.
5. WHEN the refund commits THEN exactly ONE `audit_logs` row with `action_type='override'`, `entity_type='session'`, and serialized details `{resolution:"Refund", refundAmount, notePresent}` SHALL be written in the same transaction.

#### Additional Details
- **Priority**: High · **Complexity**: High (financial atomicity)
- **Dependencies**: REQ-1; wallet repo primitives; provenance lane column (`backend/db/schema/classes/session.ts:63-65`).
- **Assumptions**: Student compensation unit is the session credit (integer lanes, INV-B1) — see plan decision D-4.

### Requirement 3: Arbitration Outcome — Partial Refund

**User Story:** As an admin, I want to partially refund a disputed session, so that the student is compensated while the teacher retains a fair share of the earning.

#### Acceptance Criteria

1. WHEN an admin resolves a post-confirmation disputed session with `PartialRefund` and a `partialAmount` string `0 < amount < session.fee` THEN the system SHALL set `status='completed'`, debit the teacher wallet by `partialAmount`, credit the student's provenance lane by one session credit, and persist the resolution — one transaction, one audit row.
2. WHEN `partialAmount` is missing, non-numeric, `<= 0`, `>= session.fee`, or carries more fractional precision than the `decimal(10,2)` money convention THEN the system SHALL reject with a localized `ValidationError` (new errors-namespace key `partialRefundAmountInvalid`) BEFORE any write.
3. IF `partialAmount` is supplied with any resolution other than `PartialRefund` THEN the system SHALL reject with `partialRefundAmountInvalid` (no silently ignored money input).
4. WHEN the teacher balance is insufficient for the partial debit THEN the system SHALL fail closed with `WALLET_INSUFFICIENT_FUNDS`; the admin may retry with a lower amount or choose Uphold.
5. WHEN the partial refund commits THEN the audit row details SHALL carry `{resolution:"PartialRefund", partialAmount, notePresent}` — the amount is recorded as the exact decimal string supplied, never re-rounded.

#### Additional Details
- **Priority**: High · **Complexity**: High
- **Dependencies**: REQ-2 primitives; money-unit ruling D-4 (student credit is quantized — one full session credit — because lane balances are integer session credits, INV-B1).
- **Assumptions**: The monetary split between teacher-retained `(fee − partialAmount)` and the platform-absorbed remainder of the restored credit is an accepted arbitration-economics consequence, recorded in the audit row for financial review.

### Requirement 4: Arbitration Outcome — Uphold

**User Story:** As an admin, I want to uphold a disputed session, so that a legitimate completion stands with zero financial disturbance.

#### Acceptance Criteria

1. WHEN an admin resolves a post-confirmation disputed session with `Uphold` THEN the system SHALL set `status='completed'`, persist `resolution_note`/`resolved_at`, and perform ZERO wallet/lane writes.
2. WHEN the uphold commits THEN exactly ONE audit row SHALL be written with details `{resolution:"Uphold", notePresent}`.
3. IF a `partialAmount` accompanies `Uphold` THEN the system SHALL reject per REQ-3.3.

#### Additional Details
- **Priority**: High · **Complexity**: Low
- **Dependencies**: REQ-1 classification.

### Requirement 5: Arbitration Queue & Outcome Classification

**User Story:** As an admin, I want the disputes queue to show both dispute generations with their legal outcome vocabularies, so that I never apply the wrong arbitration semantics.

#### Acceptance Criteria

1. WHEN the admin disputes queue (`adminDisputedSessions`, `backend/graphql/query/classes/session-lifecycle.query.ts:204`) lists rows THEN it SHALL include both held (pre-completion) and consumed (post-confirmation) disputed sessions — no schema change; the existing pinned predicate already covers both.
2. WHEN a disputed row has `fee_held = true` THEN the arbitration mutation SHALL accept only `Cancel | Complete`; WHEN `fee_held = false` THEN only `Refund | PartialRefund | Uphold` — a mismatched resolution SHALL be rejected with the localized errors key `disputeResolutionMismatch` before any write.
3. WHEN the session detail surfaces render a disputed row THEN the client SHALL branch its outcome options on the row's `feeHeld` field (already exposed on the Pothos Session type at `backend/graphql/pothos/classes/session.pothos.ts:174`).

### Requirement 6: Admin Case Review Read Surface

**User Story:** As an admin, I want to review the full dispute case — report, homework, recitation record, evaluations, and audit trail — so that my arbitration decision is evidence-based (ticket AC, `docs/planning/TICKETS.md:2529-2531`).

#### Acceptance Criteria

1. WHEN an admin opens a case for a disputed session THEN the system SHALL return, in one response: the full session detail (incl. `disputeReason`, `disputedAt`, `fee`, `feeHeld`, `heldBalanceLane`), the session report (incl. `studentRatingByTeacher`), the homework row, the recitation record, and the session-scoped audit trail entries.
2. WHERE case artifacts are absent (no report submitted, no homework/recitation) THEN the corresponding fields SHALL be honest `null` — never fabricated placeholders.
3. IF a non-admin role calls the case query THEN the system SHALL reject with the same byte-identical 401/403 denial split as the shipped admin surfaces (`adminOnlyAuthScopes` + service-level admin re-assertion).
4. IF the session id is unknown or not currently/arbitrarily reviewable THEN the system SHALL return a localized not-found error (no oracle leak of internal classification beyond what admins legitimately see via `SessionAdminGovernanceService.getDetail`, `backend/services/classes/session-admin-governance.ts:178`).
5. WHEN student-rates-teacher evaluations ship upstream THEN the case surface SHALL be able to expose them without schema churn (forward integration note only — D-7).

#### Additional Details
- **Priority**: High · **Complexity**: Medium
- **Dependencies**: repo primitives `ReportRepository.findBySessionId` (`backend/db/repo/classes/report.repository.ts:76`), `HomeWorkRepository.findBySessionId` (`backend/db/repo/classes/home-work.repository.ts:74`), `RecitationRepository.findBySessionId` (`backend/db/repo/classes/recitation.repository.ts:93`), `AuditTrailService.listAuditTrail` (`backend/services/admin/audit-trail.service.ts:256`).

### Requirement 7: Dispute Notifications

**User Story:** As an admin, I want to be notified when a post-confirmation dispute opens, and as a participant I want the arbitration outcome notified, so that both sides stay informed without polling.

#### Acceptance Criteria

1. WHEN a post-confirmation dispute opens THEN every admin user SHALL receive one persisted `session_dispute_opened` notification, emitted in-tx and published strictly after commit (pattern: `NotificationEngine.emitForUsers`, `backend/services/notifications/notification-engine.service.ts:79`, then `publishReceipts` :116).
2. WHEN a post-confirmation dispute is arbitrated THEN the session's student AND teacher SHALL each receive one `session_dispute_resolved` notification carrying the outcome, per-recipient locale, post-commit publish.
3. WHEN the same dispute wave re-fires (retry/double-submit) THEN claim keys (`session:<id>:dispute-opened`, `session:<id>:dispute-resolved`) SHALL bound duplicate delivery per the wave convention in `docs/admin/admin-session-governance.md:63-75`.
4. WHEN notification emission fails THEN the arbitration transaction SHALL fail closed for persisted receipts, while real-time publish failures SHALL degrade gracefully (fail-open idempotency: `docs/notifications/realtime-engine.md:147-151`; publish-after-commit contract: `:93,109`).
5. WHEN a PRE-completion (held) dispute opens or resolves THEN ZERO new notification behavior SHALL be introduced there (canonical ruling `docs/sessions/session-lifecycle.md:159` preserved).

#### Additional Details
- **Priority**: Medium · **Complexity**: Medium
- **Dependencies**: two new `NotificationType` members (pgEnum + TS mirror) — the single schema delta of this plan.
- **Assumptions**: "The admin" (ticket wording) = all users with `UserRole.Admin`, resolved via `BroadcastAudienceRepository.resolveAudienceIds` role arm (`backend/db/repo/notifications/broadcast-audience.repository.ts:213-223`.

### Requirement 8: Audit Logging of Arbitration

**User Story:** As a compliance reviewer, I want every arbitration decision immutably logged, so that the platform has a defensible paper trail (A.5).

#### Acceptance Criteria

1. WHEN any arbitration (Refund | PartialRefund | Uphold) commits THEN exactly ONE `audit_logs` row SHALL be written in the SAME transaction via `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82`).
2. WHEN the audit row is written THEN `action_type` SHALL be `override` (the seven-member pgEnum vocabulary is pinned by PRODUCTION_READINESS §1.3.5 and `docs/admin/audit-trail.md:117` — NO new enum value), `entity_type='session'`, `entity_id=sessionId`, `actor_id=<adminId>`.
3. WHEN details are serialized THEN they SHALL contain `{resolution, refundAmount|partialAmount|null, notePresent}` and NEVER the free-text note content (convention: `buildDisputeAuditContract`, `backend/services/classes/session-lifecycle.transitions.ts:299`).
4. IF the arbitration write misses (already resolved, wrong state) THEN ZERO audit rows SHALL be written (denial paths write nothing).
5. WHEN the audit insert fails THEN the whole arbitration transaction SHALL roll back (audit shares caller tx fate).

### Requirement 9: UX — Admin Arbitration Console & Student Dispute Action

**User Story:** As an admin, I want the existing `/disputes` console to handle both dispute generations, and as a student I want a dispute action on my completed sessions, so that the feature is operable without API tooling.

#### Acceptance Criteria

1. WHEN an admin opens `/disputes` (existing; `app/(dashboard)/disputes/page.tsx`, `frontend/views/admin/disputes/AdminDisputesContainer.tsx`) THEN each row SHALL show classification-relevant facts (fee, feeHeld, disputedAt, reason) and the resolve dialog SHALL offer the correct outcome group for that row.
2. WHEN an admin selects `Partial Refund` in the resolve dialog THEN an amount field SHALL appear, be validated client-side (`0 < amount < fee`, two-decimal money), and submit `partialAmount` with the mutation.
3. WHEN an admin opens "Review case" on a disputed row THEN a dialog/panel SHALL render the REQ-6 payload (report, homework, recitation, audit trail) with honest empty states.
4. WHEN a student views a completed, dual-confirmed session row THEN a "Dispute" action SHALL be available and reuse the existing `SessionDisputeConfirmDialog` confirmation pattern, pointed at the new post-confirmation mutation.
5. WHEN any new UI text renders THEN it SHALL come from the extended `sessions` (and, if added, arbitration) locale namespaces in en AND ar, with parity tests green.
6. WHERE the viewport is mobile THEN the dialogs SHALL use the existing responsive dialog geometry already shipped for `/disputes` (no bottom-nav additions).

### Requirement 10: Integrity, Concurrency & Idempotency

**User Story:** As a platform operator, I want arbitration to be race-safe and exactly-once, so that money never moves twice and sessions never double-resolve.

#### Acceptance Criteria

1. WHEN two admins concurrently arbitrate the same disputed session THEN exactly one commit SHALL win (guarded `status='disputed'` writes); the loser SHALL receive the state-conflict classification. (Race precedent: `test/workflows/sessions/session-state-machine.journey.test.ts:443-461`.)
2. WHEN a student double-submits a post-confirmation dispute THEN exactly one transition SHALL commit.
3. WHEN a wallet reversal executes THEN it SHALL be a single guarded `UPDATE wallet SET balance = balance - :amount WHERE balance >= :amount` with a compensating `teacher_transaction` row INSERTed in the same tx (INV-W6, INV-W8: amount ≥ 0, immutable ledger).
4. WHEN the arbitration flow re-reads row state THEN it SHALL read it inside its own transaction (no TOCTOU drift between classification and write).
5. WHEN notification claim keys are derived THEN they SHALL include the session id and wave kind only (deterministic, resolvable across retries).

## UX/Navigation Requirements (MANDATORY)

The role model is a 4-member enum (`backend/enum/users/user-role.enum.ts:5-10`: `Admin`, `Teacher`, `Student`, `Parent`) — there is NO permission-string system; gating is role-based (`withPageAuth`, `frontend/lib/auth/withPageAuth.ts:67`, and GraphQL `$all{authenticated, role:[Admin]}`).

### New Routes & Role-Based Access

| Route | Purpose | Gate | Roles with Access |
|-------|---------|------|-------------------|
| `/disputes` (EXISTING) | Admin arbitration queue + resolve dialog + case review | `withPageAuth({roles:[UserRole.Admin]})` | Admin only |
| sessions dashboard (EXISTING student surface) | Row-level "Dispute" action becomes eligible on post-confirmation rows | client session auth | Student (own rows) |

No new route is created; no sidebar edit is needed — the `dashboard.disputes` nav entry and label key already exist (`frontend/views/dashboard/nav/navItems.ts:140-164`, `shared/locale/{en,ar}/dashboard/index.ts:19`).

### Per-Audience Rendering

| Audience | Sees |
|----------|------|
| Admin | Full queue (both dispute generations), outcome dialog, case review, partial-amount input |
| Student | Own sessions; dispute action only on dual-confirmed `completed` rows; resolution notification |
| Teacher | No dispute surface change (pre-completion dispute path unchanged); resolution notification |
| Parent | Nothing (no parent visibility into disputes) |

## Cross-Actor Workflow Scenarios (Journeys)

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Student | `student` | open post-confirmation dispute on own completed session | arbitrate; dispute others' sessions; dispute still-held sessions (that path is open to both participants already) |
| Admin | `admin` | list disputed sessions, review a case, arbitrate (Refund/PartialRefund/Uphold on consumed rows) | open disputes; bypass the governance-clean re-assertion |
| Teacher | `teacher` | observe resolution notification | arbitrate; dispute a completed session |

### Journey J1 — Refund arbitration (happy path)

1. Student → disputes completed dual-confirmed session (reason) → `status=disputed`, `disputeReason`/`disputedAt` set → all admins notified (`session_dispute_opened`).
2. Admin → lists queue → row visible with `feeHeld=false`.
3. Admin → reviews case → report + homework + recitation + session audit trail returned.
4. Admin → resolves `Refund` → `status=completed`, teacher wallet debits `fee`, student provenance lane +1, ONE `override` audit row → student + teacher notified (`session_dispute_resolved`, outcome=refund).

### Journey J2 — Partial refund

Steps 1–3 as J1. 4. Admin → resolves `PartialRefund` amount `"15.00"` on a `"25.00"` fee → wallet debits `"15.00"`, student lane +1, audit details carry the exact amount string.

### Journey J3 — Uphold

Steps 1–3 as J1. 4. Admin → resolves `Uphold` → `status=completed`, ZERO financial writes, audit row notes `resolution=Uphold`; participants notified of the uphold.

### Cross-Actor EARS Criteria (observer perspective + denials)

- WHEN the student disputes a dual-confirmed session THEN the system SHALL move it to `disputed` AND surface it in the admin queue AND notify every admin.
- WHEN the admin resolves `Refund` THEN the system SHALL decrement the teacher wallet AND restore the student's credit AND notify both participants.
- IF the teacher attempts to dispute a completed session THEN the system SHALL reject with `SESSION_NOT_FOUND` (oracle-collapsed).
- IF a non-admin resolves any dispute THEN the system SHALL reject with the byte-identical 403 split of the admin surfaces.
- IF the admin selects `Complete` on a consumed-fee row (or `Refund` on a held row) THEN the system SHALL reject with `disputeResolutionMismatch`.
- IF the teacher wallet lacks funds for the refund THEN the system SHALL leave the session `disputed` and reject with `WALLET_INSUFFICIENT_FUNDS`.

## Non-Functional Requirements

### Performance
- WHEN the admin queue paginates THEN the existing `adminDisputedSessions` clamp (1..50, default 25) SHALL be preserved unchanged.
- WHEN the case review executes THEN it SHALL be one round trip returning all artifacts (no N+1; repo primitives called concurrently where independent).

### Security
- WHEN any arbitration input arrives THEN identity SHALL be derived from server context (`ctx.user.id`), never from client-supplied ids (BOLA/IDOR).
- WHEN admin-only surfaces are hit by non-admins THEN denials SHALL match the byte-identical split pinned by `backend/graphql/test/admin-session-governance.*.test.ts` (401 anonymous, 403 authenticated non-admin).
- WHEN `partialAmount` or free-text enters persistence THEN strict DTO mapping SHALL apply — no `{ ...input }` spread into Drizzle writes (BOPLA).

### Reliability
- WHEN any arbitration leg fails THEN the transaction SHALL roll back entirely — money and status move together or not at all.
- WHEN outcome knowledge exists THEN it SHALL be read before task execution (outcome/ protocol, REQ-0).

## Constraints and Assumptions

### Technical Constraints
- Student balances are integer session-credit lanes (INV-B1) — fractional student refunds are not representable (resolved by plan decision D-4).
- `teacher_transaction` is an immutable append-only ledger with `amount >= 0` (INV-W6/W8) — corrections are compensating rows only.
- `audit_action_type` is a 7-member pgEnum pinned by docs; arbitration reuses `override`.
- `TransactionType` has only `earning | withdrawal | bonus`; the reversal uses the `withdrawal` compensating-row precedent (see plan D-5).

### Business Constraints
- B.18 binds arbitration to POST-confirmation disputes; pre-completion dispute semantics stay byte-stable (canonical arbitration boundary, `docs/admin/admin-session-governance.md:96-103`).
- B.3/B.4: platform-set fees, hold-at-request escrow — arbitration does not re-price sessions.

### Assumptions
- A post-confirmation disputed row's earning transaction exists (confirmCompletionInTx is atomic: `backend/services/classes/session-lifecycle.confirmation.ts:112`).
- `held_balance_lane` remains recorded after escrow consumption (docblock: never rewritten).
- Admin count is small enough that per-admin notification rows are acceptable (existing broadcast infrastructure resolves the audience identically).

## Success Criteria

### Definition of Done
- [ ] All acceptance criteria for REQ-0 … REQ-10 met
- [ ] Journey tests J1–J3 + denials green under `bun run test/scripts/run-test.ts test/workflows/sessions/`
- [ ] 100% branch coverage on new repo/service code; parity tests green
- [ ] `bun quality-gate` green on the final diff; zero new baseline errors
- [ ] PRODUCTION_READINESS §2.4.1–2.4.4 and item 8.28 manually verifiable
- [ ] Deferred-items ledger empty (no ❌/⚠️) before the final quality gate

### Acceptance Metrics
- Arbitration mutation p95 within the session-mutation envelope of `resolveSessionDispute` (single tx, ≤ 4 statements).
- Zero negative `wallet.balance` states under concurrent refund races (DB check + guarded writes).

## Glossary

| Term | Definition |
|------|------------|
| Dual confirmation | Teacher marks complete + student confirms; consumes the escrow hold and credits the teacher wallet (DEV3-012) |
| Held dispute | Disputed row with `fee_held=true` — shipped Cancel/Complete arbitration |
| Consumed dispute | Disputed row with `fee_held=false` — this ticket's Refund/PartialRefund/Uphold arbitration |
| Compensating row | A new append-only `teacher_transaction` that reverses value (INV-W6) — never an UPDATE to an old row |
| Provenance lane | The `held_balance_lane` recorded at booking; refunds always return to it |
| Arbitration surface | The single write path allowed to exit `disputed` rows (canonical boundary ruling) |
| Audit row | Immutable `audit_logs` entry; arbitration writes exactly one `override` row per decision |
