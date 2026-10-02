# Requirements & Specification: Direct Student Onboarding with Offline Payment

> **Feature Name**: Direct Student Onboarding with Offline Payment
> **Target Directory**: `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment`
> **Outcome Directory**: `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/outcome`
> **Version**: 1.0 · **Date**: 2026-09-21 · **Milestone**: M3 (`ai/plans/milestone_3/`)
> **Source Ticket**: `docs/planning/TICKETS.md:2357-2402` (Milestone 3, Dev 3, 5 SP)
> **Decision Refs**: B.9, A.5, FR-10.2, INV-PAY5
> **Blocked by**: Admin CRUD Users/Teachers/Students/Parents (`backend/services/admin/user-management.service.ts:261` — IMPLEMENTED) + Admin Subscription Management (`backend/services/billing/subscription-admin.service.ts:159,299,400,488` — IMPLEMENTED)
> **Ground truth**: `outcome/exploration-ground-truth.md` (this plan's seed knowledge file — all `path:line` claims below trace to it)

---

## 1. Executive Summary & Problem Statement

**Feature Summary:** Ship ONE atomic admin surface that manually registers a student end-to-end: a `users` row (`role='student'`), a `students` row with a unique `handshake_code`, an optional parent association (`students.parent_id` set), a directly-activated subscription carrying offline payment evidence (`payment_method ∈ {offline_cash, bank_transfer, scholarship}`, admin-provided `payment_reference`, `payment_verified_at = now`, `status='active'`), an immediately credited session balance, a `student_subscriptions` junction row, and one append-only `audit_logs` row — all inside ONE transaction, with ZERO `student_payments` rows (the offline bypass, INV-PAY5).

**Problem Statement:** Every student-creation path today stops short of a usable student. Public self-registration (`backend/services/auth/registration.service.ts:80`) mints the user+student+trial but leaves subscription activation to the gateway purchase flow (`backend/services/billing/subscription-purchase.service.ts:486`), which creates a `pending` subscription plus a `student_payments` row and waits for a Paymob webhook. The admin `createUser` path (`backend/services/admin/user-management.service.ts:261`) creates the identity but has NO plan/payment/parent fields (`backend/types/admin/admin-user.types.ts:209-217`). Families who pay cash at the office, by bank transfer, or via scholarship therefore have NO sanctioned path into the platform — the admin cannot record the collected money, the student gets no session balance, and the payment evidence has nowhere to live.

**Business Value:** Completes FR-10.2's admin-registration pillar and the Workflow-04 family funnel for offline-paying users (Egypt-first market where cash/transfer dominate). Analytics already anticipates this flow — `OFFLINE_ACTIVATION_GATEWAYS` and `countOfflineActivationsImpl` count exactly these subscriptions (`backend/db/repo/admin/platform-analytics-query-helpers.ts:112-117,458-479`) — so activating students offline makes existing dashboards truthful. Both blocked-by dependencies are verified implemented; this ticket composes them.

**Scope:**

| IN scope | OUT of scope (explicit) |
|---|---|
| Admin-supplied profile → `users` + `students` rows (unique handshake_code) | Teacher assignment (named in FR-10.2 prose but ABSENT from ticket AC at `docs/planning/TICKETS.md:2369-2394` — deferred) |
| Optional parent association (`students.parent_id`) | Online gateway payments (Paymob checkout path untouched — `backend/services/billing/subscription-purchase.service.ts:486`) |
| Direct subscription activation: `status='active'` + offline payment columns | Public self-registration changes (`registration.service.ts:80` imported-by-reference, never edited) |
| Immediate session balance credit + `student_subscriptions` junction row | Parent self-service handshake link flow (already EXISTS — `parent-link-request.service.ts:168`, untouched) |
| Offline bypass: zero `student_payments` writes (INV-PAY5) | ANY `student_payments` writes (immutable gateway ledger — `backend/db/schema/billing/student-payments.ts:24-46`) |
| One `audit_logs(create)` row per onboarding | Schema/enum changes (ALL columns and enum members verified existing — zero `bun run db push`) |
| One admin-gated GraphQL mutation + admin onboarding dialog UI | Trial grants (admin surface precedent: trial deliberately dormant — `user-management.service.ts:297-302`) |

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 REQ-000 — Baseline & Execution Protocol

**User Story:** As the implementing agent, I follow a fixed execution protocol so the plan's claims are provable from `outcome/` artifacts.

EARS criteria:

1. WHEN implementation begins THEN the agent SHALL record pre-implementation baseline counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) into `outcome/0-baseline-outcome.md`, including the pre-existing modified-file set (`git diff --name-only`).
2. WHEN any task starts THEN the agent SHALL first read the prior `outcome/*.md` files and the deferred-items ledger (`ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/deferred-items.md`, seeded from the repo template), and never re-verify what a prior outcome already proved.
3. WHEN a task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` (summary, files changed, files deliberately NOT changed, verification outputs, cross-file dependencies) and keep tasks.md checkboxes current.
4. WHEN a file is created or edited THEN it SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` with exit 0 BEFORE the task is marked done.
5. WHEN all tasks in a phase complete THEN a semantic review checklist SHALL run against the applicable instruction files (`.agents/instructions/*.instructions.md`) and AGENTS.md files BEFORE the phase checkbox is marked `[x]`.
6. IF an artifact the plan depends on is absent or drifted THEN the agent SHALL record a ❌ ledger row and block dependent tasks — never inline-patch a foreign layer.

**Additional Details:** Priority: mandatory · Complexity: low · Dependencies: none · Assumptions: exploration report (`outcome/exploration-ground-truth.md`) is accurate at plan time.

### 2.2 REQ-001 — i18n & Enum Import Compliance

**User Story:** As a developer, I want every user-facing string resolved through the compile-time locale system and every enum used as a value import, so the app stays fully localized and type-safe.

EARS criteria:

1. WHEN a client component renders copy THEN it SHALL use a namespace HANDLE via property access — `useAppTranslation(AdminStudents)` with `AdminStudents` imported from `@/shared/locale/namespaces/adminStudents` (verified pattern: `useAppTranslation(AdminUsers)` + import from `@/shared/locale/namespaces/adminUsers`, `frontend/views/admin/users/directory/AdminUsersDirectoryContainer.tsx:47-50`); string-literal namespaces and any Translation-enum access form are FORBIDDEN.
2. WHEN a server component needs copy THEN it SHALL call `getTranslations(locale).adminStudentsTranslations` — ONE argument, property access (verified: `app/(dashboard)/admin/users/page.tsx:24-27`); two-argument forms are FORBIDDEN. Server pages mount client containers label-free (interpolation closures cannot cross the server→client boundary).
3. WHEN a service or resolver produces a user-facing error THEN it SHALL resolve copy via `getServerTranslations(locale)` (ONE argument, full tree) from `@/shared/locale/server-graphql`, or `ctx.t("errorsTranslations")` in resolvers — never hardcoded strings.
4. WHEN runtime enum values are used THEN they SHALL be VALUE imports of enum members (`PaymentGateway.OfflineCash`, `SubscriptionStatus.Active`, `SubscriptionCreditLane`, `AuditActionType.Create`, `UserRole.Admin` from `backend/enum/**`) — never string literals.
5. WHEN new locale keys land THEN `en` and `ar` leaves SHALL have exact key parity and the per-namespace parity test SHALL pass (precedent: `shared/locale/adminUsers-namespace.parity.test.ts`).
6. WHEN tests assert error copy THEN they SHALL assert translated substrings from `getServerTranslations("en").errorsTranslations` — never raw keys.
7. WHEN logging domain rejections THEN the agent SHALL use `logger.logDomainError(msg, { code, entity, entityId })` — never `console.*`.

**Additional Details:** Priority: mandatory · Complexity: low · Dependencies: REQ-000 · Assumptions: the existing `adminStudents` / `subscriptionAdmin` / `errors` namespaces are extended (or a new `studentOnboarding` namespace minted following the 4-file + parity-test anatomy — the name chosen by plan §5.5 and tasks.md 1.2).

### 2.3 REQ-010 — Direct Student Registration (profile + users/students rows)

**User Story:** As an Admin, I supply a student profile so the platform gets a complete student identity in one atomic step.

EARS criteria:

1. WHEN the mutation receives a student profile (full name, email, phone) THEN the service SHALL create a `users` row with `role = UserRole.Student` (enum member `student`, `backend/db/schema/users/users.ts:19`) and a `students` row with all four balance columns zeroed (`backend/db/schema/students/students.ts:24-27`).
2. WHEN the `students` row is created THEN it SHALL carry a unique `handshake_code` minted through the EXISTING `createStudentWithHandshakeRetry` seam (`backend/services/shared/user-provisioning.helpers.ts:118`; retry budget `HANDSHAKE_RETRY_LIMIT = 5` at `:30`; code format `KSB-` + 8 hex via `generateHandshakeCode` at `:43`) — NO new handshake generator.
3. WHEN an admin surface creates the student THEN the system SHALL NOT grant a free trial (admin-surface precedent: trial grant is deliberately guarded to non-admin entry points, `user-management.service.ts:297-302`); `subscription_status` stays `'none'` until REQ-012 activates the direct subscription.
4. IF the submitted email already exists in `users` (`users_email_unique`, `users.ts:44`) THEN the system SHALL reject the whole mutation with a localized `ConflictError` (duplicate-email path precedent `user-management.service.ts:261-331`) and commit nothing.
5. IF any required profile field is missing or malformed THEN the system SHALL reject with localized field errors BEFORE any write (no partial identities).
6. WHEN creation succeeds THEN the created user SHALL be immediately able to authenticate (no email verification gate on admin-created identities — same as `adminCreateUser`).

**Additional Details:** Priority: high · Complexity: medium · Dependencies: REQ-000, REQ-001, REQ-020 · Assumptions: password strategy reuses the admin-create precedent (system-set initial credential; no plaintext in any log or audit payload).

### 2.4 REQ-011 — Parent Association (optional)

**User Story:** As an Admin, I optionally link the new student to an existing parent so the parent gains monitoring access immediately.

EARS criteria:

1. WHEN the mutation includes `parentId` THEN the service SHALL set `students.parent_id` to that user's id (column verified: `students.ts:32`, FK `students_parent_fk` ON DELETE SET NULL) and ensure a `parents` row exists for that user (`backend/db/schema/parents/parents.ts:11`), reusing the link semantics of `StudentRepository.linkParentIfUnlinked` (`backend/db/repo/students/student.repository.ts:373`).
2. WHEN `parentId` is omitted THEN the system SHALL create the student unlinked (`parent_id` NULL) and the mutation SHALL succeed — the field is optional by design.
3. IF `parentId` references a user whose `role` is NOT `parent` THEN the system SHALL reject with a localized validation error BEFORE any write (no student gets silently linked to a teacher/admin/student identity).
4. IF `parentId` references a nonexistent user id THEN the system SHALL reject with a localized NotFound error and commit nothing.
5. WHEN the link commits THEN the parent's read-only monitoring access SHALL work WITHOUT any further ceremony — the monitoring queries already gate on `students.parent_id` (`docs/parents/monitoring-portal.md`, requireLinkedChild denial oracle) and the parent-link write path is the SAME one the existing self-service flow settles on.
6. WHEN `parentId` is supplied THEN the association SHALL NOT create a handshake-link audit state machine entry — the self-service handshake flow (`parent-link-request.service.ts:168`) is OUT of scope and its rows are never touched.

**Additional Details:** Priority: high · Complexity: low · Dependencies: REQ-010 · Assumptions: monitoring read path needs zero new code (verified read-only portal, five SDL queries, constant-403 denial oracle).

### 2.5 REQ-012 — Direct Subscription Activation with Offline Payment

**User Story:** As an Admin, I activate a plan immediately with offline payment evidence so the student is billable and enrolled without any gateway round-trip.

EARS criteria:

1. WHEN the subscription activates THEN the system SHALL create a `subscriptions` row with `status = SubscriptionStatus.Active` (direct `none→active`, bypassing the gateway's `pending` stage), `startDate = now`, `endDate = now + plans.interval_days` (`plans.ts:28`), inside the SAME transaction as REQ-010/011.
2. WHEN recording the payment evidence THEN the row SHALL carry `payment_method` = the submitted offline member, `payment_reference` = the admin-provided string (varchar(255), `subscriptions.ts:42`), and `payment_verified_at = now` (`subscriptions.ts:43`) — the subscriptions table already documents itself as the offline-collection register (`subscriptions.ts:12-14` docstring).
3. IF `payment_reference` is present THEN it SHALL satisfy the partial unique index `subscriptions_payment_reference_unique` (`subscriptions.ts:54-56`) — a second activation reusing the same reference SHALL fail with a localized ConflictError (idempotency guard).
4. IF `paymentMethod` is NOT one of `PaymentGateway.OfflineCash` / `PaymentGateway.BankTransfer` / `PaymentGateway.Scholarship` (TS enum `backend/enum/billing/payment-gateway.enum.ts:10-19`; pgEnum `backend/db/schema/enums.ts:56-66`) THEN the system SHALL reject BEFORE any write — online members (`paymob` et al.) are invalid here: they belong exclusively to the gateway purchase lifecycle.
5. IF `planId` references a nonexistent plan THEN the system SHALL reject with a localized NotFound error and commit nothing.
6. WHEN activation succeeds THEN the service SHALL also insert the `student_subscriptions` junction row (`backend/db/schema/billing/student-subscriptions.ts:20`, composite PK) in the same transaction, reusing `insertAdminPeriodSubscription`-style settlement (`backend/services/billing/subscription-admin-settle.helpers.ts:43`) as a template but with the offline payment columns SET (that helper leaves them NULL for the comp case).
7. WHEN a scholarship is recorded THEN the flow is identical (no price column is mutated on the plan; the subscription simply records `scholarship` as the method — pricing stays on `plans`).

**Additional Details:** Priority: high · Complexity: high · Dependencies: REQ-010, REQ-011, REQ-020 · Assumptions: NO schema change — all three offline members and all three columns already exist (verified); `extend`/`renew`/`changePlan` (`subscription-admin.service.ts:159,299,488`) are imported-by-reference as precedents only.

### 2.6 REQ-013 — Immediate Session Balance Credit

**User Story:** As the newly onboarded Student, I receive my plan's session balance immediately so I can book sessions without waiting for any settlement.

EARS criteria:

1. WHEN the subscription activates THEN the student's plan-lane balance SHALL increase by `plans.session_count` (`plans.ts:25`) in the SAME transaction — the `students.balance_<lane>` column selected by `plans.balance_lane` (`plans.ts:29`; lane members `backend/enum/billing/subscription-credit-lane.enum.ts:9-12`).
2. WHEN crediting THEN the write SHALL go through `StudentRepository.creditLaneBalance` (`backend/db/repo/students/student.repository.ts:440`) or an equivalent single guarded SQL increment — never a read-modify-write race.
3. IF `plans.balance_lane` is NULL THEN the system SHALL fail closed: reject the activation with the localized `PLAN_LANE_UNCONFIGURED`-class error (the plans docstring already quarantines laneless plans from purchase for this exact reason, `plans.ts:13-17`) and roll back everything.
4. WHEN the transaction commits THEN the credited amount SHALL equal exactly one `session_count` — no proration, no trial top-up, no double credit.
5. IF any later step in the transaction fails THEN the credit SHALL vanish with it (single-transaction atomicity — see §2.12).

**Additional Details:** Priority: high · Complexity: medium · Dependencies: REQ-012 · Assumptions: the payment-coupled `applyActivationCredit` (`backend/services/billing/subscription-activation-credit.helpers.ts:101`) is NOT reused — it is hard-wired to the purchase/`student_payments` path; only its lane-resolution helper `subscriptionCreditLaneOf` (`:57`) is a safe shared primitive.

### 2.7 REQ-014 — student_payments Bypass (INV-PAY5)

**User Story:** As the platform owner, I want offline activations provably absent from the gateway ledger so reconciliation stays clean.

EARS criteria:

1. WHEN a direct offline onboarding commits THEN the system SHALL have created ZERO rows in `student_payments` (`backend/db/schema/billing/student-payments.ts:50`) — the bypass is the ONLY consistent design because that table is an immutable gateway ledger (UPDATE/DELETE blocked by triggers, doc `:24-46`; `payment_gateway` NOT NULL at `:64`).
2. WHEN any journey or integration test verifies this flow THEN it SHALL assert the invariant as a row-count delta (zero new `student_payments` rows for the student/subscription) — assertable directly against the table.
3. IF any future change attempts to add a `student_payments` write to the offline path THEN that change SHALL be rejected at review — INV-PAY5 is binding (`docs/specs/state-machine-invariants.md:302`).
4. WHEN reconciliation queries run THEN offline activations SHALL be visible through `subscriptions.payment_method/payment_reference/payment_verified_at` (the `platform-analytics-query-helpers.ts:112-117` offline-activation counters already read exactly these columns).

**Additional Details:** Priority: high · Complexity: low (a non-action, but a tested invariant) · Dependencies: REQ-012 · Assumptions: none.

### 2.8 REQ-015 — Audit Logging

**User Story:** As an auditor, I can reconstruct every manual onboarding from the immutable trail: WHO onboarded WHOM, with WHAT plan and payment method, WHEN.

EARS criteria:

1. WHEN an onboarding transaction commits THEN it SHALL contain EXACTLY ONE new `audit_logs` row written via `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82`) with the `AuditLogWriteContract` shape (`backend/types/contracts/admin-audit.contract.types.ts:22`).
2. WHEN the row is written THEN `actor_id` SHALL be the admin's `ctx.user.id` (never a client-supplied input), `action_type` SHALL be `AuditActionType.Create` (enum `backend/enum/audit/audit-action-type.enum.ts:6-13`; pgEnum members `backend/db/schema/enums.ts:102-110` — no new verb member is minted), and `entity_type` SHALL follow the existing subscription/user audit contract builders (`buildAuditContract` `backend/services/admin/user-management.helpers.ts:334`; `buildSubscriptionAuditContract` `subscription-admin.helpers.ts:354`).
3. WHEN `details` is composed THEN it SHALL be a JSON string ≤ 2000 chars (`audit-logs.ts:40` column limit) carrying ONLY ids/enums/timestamps (e.g. `{ planId, paymentMethod, paymentReference?, parentId?, creditedSessions, subscriptionId, studentUserId }`) — NEVER PII (no names, emails, phone numbers).
4. WHEN any denial path fires THEN ZERO audit rows SHALL be written (write-path-only auditing; denial noise never pollutes the trail).
5. WHEN the row lands THEN it SHALL be append-only forever — the immutability trigger (`audit-logs.ts` doc `:17-21`) is never suspended outside sanctioned test cleanup (`withAuditDeleteTriggersSuspended`, `test/helpers/db-cleanup.ts:83`).

**Additional Details:** Priority: high · Complexity: low · Dependencies: REQ-010, REQ-012, REQ-020 · Assumptions: the anti-drift census (`test/workflows/admin/audit-completeness.catalog.ts` + `backend/db/test/logic/audit/audit-census-drift.test.ts`) is extended in the same change set (REQ-020.6).

### 2.9 Cross-Actor Workflow Scenarios (Journeys)

#### Actor Table

| Actor | Role / Provisioning | CAN do (this ticket) | CANNOT do (this ticket) |
|---|---|---|---|
| **Admin (actor)** | `users.role='admin'` + real `admin` row | Onboard a student (profile + optional parent + plan + offline payment) in one mutation; read back the result through existing admin surfaces | Skip the closed whitelist; supply a non-offline `paymentMethod`; write a `student_payments` row; re-use a duplicate `payment_reference` |
| **Linked Parent (observer)** | `role='parent'` + `parents` row, `students.parent_id` set by this flow | Observe the child immediately in the read-only monitoring portal (`docs/parents/monitoring-portal.md`) | Perform the onboarding mutation; see OTHER students (constant-403 denial oracle) |
| **Onboarded Student (target)** | `role='student'` + `students` row minted by this flow | Log in; observe credited session balance on existing student surfaces | Self-activate subscriptions without payment; call the admin mutation |
| **Teacher (denied)** | `role='teacher'` | — | Call the mutation (FORBIDDEN at scope + service layers) |
| **Parent-other / Student-other (denied)** | real rows, unlinked | — | Call the mutation; observe the onboarded student's data |
| **Anonymous** | no session | — | Call the mutation (UNAUTHORIZED) |

#### Ordered Step List

**Journey J-1 — Cash onboarding (full happy path):**

1. **System** → committed cast via `provisionAdminActor` / `provisionStudentActor` / `provisionParentActor` inside ONE committing `db.transaction` (`test/workflows/helpers/actor-context.ts:88-143`), `TrackedFixtures` registry (`tracked-fixtures.ts:173`), `jrn_<domain>_<uuid8>` prefix.
2. **Admin** → onboarding service with `{ profile, planId, paymentMethod: OfflineCash, paymentReference, parentId: null }` → commits atomically: `users(student)` + `students` (unique handshake, zeroed balances) + `subscriptions(status=active, payment_method=offline_cash, payment_reference=…, payment_verified_at=now)` + `student_subscriptions` junction + lane balance += `session_count` + ONE `audit_logs(Create)`; ZERO `student_payments` rows (REQ-014.2 delta assertion).
3. **Onboarded Student** → `login` succeeds; observes credited balance on the existing student surface.
4. **Admin** → existing `adminStudents` / `adminUserDetail` reads (`backend/graphql/query/admin/admin-students.query.ts:59`, `admin-users.query.ts:97`) show the new row with active-subscription flags and the audit entry under the admin's id.

**Journey J-2 — Bank-transfer + parent association:**

1. **Admin** → same flow with `paymentMethod: BankTransfer`, distinct `paymentReference`, and `parentId = <existing parent actor id>` → all J-1 rows plus `students.parent_id` set.
2. **Linked Parent** → monitoring queries (`docs/parents/monitoring-portal.md`) observe the child with the active subscription — no extra linking step.
3. **Parent-other (unlinked)** → monitoring query for the same student → constant-403 denial; zero leakage.

**Journey J-3 — Scholarship + denial probes:**

1. **Admin** → scholarship onboarding — the leg supplies a unique admin-provided `paymentReference` (e.g. `SCH-<uuid8>`), REQUIRED for all three offline methods per plan §1.3 D3 → `subscriptions.payment_method = 'scholarship'`, reference honored by the partial-unique guard. Future relaxation of the scholarship-reference requirement is tracked as D-ONB-002.
2. **Admin** → onboarding with `paymentMethod: Paymob` → rejected pre-write (REQ-012.4) — zero rows, zero audit.
3. **Admin** → onboarding with a duplicate `payment_reference` → localized ConflictError (REQ-012.3) — zero rows.
4. **Student/Teacher/Parent actors** → each attempts the mutation with their REAL ids → `FORBIDDEN` at both layers; zero writes, zero audit rows.
5. **Anonymous** → mutation without session → `UNAUTHORIZED`, zero writes.
6. **System (teardown)** → tracked hard-delete in FK-reverse order; audit rows swept via `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83`); post-teardown zero-residue probes (`test/workflows/AGENTS.md:12-19`).

#### Cross-Actor EARS Criteria (observer-perspective)

- **JR-1**: WHEN the admin's onboarding commits THEN the onboarded student SHALL observe exactly the credited plan-lane balance and an active subscription on his existing surfaces, and an unlinked peer SHALL observe none of it (zero fan-out).
- **JR-2**: WHEN a parent is associated THEN that parent SHALL see the child in the monitoring portal WITHOUT any further action, and every OTHER parent SHALL receive the constant-403 denial for the same child.
- **JR-3**: WHEN any denied actor attempts the mutation THEN every observer SHALL see zero state change (no users/students/subscriptions/junction/audit rows) and zero `student_payments` rows — denials are provably side-effect-free.
- **JR-4**: WHEN the audit trail is browsed THEN the onboarding entry SHALL be attributed to the admin actor (never the target student, never anonymous), enabling Admin B to reconstruct the full onboarding from the trail alone.
- **JR-5**: WHEN the same admin runs two onboardings concurrently with the SAME `payment_reference` THEN exactly one SHALL commit and the other SHALL receive the localized duplicate-reference conflict — observers see one coherent student, never two half-students.

### 2.10 REQ-020 — Admin GraphQL Mutation Surface

**User Story:** As the Admin UI, I call one atomic, role-gated mutation to perform the entire onboarding so partial states are structurally impossible.

EARS criteria:

1. WHEN the schema builds THEN it SHALL expose exactly ONE new admin root field — `adminOnboardStudentWithOfflinePayment(input: AdminOnboardStudentOfflineInput!): AdminOnboardStudentResult!` (canonical names, matching plan §3.1 and tasks.md 3.x) — defined in a NEW `backend/graphql/mutation/admin/` file and registered via the side-effect barrel (`backend/graphql/mutation/admin/index.ts:10-13`).
2. WHEN the field is declared THEN it SHALL carry the INLINE literal gate `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (verbatim precedent `backend/graphql/mutation/admin/admin-users.mutation.ts:58-86`; plain-map ANY-semantics is wrong) AND the service SHALL re-assert the actor (`assertActorAdmin` pattern) — anonymous ⇒ `UNAUTHORIZED`, authenticated non-admin ⇒ `FORBIDDEN` at BOTH layers.
3. WHEN the input is mapped THEN the resolver SHALL whitelist field-by-field — `fullName, email, phone, password, gender?, country, planId, paymentMethod, paymentReference?, parentId?` — NEVER `{ ...input }`; `paymentMethod` SHALL be typed as the existing `PaymentGatewayPothosEnum` (`backend/graphql/pothos/shared/enum.pothos.ts:226`) so non-enum values die as GraphQL validation, and the service SHALL re-guard the offline-member subset (REQ-012.4).
4. WHEN any field-level problem exists THEN the mutation SHALL surface localized `ValidationError`/`ConflictError` codes per the closed error taxonomy (`backend/lib/errors.ts:37,65,171`) with `extensions.code` propagation.
5. WHEN the mutation returns THEN it SHALL include `id` first on every object type (Apollo cache normalization) and expose the created student's handshake code and the activated subscription's `status/paymentMethod/paymentReference/paymentVerifiedAt` via the existing `SubscriptionPothosObject` fields (`backend/graphql/pothos/billing/subscription.pothos.ts:84-96`) — no new canonical object type.
6. WHEN the mutation lands THEN the anti-drift census row SHALL be added to `test/workflows/admin/audit-completeness.catalog.ts` (`AdminActionCensusEntry`) in the SAME change set, keeping `backend/db/test/logic/audit/audit-census-drift.test.ts` green, AND `bun run generate:gqlSchema && bun codegen` SHALL run with regenerated artifacts committed together.
7. WHEN the frontend consumes the surface THEN a sharedDocuments mutation SHALL be authored in `frontend/graphql/sharedDocuments/` named `admin<Verb>Student…MutationDocument` (house style `adminCreateUserMutationDocument`, `admin-users.documents.ts:179`) with a co-located `.documents.test.ts` contract test.

**Additional Details:** Priority: high · Complexity: medium · Dependencies: REQ-010..015 · Assumptions: no new Pothos object types; all input/service shapes live in `backend/types/**` (new `AdminOnboardStudentSubmitInput` + `AdminOnboardStudentReturnType` there; NO local types in the resolver, NO service-layer `.types.ts`).

### 2.11 REQ-030 — Admin Onboarding UI & i18n

**User Story:** As an Admin, I get an in-app onboarding flow so I never need DB access to register a cash-paying family.

EARS criteria:

1. WHEN the admin opens the students area THEN an "Onboard student" entry point SHALL exist on the admin students directory (`frontend/views/admin/students/AdminStudentsDirectoryContainer.tsx:36-105` — the existing read-only directory hosts the new affordance; no new route or nav entry is required).
2. WHEN the flow opens THEN it SHALL present four sections in one dialog (reusing `FormDialogShell`, `frontend/views/admin/forms/FormDialogShell.tsx:12-31`): (a) student profile, (b) optional parent picker, (c) plan picker (active plans only), (d) offline payment (method segments `offline_cash`/`bank_transfer`/`scholarship` + reference field, required for all three methods — plan §1.3 D3; D-ONB-002 tracks any future relaxation).
3. WHEN the dialog submits THEN it SHALL call the REQ-020 document via `useMutation` from `@apollo/client/react` (never bare `@apollo/client`), let rejections propagate to `runWithFeedback` (`frontend/views/admin/users/hooks/useAdminUserFormFeedback.ts:4-16`) so field errors render inline and top-level errors render in the alert band, and refetch the directory (`refetchQueries` + `awaitRefetchQueries: true` precedent `useAdminUsersDirectory.ts:77-97`).
4. WHEN any surface renders copy THEN REQ-001 rules apply verbatim: client containers use `useAppTranslation(<NamespaceHandle>)`; en+ar key parity is enforced by the namespace parity test.
5. WHEN a non-admin navigates to the admin students surface THEN `withPageAuth({ roles: [UserRole.Admin] })` (`frontend/lib/auth/withPageAuth.ts:67`, usage `app/(dashboard)/admin/users/page.tsx:30-33`) SHALL keep the page admin-only; the mutation's scope gate is the second, independent layer.
6. WHEN the mutation succeeds THEN the dialog SHALL show the success state (including the handshake code for handoff to the parent) and the directory SHALL reflect the new row.
7. IF the server rejects the submission THEN the UI SHALL display the already-localized server message (`extractErrorMessage` from `@/frontend/lib/graphql-error-utils`) with NO client-side re-translation.

**Additional Details:** Priority: medium · Complexity: medium · Dependencies: REQ-020, REQ-001 · Assumptions: MUI v9 discipline throughout (`sx` prop, theme palette, `*Outlined` icons, no style props).

### 2.12 Non-Functional Requirements

| # | Category | Requirement (EARS) |
|---|---|---|
| NFR-1 | Performance | WHEN the mutation executes THEN all writes (user + student + parent link + subscription + junction + balance + audit) SHALL share ONE transaction with `tx` propagated to EVERY repository call — mixed `tx`/`db` usage is PROHIBITED (deadlock hazard, root AGENTS.md); target: the whole flow is one round of statements, no N+1. |
| NFR-2 | Security — BOLA/BOPLA/BFLA | WHEN any caller invokes the flow THEN the actor SHALL come only from `ctx.user.id`; non-admin roles SHALL be denied at BOTH the Pothos scope gate and the service re-check; input SHALL be a closed field-by-field whitelist (BOPLA) — the flow can never mint admins (`RegisterPublicRole` precedent) nor touch another tenant's rows. |
| NFR-3 | Security — idempotency | WHEN duplicate risk exists THEN the DB unique constraints SHALL be the arbiter: `users_email_unique` (`users.ts:44`), `students_handshake_code_unique` (in-transaction retry, `user-provisioning.helpers.ts:118`), `subscriptions_payment_reference_unique` partial index (`subscriptions.ts:54-56`) — no pre-check SELECT races. |
| NFR-4 | Reliability | IF ANY stage throws (constraint, forced failure) THEN the ENTIRE transaction SHALL roll back — zero users/students/subscriptions/junction/audit residue and zero credited balance; the UI shows one localized error. |
| NFR-5 | Usability | WHEN the admin interacts with the dialog THEN all copy (labels, helper text, error messages, success message incl. handshake code) SHALL be localized in BOTH `en` and `ar` with RTL-correct layout. |
| NFR-6 | Auditability | WHEN the flow completes THEN the trail SHALL be sufficient to reconstruct the onboarding (actor, plan, method, reference, timestamps) without PII in `details`. |
| NFR-7 | Observability | WHEN expected rejections fire THEN the service SHALL log via `logger.logDomainError` with bounded id/code context — happy path emits no noise. |
| NFR-8 | Zero schema drift | WHEN the ticket completes THEN `git diff -- backend/db/schema/**` SHALL be empty — every column/enum this flow needs is verified existing (`bun run db push` never runs). |

---

## 3. System Decisions & State Machine Invariants Alignment

### Decision References

| Ref | Verbatim essence (verified at cited lines) | Binding requirement |
|---|---|---|
| **B.9** — Offline payment audit trail (`docs/specs/open-decisions-and-gaps.md:123-127`) | "✅ RESOLVED — Add payment method fields to the `subscriptions` table … `subscriptions.payment_method` (payment_gateway enum, extended with `offline_cash`, `bank_transfer`, `scholarship`), `subscriptions.payment_reference`, `subscriptions.payment_verified_at`." | REQ-012 (the ticket IS B.9's execution surface for direct activation) |
| **A.5** — audit_logs (`docs/specs/open-decisions-and-gaps.md:35-40`) | "✅ RESOLVED — Create an `audit_logs` table … append-only (immutable)." | REQ-015 |
| **FR-10.2** — Direct Student Onboarding (`docs/specs/functional-requirements.md:263-264`) | "The Admin can manually register a student with profile, parent association, direct subscription activation (offline cash/transfer/scholarship), and teacher assignment." Ticket AC (TICKETS.md:2369-2394) omits teacher assignment → deferred, §1 OUT-scope. | REQ-010/011/012; teacher-assignment deferral recorded |
| **INV-PAY5** (`docs/specs/state-machine-invariants.md:302`) | "Admin direct onboarding with offline payment (cash/transfer/scholarship) bypasses `student_payments`. ✅ RESOLVED (B.9): Audit trail maintained via `subscriptions.payment_method`, `payment_reference`, `payment_verified_at`." | REQ-014, REQ-012 |

### State-Machine Invariants

- **INV-PAY5 (binding):** offline activations never touch `student_payments` — REQ-014 makes it a tested row-count invariant.
- **INV-PAY2 (respected, untouched):** the `student_payments` immutability triggers (`state-machine-invariants.md:299`; `student-payments.ts:24-46`) are never suspended outside sanctioned test cleanup; this flow simply never inserts there.
- **INV-PAY4 (respected):** the `payment_gateway` enum family (`:301`) gains NO members — the three offline members pre-date this ticket (`enums.ts:56-66`).
- **Subscription status transition:** direct `none → active` is sanctioned for this admin flow only; the gateway path keeps its `pending → active` webhook transition (`subscription-activation.service.ts:554` is untouched). `extend`/`renew`/`changePlan` guards (`subscription-admin.service.ts:159,299,400,488`) operate on the resulting row exactly as if it were gateway-activated.
- **User lifecycle invariants (INV-U*):** soft-delete/suspend/block semantics of `users` apply to the onboarded student like any user — nothing here bypasses governance.

### Canonical Workflow Alignment

- **Workflow 04 — Parent Supervision & Handshake** (`docs/workflows/04-parent-supervision-handshake.md`): the admin parent-association write lands on the SAME `students.parent_id` column the handshake flow settles on (decision refs A.2/A.3 cited there at `:89,:150,:160`); the self-service request/link rows (`parent_link_requests`) are untouched — the admin path is an explicit alternative entry to the same end state, verified read-only downstream by `docs/parents/monitoring-portal.md` (requireLinkedChild gate, constant-403 oracle).
- **Workflow 05 — Admin Governance:** this ticket is the "Direct Onboarding" row of the admin governance pillar; sibling surfaces (user CRUD, cold-start, audit trail) are consumed, never edited.

### Architectural & Foundational Standards

- **Layer rules:** services take `(input, actorId: number, locale: string, outerTx?: DBTransaction)` with `outerTx` LAST (composition seam, `backend/services/AGENTS.md`); types live only in `backend/types/**`; GraphQL mutations are side-effect-imported (`backend/graphql/mutation/AGENTS.md`); server pages mount client containers label-free (`app/AGENTS.md`).
- **Error contract:** `DomainError` subclasses with `extensions.code` (`backend/lib/errors.ts:37,44,51,65,171`); `translateDbError` for 23505 → localized ConflictError.
- **Test foundations:** DB tests inside `runInRollback` with `expectRepoError` (`backend/db/test/test-utils.ts:34,73`); fixtures ONLY via `backend/db/test/entity-setup.ts` (`createTestUser :74`, `createTestStudent :104`, `createTestParent :131`, `createTestPlan :180`, `createTestSubscription :222`); GraphQL suites via `setupTestServerLifecycle` + `testClient` from `@/test/helpers` (`test/helpers/test-lifecycle.ts:41`, `graphql-test-helpers.ts:8`); every run through `bun run test/scripts/run-test.ts <path>`; journeys per `test/workflows/AGENTS.md` (no `runInRollback` there — committed fixtures + tracked cleanup).

## 4. Cross-Layer Traceability Matrix

| REQ | Schema / files (path) | Service | GraphQL | Frontend | Tests |
|---|---|---|---|---|---|
| REQ-000 | `outcome/0-baseline-outcome.md`; repo template | — | — | — | `sub-loop.ts --lifecycle duplicates` exit 0 per file |
| REQ-001 | `shared/locale/namespaces/adminStudents/**` (4-file anatomy + parity test, cf. `adminUsers.namespace.ts:4-6`, `adminUsers-namespace.parity.test.ts`) | `getServerTranslations(locale)` errors via `@/shared/locale/server-graphql` | `ctx.t("errorsTranslations")` | `useAppTranslation(<Handle>)` handle imports | parity test green (en+ar) |
| REQ-010 | `users.ts:11-19` (role :19, email-unique :44); `students.ts:18` (handshake :31, balances :24-27) | `AdminUserManagementService.createUser` — NEW composer `backend/services/admin/student-onboarding.service.ts` (plan §1.3 D1) composing `user-provisioning.helpers.ts:118` (retry, `:30`, `:43`) | NEW mutation file `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts` (barrel `index.ts:10-13`) | `CreateUserDialog.tsx:47-71` (password/user-provisioning template) | repo+service tests under `backend/db/test/` + `backend/services/billing/test/` via `run-test.ts` |
| REQ-011 | `students.ts:32` (parent FK); `parents.ts:11` | `linkParentIfUnlinked` (`student.repository.ts:373`) reuse | (same mutation, `parentId?` input) | parent picker section (FormDialogShell) | denial probes: non-parent id / unknown id |
| REQ-012 | `subscriptions.ts:28` (status :38, method :41, reference :42+`:54-56`, verified-at :43, doc `:12-14`); `student-subscriptions.ts:20`; `plans.ts:20-29`; enums `enums.ts:56-66,68-74`; `payment-gateway.enum.ts:10-19` | NEW service + `SubscriptionRepository.insertSubscription` (`subscription.repository.ts:70`) + `subscription-admin-settle.helpers.ts:43` as template | `PaymentGatewayPothosEnum` (`enum.pothos.ts:226`) input typing | payment section (method segments + reference) | offline-member subset guard; duplicate reference; bad plan; `paymob` rejection |
| REQ-013 | `students.ts:24-27`; `plans.ts:25,29`; `subscription-credit-lane.enum.ts:9-12` | `creditLaneBalance` (`student.repository.ts:440`); lane helper `subscription-activation-credit.helpers.ts:57` | — (payload fields only) | balance visible post-commit (directory refetch) | credit-equals-session_count; NULL-lane fail-closed |
| REQ-014 | `student-payments.ts:50` (doc `:24-46`, `payment_gateway` :64) | (non-action) | — | — | zero-row delta assertion in service + journey tests |
| REQ-015 | `audit-logs.ts:30` (details :40, append-only doc) | `AuditService.createAuditLog` (`audit.service.ts:82`) + contract `admin-audit.contract.types.ts:22`; builders `user-management.helpers.ts:334`, `subscription-admin.helpers.ts:354` | same mutation (no separate surface) | audit visible via `AdminUserRepository.findDetailById`/`admin-users.query.ts:97` | census row in `audit-completeness.catalog.ts` + `audit-census-drift.test.ts` green |
| REQ-020 | `backend/types/**` (input+result types) | same service | NEW root field, inline `authScopes` gate (precedent `admin-users.mutation.ts:58-86`); schema regen `bun run generate:gqlSchema` + `bun codegen` | `frontend/graphql/sharedDocuments/` `admin<Verb>Student…MutationDocument` (naming `admin-users.documents.ts:179`) + `.documents.test.ts` | GraphQL suite: UNAUTHORIZED/FORBIDDEN/happy/denials (`testClient` `graphql-test-helpers.ts:8`) |
| REQ-030 | — | — | — | `AdminStudentsDirectoryContainer.tsx:36-105` entry + NEW onboarding dialog (FormDialogShell `:12-31`); `useAdminUserFormFeedback.ts:4-16`; `graphql-error-utils`; `withPageAuth` (`withPageAuth.ts:67`, usage `admin/users/page.tsx:30-33`) | UI covered by GraphQL/journey suites (no static/component UI layer exists) |
| Journeys | `test/workflows/**` | service invoked E2E-style | real server via harness | — | 3 journeys + zero-residue probes (`test/workflows/AGENTS.md:12-19`, `actor-context.ts:88-143`, `db-cleanup.ts:83`) |

---

## Success Criteria / Definition of Done

1. ✅ Every REQ-010..015/020/030 EARS criterion has a passing test at the right layer (repo/service: `runInRollback` suites; GraphQL: `testClient` suites; journeys: `test/workflows/` committed-fixture suites) — ALL run via `bun run test/scripts/run-test.ts <path>`.
2. ✅ The three journeys (J-1 cash, J-2 bank-transfer+parent, J-3 scholarship+denials) pass end-to-end in `test/workflows/admin/direct-student-onboarding.journey.test.ts` with zero-residue teardown verified.
3. ✅ The offline bypass invariant is asserted: zero new `student_payments` rows in every onboarding test.
4. ✅ One `audit_logs(Create)` row per successful onboarding; census row added and drift test green.
5. ✅ Admin UI flow works in `bun run dev` in BOTH locales (en+ar); all copy through namespace handles; parity test green.
6. ✅ Zero schema/enum/migration changes (`git diff -- backend/db/schema` empty).
7. ✅ Full quality gate green: `bun quality-gate` (tsgo → oxlint → biome → lint → duplicates) with no new debt; deferred teacher-assignment item recorded in the ledger with ticket reference.
8. ✅ `outcome/` contains baseline + per-task outcomes; semantic review checklist completed before each `[x]`.

## Glossary

| Term | Meaning |
|---|---|
| Offline payment | `payment_gateway` members `offline_cash`, `bank_transfer`, `scholarship` (`enums.ts:56-66`) — collected outside Paymob, evidenced only on `subscriptions` |
| Handshake code | Unique `students.handshake_code` (`KSB-` + 8 hex) used by parents to claim their child (`user-provisioning.helpers.ts:43,118`) |
| Balance lane | `plans.balance_lane` selects which `students.balance_<lane>` column a plan credits (`plans.ts:29`) |
| Direct activation | Subscription created `active` by an admin (B.9) without any gateway or `student_payments` involvement |
| Census | `test/workflows/admin/audit-completeness.catalog.ts` — the anti-drift registry every admin write surface must join |
| Committed-fixture journey | Workflow test style: real committed rows + tracked hard-delete teardown (no `runInRollback`) |
| Zero-residue | Post-teardown probes prove no fixture rows survive (`test/workflows/AGENTS.md:12-19`) |
