# Requirements — Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade)

**Plan Directory**: `ai/plans/sprint_1/Admin Subscription Management-admin-subscription-management/`
**Outcome Directory**: `ai/plans/sprint_1/Admin Subscription Management-admin-subscription-management/outcome/`
**Ticket**: `docs/planning/TICKETS.md:583-631` ("Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade)" — Owner Dev 1, Milestone 1, 5 SP; Blocked By "Subscription Validity Window & Expiry" — SHIPPED)
**Decision Refs**: B.17 (prorated plan changes), FR-2.7 (admin subscription management), A.5 (audit_logs immutability), INV-B3/INV-B6 (validity window, expiry zeroing)
**Version**: 1.0 · **Date**: 2026-09-17 · **Author**: Spec Plan Generator

## Introduction

Admins must manage student subscriptions after purchase: extend a validity window, renew an expired
subscription into a fresh period, cancel an active subscription while preserving its remaining balance
(this direction is balance-preserving per ticket AC, deliberately asymmetric with expiry which zeroes),
and change plans mid-cycle (upgrade/downgrade) with prorated balance handling. Every action is
admin-gated (`UserRole.Admin`), audit-logged via the A.5 append-only `audit_logs` trail, and goes
through the guarded-single-UPDATE transition pattern that the purchase and expiry surfaces established.

This feature is the last Milestone-1 subscription-lifecycle surface. It consumes EXISTING, verified
infrastructure (subscriptions table, five-member status enum, lane balances, `AuditService.createAuditLog`,
admin gate helpers, Pothos admin scopes) and creates ONLY the lifecycle writer surface — no schema or
enum changes.

**Feature Summary**:
Four admin mutations (`adminExtendSubscription`, `adminRenewSubscription`, `adminCancelSubscription`,
`adminChangeSubscriptionPlan` covering upgrade+downgrade) plus one admin read query, audit-wired and
replay-safe, surfaced in the existing admin student-detail drawer.

### Business Value
Support ops can fix billing mistakes (wrong window, lapsed period, wrong plan) without DB access; every
intervention is reconstructable from the immutable trail (A.5) and visible to the student immediately
(flat lane balances update in-transaction).

### Scope
- **IN**: four admin lifecycle operations (extend/renew/cancel/change-plan — change-plan covers upgrade & downgrade); proration; audit wiring; the admin read query; the admin drawer UI.
  admin UI controls in the student detail drawer; journey + integration + repo/service tests.
- **OUT**: refunds/payment capture (no gateway calls), student-initiated changes, notifications infra,
  new schema columns (no per-subscription sessions-remaining ledger — flat lanes by deliberate design),
  cancelling `pending` (unpaid) rows, suspending subscriptions.

---

## Requirements

### Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the implementing agent, I want a baseline plus persistent outcome tracking, so that new errors are distinguishable from pre-existing ones and no analysis is repeated.

#### Acceptance Criteria
1. WHEN implementation begins THEN the agent SHALL record baselines (`bun tsgo`, `bun biome:check`, lint-service JSON) to `/tmp/baseline-*.{txt,json}` and write `outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the agent SHALL confirm `deferred-items.md` exists at the plan root (this ledger is pre-created by this planning document).
3. WHEN an agent starts any task THEN it SHALL read ALL files in `outcome/` first.
4. WHEN an agent completes a task THEN it SHALL write `outcome/<task-id>-outcome.md` and flip the task checkbox in `tasks.md` to `[x]`.
5. WHEN any file is modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL pass (exit 0) before the next file is touched.
6. WHEN a subtask is marked complete THEN the semantic-review checklist (tenancy, races, env-config, dead code, enums, no plan-artifact references in comments) SHALL be ticked.

### Requirement 0.5: Translation System & Enum Import Compliance

**User Story:** As a developer, I want compile-time-safe i18n and correct enum imports, so errors surface at build time.

#### Acceptance Criteria
1. WHEN a client component renders user-facing text THEN it SHALL use `useAppTranslation(<NamespaceHandle>)` with a handle from `defineNamespace` (`shared/locale/namespaces/<ns>/<ns>.namespace.ts`) — NEVER a string literal, NEVER a call signature, NEVER a `Translation` enum (none exists; verified ABSENT).
2. WHEN a server component reads translations THEN it SHALL use `getTranslations(locale)` (single arg, `@/shared/locale/server`) and select the namespace property, e.g. `getTranslations(locale).subscriptionAdminTranslations`.
3. WHEN a service or script needs translations THEN it SHALL use `getServerTranslations(locale)` (single args — the two-arg form documented in root AGENTS.md is STALE; do not use it).
4. WHEN a GraphQL resolver needs a localized string THEN it SHALL use `await ctx.t("errorsTranslations")` (keyed by `Translations` property name; async).
5. WHEN a new namespace ships THEN all five registration steps SHALL land: `shared/locale/types/<ns>/index.ts` interface, `shared/locale/en/<ns>/index.ts` leaf, `shared/locale/ar/<ns>/index.ts` leaf, `Translations` wiring in `shared/locale/types/message.ts`, and handle creation; PLUS a `shared/locale/<ns>-namespace.parity.test.ts` parity test SHALL exist.
6. WHEN an enum is used in a runtime expression (casts, conditionals, payloads) THEN it SHALL be a VALUE import, never `import type`.
7. WHEN comparing subscription statuses THEN comparisons SHALL use `SubscriptionStatus.<Member>` — never string literals.

### Requirement 1: Extend Subscription Validity Window (INV-B6)

**User Story:** As an admin, I want to extend a subscription's end_date, so that a student gets more time for sessions they already paid for.

#### Acceptance Criteria
1. WHEN an admin extends an `active` subscription by a positive number of days THEN the system SHALL set `end_date = end_date + days` atomically, keep `status = 'active'`, and stamp `updated_at`.
2. WHEN the extension lands THEN the system SHALL write exactly ONE `audit_logs` row with `actor_id = ctx.user.id`, `action_type = AuditActionType.Update` (`'update'` — pinned by the deferred census row D-001 in `test/workflows/admin/audit-completeness.catalog.ts`), `entity_type = 'subscription'`, `entity_id = <subscriptionId>`, `details` carrying `{ previousEndDate, newEndDate, addedDays }` (ISO strings + integer only), inside the same transaction.
3. IF the subscription is not `active` (pending/cancelled/suspended/expired) THEN the system SHALL reject with 403/422-equivalent localized denial and write ZERO audit rows.
4. IF `days <= 0` or `end_date + days` exceeds `MAX_INTERVAL_DAYS` after start THEN the system SHALL reject with a localized validation error.
5. WHEN a second identical extend request replays (same tx retry, double-submit) THEN the system SHALL NOT double-extend: the guarded transition record makes the second match zero rows and the service SHALL surface an idempotent conflict, not a second window shift.

#### Additional Details
- **Priority**: High · **Complexity**: Low
- **Dependencies**: REQ-0/REQ-0.5, admin gate helpers
- **Assumptions**: extend applies to ACTIVE rows only; renewing an expired row is REQ-2's job.

### Requirement 2: Renew Expired Subscription

**User Story:** As an admin, I want to renew an expired subscription into a fresh period, so that a returning student resumes service without re-paying online.

#### Acceptance Criteria
1. WHEN an admin renews an `expired` subscription THEN the system SHALL create a NEW `subscriptions` row (same user, same plan snapshot) with `status='active'`, `start_date=now`, `end_date=now + plan.interval_days`, `payment_method=null`, `payment_reference=null`, set within ONE transaction.
2. WHEN the new period is created THEN the system SHALL credit the owner's lane with the plan's full `session_count` via `StudentRepository.creditLaneBalance(...)` and insert the `student_subscriptions` junction row, all in the same transaction.
3. WHEN renewal lands THEN the system SHALL write one audit row `action_type='create'`, `entity_type='subscription'`, `entity_id=<newSubscriptionId>`, `details={ renewedFromSubscriptionId, planId, creditedSessions, intervalDays }`.
4. IF the source subscription is not `expired` THEN the system SHALL reject (active rows take extend, pending rows are payment-owned) with a localized denial and zero writes.
5. WHEN a duplicate renew for the same source subscription arrives (retry, double submit) THEN the system SHALL replay safely: an idempotency claim keyed to `renew:<sourceSubscriptionId>` in the EXISTING `subscription_purchase_idempotency` table SHALL block the second create; the second call SHALL return the first result.
6. WHEN the source row's plan has `balance_lane IS NULL` THEN renewal SHALL fail closed (fail-closed lane precedent from purchase).

#### Additional Details
- **Priority**: High · **Complexity**: Medium
- **Dependencies**: REQ-1, lane crediting helpers, idempotency repo
- **Assumptions**: renew preserves the plan snapshot at renew time (fresh read of the plan row).

### Requirement 3: Cancel Subscription (Balance-Preserving)

**User Story:** As an admin, I want to cancel an active subscription without wiping the student's balance, so that an account adjustment doesn't destroy paid value (deliberate asymmetry with expiry zeroing).

#### Acceptance Criteria
1. WHEN an admin cancels an `active` subscription THEN the system SHALL flip `status` to `'cancelled'` via a guarded single UPDATE (`WHERE id AND status='active'`), stamp `updated_at`, and NOT touch any lane balance.
2. WHEN the cancel lands THEN the system SHALL write one audit row with `action_type = AuditActionType.Suspend` (`'suspend'` — pinned by census D-001; the enum has no `cancel` member and the vocabulary is fixed), `entity_type='subscription'`, `details={ fromStatus: 'active', toStatus: 'cancelled', reason?: <≤200 chars> }`.
3. IF the subscription is not `active` THEN the system SHALL reject with a localized denial and zero writes/no audit row.
4. WHERE the student later reads their subscription list (`mySubscriptions`) THEN the cancelled row SHALL still appear with `status='cancelled'` and the lane balance SHALL be unchanged.
5. IF the expiry sweep runs after cancellation THEN the cancelled row SHALL be unaffected (sweep only flips `active`), and the preserved lane is NOT zeroed as a result of the cancel itself.

#### Additional Details
- **Priority**: High · **Complexity**: Low
- **Dependencies**: REQ-1
- **Assumptions**: no refund logic (financial reversals are the withdrawn/admin-finance surface, out of scope here).
- **Note**: `zero-laneIfNoCoveringSubscription` treats `cancelled` as NON-covering — so if a separate expired sub is later swept, the cancel-preserved lane could zero when no other sub covers it. This matches existing expiry semantics: cancellation preserves; subsequent expiry of ANOTHER covering sub may still zero. Documented here to avoid ambiguity at review.

### Requirement 4: Upgrade / Downgrade Plan with Proration (B.17)

**User Story:** As an admin, I want to change a student's plan mid-cycle, so that plan fit changes are effective immediately without losing or double-crediting value.

#### Acceptance Criteria
1. WHEN an admin upgrades or downgrades an `active` subscription to a different ACTIVE plan sharing the SAME `balance_lane` THEN the system SHALL compute prorated carry-over as `carrySessions = round( remainingLaneSessions × (oldPlan.price / oldPlan.session_count) / (newPlan.price / newPlan.session_count) )`, clamped to `[0, MAX_SESSION_COUNT]`, using decimal-string-safe math (no float coercion).
2. WHEN the plan change is an UPGRADE (new plan unit value ≥ old) THEN the credited sessions SHALL be `carrySessions` added on top of the new plan's full `session_count`.
3. WHEN the plan change is a DOWNGRADE (new plan unit value < old) THEN the system SHALL credit the new plan's full `session_count` only and the excess remaining value SHALL be forfeited (per ticket AC: downgrade forfeits).
4. WHEN the change commits THEN the system SHALL atomically (one tx): zero/clear the old lane's remaining contribution via lane adjustment, create a NEW active subscription row for the new plan (`start=now`, `end=now+newPlan.interval_days`), insert the junction row, credit the new lane, and write audit row(s).
5. WHEN audited THEN the system SHALL write ONE audit row `action_type='override'`, `entity_type='subscription'`, `entity_id=<newSubscriptionId>`, `details={ direction, fromSubscriptionId, fromPlanId, toPlanId, carrySessions, forfeitedExcess }`.
6. IF the target plan is inactive, has `balance_lane IS NULL`, is the same plan, or has a DIFFERENT lane than the source plan THEN the system SHALL reject with a localized validation error (cross-lane migration is OUT of scope — logged as a deferred item).
7. WHEN a duplicate plan-change fires on the same source subscription THEN an idempotency claim `planChange:<sourceSubscriptionId>:<newPlanId>` in `subscription_purchase_idempotency` SHALL make the second call return the first result.

#### Additional Details
- **Priority**: High · **Complexity**: High
- **Dependencies**: REQ-2 idempotency machinery, credit-lane helpers, plan catalog reads
- **Assumptions**: proration reads the student's CURRENT lane balance (flat lanes, no per-subscription remainder — documented design decision from the crediting plan); price is a decimal string (e.g. `"200.00"`) and division uses exact decimal arithmetic.

### Requirement 5: Admin Read Surface (List a Student's Subscriptions)

**User Story:** As an admin, I want to view a chosen student's subscriptions in the student detail drawer, so I can decide which lifecycle action to take.

#### Acceptance Criteria
1. WHEN an admin opens a student's detail drawer THEN a GraphQL query `adminStudentSubscriptions(userId: ID!)` SHALL return that user's subscriptions newest-first with plan snapshot fields.
2. IF the caller is not admin THEN the query SHALL fail with 403 (`FORBIDDEN`) before any DB read.
3. IF `userId` is malformed THEN the service SHALL surface the canonical coercion denial, not a 500.
4. (BOLA check) WHERE results are returned THEN they include ONLY rows whose `user_id` equals the requested id — no cross-user leakage.

### Requirement 6: Audit-Trail Wiring (A.5) — Census Upgrade

**User Story:** As compliance, I want every admin subscription action recorded, so the append-only audit trail is complete and CI-enforced.

#### Acceptance Criteria
1. WHEN the four writer mutations ship THEN `test/workflows/admin/audit-completeness.catalog.ts` SHALL replace the deferred D-001 row (`(future) adminExtendSubscription / adminCancelSubscription`, expected `[Update, Suspend]`) with per-mutation wired rows matching reality.
2. WHEN the journey runs THEN the audit-completeness journey SHALL execute these rows and assert the minted audit row shapes (action type, entity type, entity id, details fields).
3. IF a mutation mints no audit row THEN `backend/db/test/logic/audit/audit-census-drift.test.ts` SHALL fail — this is pre-existing enforcement we wire into, not create.
4. WHEN audit `details` exceeds 2000 chars THEN the existing `truncateDetailsSafely` behavior of `AuditService.createAuditLog` applies (no code change).

### Requirement 7: Authorization Boundary

**User Story:** As the platform, I want strict admin-only gates, so students/teachers/parents cannot self-manage subscriptions.

#### Acceptance Criteria
1. WHEN any of the 5 GraphQL fields (4 mutations + 1 query) is called without authentication THEN the builder SHALL surface `extensions.code = "UNAUTHORIZED"` (401) — via `adminOnlyAuthScopes` from `backend/graphql/shared/admin-prelude.ts`.
2. WHEN called by an authenticated non-admin (student/teacher/parent) THEN the builder SHALL surface `extensions.code = "FORBIDDEN"` (403).
3. WHEN the service is invoked (any path) THEN it SHALL re-assert the admin role via `assertActorAdmin`/`assertActorAdminActive` from `backend/services/admin/admin-gate.helpers.ts` BEFORE any write or transaction (defense in depth, zero writes on denial).
4. WHEN a denial occurs THEN the service SHALL log via `logger.logDomainError` and write NO audit row.

---

### Requirement 8: UX / Navigation — Student Drawer Surface

**User Story:** As an admin, I want subscription actions reachable from the student I'm managing, so I don't hunt a separate directory.

#### Acceptance Criteria
1. WHEN the admin student detail drawer is open THEN a new "Subscriptions" section SHALL render the student's subscriptions via the REQ-5 query.
2. WHEN viewing a subscription row THEN per-status actions SHALL show: active → Extend / Cancel / Change Plan; expired → Renew; pending/cancelled → none (renew is expired-only, cancel is active-only).
3. WHEN the Extend dialog is used THEN it SHALL validate days > 0 client-side and surface server errors via the GraphQLErrorSurface pattern.
4. WHEN the drawer labels render everywhere THEN strings SHALL come from the NEW `subscriptionAdmin` namespace (never hardcoded).
5. NO new sidebar item or top-level route is added in this slice; the surface lives inside the existing `/students` admin directory drawer. (Deferred: a dedicated `/admin/subscriptions` directory page; see deferred-items D2.)

#### Role-Based Access Matrix (this surface)
| Role | Route | Access |
|------|-------|--------|
| Admin | `/students` → drawer | Full (view + all mutations) |
| Teacher / Parent / Student | n/a | none — 403 on fields; UI section simply absent |

### Requirement 9: Journey Test — Admin Lifecycle

1. WHEN the suite `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts` runs THEN it SHALL exercise: extend→audit+window, renew after expiry→new row+recredit, cancel→balance intact+403 denial probe from a student actor, upgrade→prorated credit, downgrade→forfeit path — all through REAL services with committed fixtures and tracked cleanup.
2. WHEN an unauthorized step runs THEN it SHALL be asserted via `catchJourneyError` + localized substrings (never `.rejects.toThrow`).

### Requirement 10: Knowledge Propagation & Docs

1. WHEN implementation completes THEN a canonical doc `docs/billing/subscription-admin-lifecycle.md` SHALL consolidate the transition table, idempotency claims, proration formula, and audit-verbs mapping, and the invariant table producers in `docs/specs/state-machine-invariants.md` §4 SHALL gain the new `active→cancelled` writer entry.

## Non-Functional Requirements

### Performance
- All state transitions SHALL be single guarded UPDATEs or single-tree transactional chains — no N+1 loops when lanes adjust; all repo writes are `tx`-propagated.

### Security
- BOLA: mutations accept subscription ids but the services bound the row to a REAL `ctx.user.id`-admin actor; there is no ownership dimension to bypass (subs are globally admin-visible) — forbidden oracles are still asserted in tests.
- BOPLA: update payloads are explicit field picks inside the repo helpers — no `{ ...input }` spread into `set()`.
- BFLA: REQ-7 (role gate + service re-assertion).
- Audit integrity: every mutation writes one row inside the same transaction; denials write zero rows.

### Reliability / Idempotency
- Renew & plan-change SHALL be idempotency-claim backed (`subscription_purchase_idempotency`), key formats `renew:<sourceId>` and `planChange:<sourceId>:<newPlanId>`.
- Extend and cancel are replay-safe via their guarded WHERE predicates (a replay returns zero rows ⇒ treated as already-applied Conflict with a localized message — no state double-shift).

## Constraints and Assumptions

### Technical Constraints
- No new columns, no new enums, no pgEnum member additions (audit vocabulary is pinned by PRODUCTION_READINESS §1.3.5 / docs/admin/audit-trail.md:117).
- Repo methods use guarded transitions + `RETURNING`; `tx?: DBTransaction` last-param convention; `updatedAt` set explicitly on raw SQL paths.
- Price is a `decimal(10,2)` string; proration math MUST avoid binary float drift (parse to minor units — see plan).
- The existing admin census (`audit-completeness.catalog.ts`) D-001 deferred row for subscription actions MUST be replaced by wired entries (drift test enforcement).

### Business Constraints
- Extent of admin power stops at local rows: NO payment capture/refund, NO notification fan-out (deferred D3), NO cross-lane plan changes (deferred D1), NO brand-new top-level admin page (deferred D2).

### Assumptions
- Every subscription row has at most ONE owner; admins operate on behalf of the student whose id appears on the row.
- Lane balances are flat (deliberately no per-subscription residual ledger — inherited from the crediting plan).
- Renewal target plan = the row's CURRENT plan row, re-read fresh.

## Success Criteria

- [ ] Gherkin ACs in the ticket map 1:1 to passing tests (service unit + repo + journey).
- [ ] 5 new GraphQL fields live in SDL (verified by `generate:gqlSchema` diff), all admin-gated.
- [ ] The audit completeness journey includes and encrypts the four new mutation legs.
- [ ] `bun quality-gate` green; zero new baseline errors.
- [ ] Deferred items ledger — no unresolved ❌/⚠️ entries at final gate.

## Glossary

| Term | Definition |
|------|------------|
| Lane | One of the four student balance columns (`hifz`, `tajweed`, `reviews`, `trial`) the subscription credits |
| Guarded transition | Single `UPDATE ... WHERE status=<expected>` with `RETURNING`; zero rows = replay/no-op |
| Proration | Converting remaining sessions of plan A into sessions of plan B by unit-value ratio (B.17) |
| Claim | Row in `subscription_purchase_idempotency` keyed by an opaque idempotency string |
| Admin gate | GraphQL `$all{authenticated, role:[Admin]}` + service-side `assertActorAdmin` |

---

## Traceability Matrix (Requirements ↔ Tasks)

| REQ | Title (short) | Task(s) |
|-----|---------------|---------|
| REQ-0 | Baseline & protocol | 0 |
| REQ-0.5 | i18n/enum compliance | Per-task QL/IV subtask rails (core: tasks 1, 5, 10) |
| REQ-1 | Extend window | 2 |
| REQ-2 | Renew expired | 3 |
| REQ-3 | Cancel | 4 |
| REQ-4 | Upgrade/Downgrade proration | 5 |
| REQ-5 | Admin read surface | 6 |
| REQ-6 | Audit census wiring | 7 |
| REQ-7 | Authorization | 2-6 (SEC legs), 7 |
| REQ-8 | Drawer UI | 8 |
| REQ-9 | Journey test | 9 |
| REQ-10 | Knowledge propagation | 10 |

(authoritative mapping lives in `tasks.md` rows `_Requirements:`)
