# Admin Cold-Start Certification — Canonical Reference

**Domain:** Admin / Cold-start bootstrapping (Workflow 05 — direct sheikh certification half)
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (INV-TV1), `docs/specs/open-decisions-and-gaps.md` (A.4/A.4.3, A.5, A.7, B.6, B.7)
**Status:** Implemented and verified (DEV3-018)

This document is the single canonical reference for the admin cold-start certification surface — the `adminCertifyTeacherColdStart` mutation that promotes an existing teacher-role user directly to a certified founding Sheikh, bypassing the applicant evaluation pipeline. All layers (types, repos, service, GraphQL, tests) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

> Scope note: this document may cite spec anchors (FR/REQ/D-codes) — that is house style for canonical docs. The `docs/specs/*` files are **read-only for this surface**: this ticket mints no new invariants and no new decisions; it binds to existing anchors by reference.

---

## 1. Why

Cold-start bootstrapping exists because a brand-new platform has no certified evaluation committee yet — nobody exists who could evaluate teacher applicants through the normal pipeline (`docs/teachers/applicant-lifecycle.md`). FR-3.9 / INV-TV1(b) resolves this: the Super Admin (supreme authority, Workflow 05) directly certifies the founding cohort, and that cohort **is** the initial Evaluation Committee. Once the committee exists, the normal applicant evaluation loop takes over and this surface remains the governance override, not the routine path.

DEV3-018 ships:

- The GraphQL mutation `adminCertifyTeacherColdStart(userId: Int!, makeEvaluator: Boolean = true): AdminUserDetail!` — admin-only, `$all`-conjunction gated.
- `TeacherRepository` (the first governed-write repository for the `teacher` role-child table): insert-into-certified-state plus a guarded elevate, nothing else.
- `ApplicantRepository.finalizeOnCertification` — the unconditional pass-and-clear-cooldown write that keeps the `applicants` lifecycle coherent when certification bypasses the loop.
- `ColdStartCertificationService.certifyTeacherColdStart` — one transaction gate → validate → certify → finalize → audit → notify → refreshed-read.
- `assertActorAdminActive` — the role gate PLUS a governance clause (REQ-031), extracted beside the shared `assertActorAdmin`.

This document binds to **A.5** (`audit_logs` append-only contract), **A.7** (`users` governance columns — read here, never written), **B.6** (the failed applicant's home is `applicants`), **B.7** (a `teacher` row reaching `is_approved = true` is certification — this surface is one of exactly two writers), **INV-TV1** (no certification shortcut — EXCEPT this explicitly sanctioned admin override), and **Workflow 05** §3.

---

## 2. Pattern

### 2.1 Mutation Contract + `makeEvaluator` Committee Semantics (FR-3.9)

SDL (exact):

```graphql
extend type Mutation {
  adminCertifyTeacherColdStart(userId: Int!, makeEvaluator: Boolean = true): AdminUserDetail!
}
```

- Authoritative registration: `backend/graphql/mutation/admin/admin-teachers.mutation.ts:36-69`. No new Pothos object/input types; the return type is the DEV3-016 `AdminUserDetailPothosObject`.
- `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` — the `$all` conjunction is load-bearing (a plain map is ANY-semantics = wrong); the verified pattern lives at `docs/teachers/applicant-lifecycle.md` §3. Anonymous → `UNAUTHORIZED`, authenticated non-admin → `FORBIDDEN`, both BEFORE the resolver body runs.
- The resolver is thin: `!ctx.user` narrowing guard, then field-by-field argument hand-off (no spread, no try/catch). `actorId` is `ctx.user.id` — sourced from the verified session, NEVER from input.
- The resolver's $all scope is NOT sufficient authorization on its own: the service's FIRST action re-checks the actor (§2.6).

**`makeEvaluator` committee semantics (REQ-019):** the flag controls `teacher.is_evaluator` — the capability to evaluate teacher applicants. The DEFAULT IS `true` AT ALL THREE LAYERS (D7): the SDL arg default (`defaultValue: true`), the resolver coalesce `args.makeEvaluator ?? true`, and the service coalesce `input.makeEvaluator ?? true` (`cold-start-certification.service.ts:180`). The default being `true` is the PRODUCT intent — the cold-start cohort IS the Evaluation Committee (FR-3.9, Workflow 05 §3), so an admin who certifies a founder without thinking about the flag gets a committee member. An explicit `false` certifies a Sheikh who can teach but cannot evaluate.

### 2.2 Create-vs-Elevate Decision Rule (D2)

The `teacher` row write has exactly two shapes, decided by `TeacherRepository.findById(userId, tx)` (`backend/db/repo/teachers/teacher.repository.ts:50-71`):

- **Row absent → INSERT directly into the certified state** (`insertColdStartCertified`, `teacher.repository.ts:85-103`): `{ id, isApproved: true, isEvaluator: makeEvaluator }`, field-by-field; all other columns (`averageRating`, `isOnline`, `subjects`, `requestPreference`) are carried by schema defaults. A duplicate PK surfaces the raw `23505` untranslated — the SERVICE owns translation (cause-checked via `isUniqueViolation`, everything else rethrows untouched).
- **Row exists with `isApproved = false` → ELEVATE via a single guarded UPDATE** (`elevateToCertified`, `teacher.repository.ts:118-133`): `UPDATE teacher SET is_approved = true, is_evaluator = <flag>, updated_at = now() WHERE id = ? AND is_approved = false RETURNING *`. The precondition is folded into the WHERE clause so predicate and mutation are ONE statement — no SELECT-then-UPDATE TOCTOU window. Zero-row RETURNING → `null`; the service disambiguates with ONE cold-path re-read: re-read approved ⇒ `TEACHER_ALREADY_CERTIFIED`; anything else ⇒ unexpected internal error (never a silent no-op).
- **Row exists with `isApproved = true` → `ConflictError("TEACHER_ALREADY_CERTIFIED", …)` before any write** (REQ-013).

The rejected alternatives are on record: an upsert (`ON CONFLICT DO UPDATE`) cannot distinguish "already certified" (must conflict) from "elevate" (must write) and would silently overwrite flags; a pure read-then-write has a raw TOCTOU hole.

### 2.3 Applicants-Finalize Rule (Pass ⇒ Cooldown Cleared; Supersession Rationale)

`ApplicantRepository.finalizeOnCertification(userId, tx)` (`backend/db/repo/teachers/applicant.repository.ts:174-197`) is ONE unconditional statement: `UPDATE applicants SET status = 'passed', cooldown_until = NULL, updated_at = now() WHERE id = ? RETURNING id` — returns `true` iff a row existed.

- **Unconditional by design (REQ-012):** prior status (`pending` / `in_evaluation` / `failed`) and any active cooldown are SUPERSEDED. The lifecycle's own rule is "a pass clears the cooldown" (`docs/teachers/applicant-lifecycle.md` §1/§6); admin cold-start certification IS a pass — the lifecycle must not end up telling two stories about the same teacher. Re-litigating the rule here (e.g. finalizing only `failed` rows) would strand `failed` + future-cooldown rows against INV-TV1(b)'s supreme-authority reading.
- **`verificationAttempts` / `lastAttemptAt` are NEVER rewritten** — history is preserved (B.6: the `applicants` row is the applicant's permanent home; it is NEVER deleted).
- **Absent row is tolerated**: the certification proceeds and the audit `details` records `applicantRow: "absent"` (vs `"finalized"`) — see §2.4.

### 2.4 Override-Audit Shape (D8 JSON + JR-C-1 Denial Purity)

Every successful certification appends EXACTLY ONE `audit_logs` row INSIDE the same transaction via the single canonical writer `AuditService.createAuditLog(contract, tx)` (`backend/services/admin/cold-start-certification.service.ts:201-214`):

| Field | Value |
|---|---|
| `actorId` | the calling admin's id (from `ctx.user.id`, NEVER input) |
| `actionType` | `AuditActionType.Override` |
| `entityType` | `"teacher"` (lowercase label vocabulary) |
| `entityId` | the target user id (non-null) |
| `details` | fixed 3-field JSON: `{ makeEvaluator: boolean, applicantRow: "finalized"\|"absent", elevation: "created"\|"elevated" }` |

The `details` payload is PII-free BY CONSTRUCTION (IDs/booleans/enums only — never names, emails, or content) and far below the `varchar(2000)` ceiling; the writer-side `truncateDetailsSafely` belt still applies. The fixed triple exactly reconstructs WHO/WHAT/HOW for the audit-trail browser (DEV3-020 consumer).

**JR-C-1 denial purity:** EVERY denial path emits ZERO audit rows. The actor gate + shape validation run BEFORE any transaction opens; the target checks (existence/role/governance) and the already-certified conflicts throw BEFORE the audit stage inside the tx, so a thrown tx rolls back with zero writes anywhere. Denials log once each via `logger.logDomainError` with the bounded context `{ code, entity: "user", entityId, locale }` (`cold-start-certification.service.ts:79-86`; note B-2/F-D3 reconciliation — the target id belongs to a `users` row regardless of the denial reason).

### 2.5 Cross-Entity Purity Envelope (REQ-020)

A certification writes ONLY four tables, and nothing else, ever:

- `teacher` — one INSERT or one guarded UPDATE (§2.2).
- `applicants` — the finalize UPDATE, only when a row exists (§2.3).
- `audit_logs` — exactly one `override` row (§2.4).
- `notifications` — one `evaluation_result` row emitted in-tx through the NotificationEngine (`emitForUser` with the caller's `tx`), receipt published strictly AFTER commit via `publishReceipts` (D4); the engine remains the ONLY writer of this table. Copy is composed in the ADMIN's locale (emitter-locale rule A.4.3; per-recipient routing is the engine's deferred D2).

ZERO writes to `users` (profile / role / governance columns — A.7 columns are READ here, never written), `wallet`, `subscriptions`, `plans`, `session`, `teacher_transaction`, or any other table. The purity is oracle-proven by the test tiers (fixture-snapshot assertions), not merely reviewed.

### 2.6 Actor-Governance Blast-Radius Divergence (REQ-031 / D1)

**This is a documented divergence from the DEV3-016 role-only gate — read it before reusing either gate.**

- `createGraphQLContext` applies NO governance filter (`backend/graphql/gqlContextFactory.ts`) and `UserRepository.findById` applies none either — a SUSPENDED (or blocked/deleted) admin holding a still-valid token passes the role-only `assertActorAdmin` and the `$all` authScopes. For the low-blast CRUD surface that window was accepted (DEV3-016); for minting certified Shuyukh it is NOT.
- This mutation's FIRST service action is therefore `assertActorAdminActive` (`backend/services/admin/admin-gate.helpers.ts:105-137`): the shared role gate verbatim, PLUS a governance clause re-reading the actor row and checking `isDeleted` → `isBlocked` → `suspended` in deterministic order, each denial a `ForbiddenError` carrying the existing localized `accountDeleted` / `accountBlocked` / `accountSuspended` copy. Every denial happens BEFORE the transaction opens, with ZERO audit rows and ZERO reads past the gate.
- Known shape (ledgered, not fixed on this ticket): the governance clause performs a SECOND read of the actor row; under READ COMMITTED the two reads see different snapshots (micro TOCTOU). `assertActorAdmin` is byte-parity locked to the DEV3-016 regression suites and returns void, so it cannot hand back its row — the double-read is the forced consequence, recorded as ledger rows `D-GATE-DOUBLE-READ` / `D-GATE-NULL-READ` owned by the gate-consolidation follow-up. The `audit_logs.actor_id` FK restrict guarantees rollback if the actor row is hard-deleted mid-window.
- The target's governance state is ALSO checked inside the tx (`isDeleted || isBlocked || suspended` ⇒ `TEACHER_ACCOUNT_GOVERNED`), NULL-safe, with no suspension-window hysteresis.

### 2.7 Concurrency Rulings (REQ-042)

Two PostgreSQL mechanisms — and NOTHING else:

1. **PK unique constraint on `teacher.id`** (insert path): two concurrent certifications of a row-absent target both attempt the INSERT; the loser's `23505` is cause-checked into `TEACHER_ALREADY_CERTIFIED`, and the loser's transaction aborts — zero residual `teacher` / `applicants` / `audit_logs` / `notifications` rows, zero pushes.
2. **Guarded-UPDATE predicate evaluated under the PostgreSQL row lock** (elevation path): two concurrent elevations of an unapproved row serialize on the row lock; the winner's predicate matches, the loser's re-evaluated predicate (`is_approved = false`) no longer does → zero-row RETURNING → cold-path re-read → `TEACHER_ALREADY_CERTIFIED`.

**Explicit NON-usage:** this surface uses NO `SELECT FOR UPDATE`, NO PostgreSQL advisory locks, and NO Redis / external locking. The two mechanisms above are sufficient because every contested write carries its precondition in the same statement, and the accepted residual windows are documented: a target governed mid-transaction is an as-of-snapshot eligibility call (a later suspension is a separate admin action; the `teacher.id → users.id` FK prevents orphans), and the certification reads of `users`/`teacher` inside the tx see only committed predecessor state.

### 2.8 Idempotency Ruling (REQ-043 — Conflict, Not Keys)

This mutation is OUTSIDE the `docs/IDEMPOTENCY.md` mandated key set (Student / Invoice / Class Instance / Payment). Repeat-call safety is carried by the conflict ruling, mirroring the DEV3-016 admin-ops ruling (`docs/admin/user-management.md` §2.5): a double-submit / retry / replay resolves to `TEACHER_ALREADY_CERTIFIED` BEFORE any second write, audit row, notification, or publish — because the `isApproved = true` pre-check, the `23505` translation, and the zero-row re-read all funnel a repeat into the same typed conflict. There is NO claim cache, NO key derivation, NO replay machinery.

### 2.9 Error-Code Table (verbatim from plan §3.3)

| Scenario | Class | `extensions.code` | Emission point |
|---|---|---|---|
| Anonymous caller | scope `$all.authenticated` throws `UnauthorizedError` | `UNAUTHORIZED` | pre-resolver (builder at `backend/graphql/pothos/builder.ts:127-132`) |
| Authenticated non-admin | scope `role` false → mapped `ForbiddenError` | `FORBIDDEN` | pre-resolver |
| Service-tier: `actorId = 0` or actor row missing | `UnauthorizedError` / `ForbiddenError` | `UNAUTHORIZED` / `FORBIDDEN` | `assertActorAdminActive` |
| Service-tier: governed admin (`isDeleted`/`isBlocked`/`suspended`) | `ForbiddenError` (deterministic order: deleted → blocked → suspended) | `FORBIDDEN` | service, pre-tx (REQ-031) |
| Malformed `userId` (0 / negative / fractional / NaN / > MAX_SAFE_INTEGER) | `ValidationError` (default code; `(message)` ctor branch) | `VALIDATION` | service, pre-tx |
| Absent target id | `NotFoundError("USER", …)` | `USER_NOT_FOUND` | in-tx, pre-write |
| Target role ≠ teacher | `ConflictError("TEACHER_ROLE_REQUIRED", …)` | `TEACHER_ROLE_REQUIRED` | in-tx, pre-write |
| Target governed | `ConflictError("TEACHER_ACCOUNT_GOVERNED", …)` | `TEACHER_ACCOUNT_GOVERNED` | in-tx, pre-write |
| Already certified (approved row / 23505 / elevate zero-row + re-read) | `ConflictError("TEACHER_ALREADY_CERTIFIED", …)` | `TEACHER_ALREADY_CERTIFIED` | in-tx |
| Unexpected internals | masked once at the boundary | `INTERNAL_SERVER_ERROR` | `finalizeGraphqlErrors` (defined at `backend/lib/errors/error-masking.ts:870`, re-exported through `@/backend/lib/errors`; applied by the `createGraphqlErrorsFinalizerPlugin` Apollo wrapper in `backend/graphql/graphqlErrorsFinalizer.ts`, which imports it at line 61) |

The taxonomy is CLOSED (REQ-050): no new error subclasses; the custom conflict codes ride the verified `ConflictError(code, message)` two-arg overload (`backend/lib/errors.ts:170-182`).

---

## 3. Rules

- **REQ-010/011 (Row assembly):** row-absent → INSERT certified state directly; unapproved row exists → single guarded `UPDATE … WHERE id = ? AND is_approved = false … RETURNING`; zero-row elevate ⇒ ONE cold-path re-read, resolved to conflict or unexpected-internal — never a silent no-op.
- **REQ-012 (Applicants finalize):** unconditional `status = passed, cooldownUntil = null` when the row exists; `verificationAttempts`/`lastAttemptAt` untouched; row never deleted; absence recorded as `applicantRow: "absent"`.
- **REQ-013 (Already-certified conflict):** approved row ⇒ `TEACHER_ALREADY_CERTIFIED` with ZERO writes, ZERO audit rows, ZERO notifications.
- **REQ-016 (Notification):** ONE `evaluation_result` emit in-tx via `NotificationEngine.emitForUser`; publish strictly post-commit; copy in the ADMIN's locale; publish failure degrades to the engine-owned delivery-degraded lane — rows stay committed.
- **REQ-017 (Audit):** exactly ONE `override` row in-tx, D8 triple details, `actorId` from the session.
- **REQ-018 (Return):** the refreshed `AdminUserDetailReturnType` read via `AdminUserManagementService.getUserDetail(userId, locale, actorId, tx)` inside the SAME tx — compose, never fork a detail assembler.
- **REQ-019 (`makeEvaluator`):** default `true` at SDL, resolver, and service layers (D7); `false` certifies without evaluator capability.
- **REQ-020 (Cross-entity purity):** writes to `teacher` / `applicants` / `audit_logs` / `notifications` ONLY (§2.5).
- **REQ-031 (Actor governance):** the service's FIRST action is `assertActorAdminActive`; governed actor ⇒ `FORBIDDEN` pre-tx in deterministic deleted → blocked → suspended order.
- **REQ-040/041 (Atomicity):** ALL writes inside ONE `withTransaction`; the same `tx` propagated to EVERY repository/engine call (mixed `tx`/`db` is prohibited); any mid-stage throw ⇒ full rollback, publish structurally unreachable.
- **REQ-042/043 (Concurrency / idempotency):** PK constraint + guarded predicate only; no SELECT FOR UPDATE / advisory locks / Redis; repeat calls answer `TEACHER_ALREADY_CERTIFIED`.
- **Denial ordering (deterministic):** actor authentication → actor role → actor governance → `userId` shape → target existence → target role → target governance → already-certified. Every denial pre-write.

---

## 4. What NOT to Do

- **DO NOT add a second certification writer.** `ColdStartCertificationService` + `TeacherRepository` are the ONLY write path to the certified state (`is_approved = true`) outside the evaluation loop. A second writer would fork the create-vs-elevate decision rule, the audit shape, and the conflict translation — all of which exist exactly once by design.
- **DO NOT unset or repurpose `cooldown_until` semantics elsewhere.** The clear-on-pass rule belongs to the applicant lifecycle; this surface finalizes (`status = 'passed'` + `cooldown_until = NULL`) in the SAME statement — never clear a cooldown without setting `passed`, and never re-open cooldown semantics outside `docs/teachers/applicant-lifecycle.md`'s authority.
- **DO NOT route certification through the purchase/evaluation lifecycle.** Cold-start certification bypasses the applicant evaluation pipeline BY DESIGN (FR-3.9); wiring it into purchases, subscriptions, or the evaluation loop would conflate two separate lifecycle authorities.
- **DO NOT widen the surface beyond admin callers.** The `$all: { authenticated, role: [UserRole.Admin] }` scope and the service-tier `assertActorAdminActive` are both load-bearing; the public-operations allowlist (`backend/lib/gateway/public-operations.ts`) must never gain this operation. Non-admin self-service certification is a BFLA/BOLA hole.
- **DO NOT re-litigate the emitter-locale rule inline.** Certification copy is composed in the ADMIN's locale (A.4.3). Per-recipient localization is the NotificationEngine's deferred D2 — do not patch a per-recipient lookup into this service; route the requirement through the engine stream.
- **DO NOT add locking.** No `SELECT FOR UPDATE`, no advisory locks, no Redis. The PK constraint and the guarded predicate are the entire concurrency story (§2.7); adding locks would signal a misunderstanding of the rulings and risks deadlocks against sibling admin writes.
- **DO NOT write audit rows outside the certification transaction, or on denials** (JR-C-1). The audit insert MUST live inside the certification `tx`; denials append zero rows.
- **DO NOT widen the audit `details` payload** beyond the fixed D8 triple. Field names and metadata only — names, emails, and content violate the PII-minimal contract (DEV3-020 reads this shape).
- **DO NOT mint `teacher` rows for non-teacher users** "to prepare them" elsewhere: `TEACHER_ROLE_REQUIRED` is the gate, and `users.role` is NEVER written by this surface (A.7 purity).
- **DO NOT touch `docs/specs/state-machine-invariants.md` or `docs/specs/open-decisions-and-gaps.md` numbering** from this surface — bindings are by reference (INV-TV1, A.4/A.4.3, A.5, A.7, B.6, B.7).

---

## 5. Rollout Summary

DEV3-018 ships:

- `backend/graphql/mutation/admin/admin-teachers.mutation.ts` — the mutation field (thin resolver, `$all` scope, field-by-field delegation).
- `backend/services/admin/cold-start-certification.service.ts` — `certifyTeacherColdStart` pipeline; module helpers `logCertificationDenial`, `asDeliveryReceipt`, `certifyTeacherRow`.
- `backend/services/admin/admin-gate.helpers.ts` — `assertActorAdmin` (extracted byte-verbatim from DEV3-016; its suites are the parity lock) + NEW `assertActorAdminActive`.
- `backend/db/repo/teachers/teacher.repository.ts` — `TeacherRepository.findById` / `insertColdStartCertified` / `elevateToCertified`.
- `backend/db/repo/teachers/applicant.repository.ts` — `finalizeOnCertification` (additive).
- `backend/types/teachers/teacher.types.ts` — `TeacherColdStartCertificationInput`.
- `frontend/graphql/sharedDocuments/admin/teacher-certification.documents.ts` — the typed document (id-first selection); the admin UI surface is deferred to its owning ticket (D9 — wire contract shipped consumable, view not invented).
- `shared/locale/{en,ar}` — `errors.teacherRoleRequired` / `teacherAccountGoverned` / `teacherAlreadyCertified` + `applicant.coldStartCertifiedTitle/Body`.

Tests: service suite 28 tests, chaos suite 9 (double-certify race, forced mid-tx failure, hostile-`userId` fuzz, parallel certify storm), gate suite 10, repo suites 17, GraphQL wire suite 19, journey 12. Zero schema/migration drift (`git diff -- backend/db/schema/** backend/db/migration/**` empty). Six reconciled findings were carried into the plan ledger as RESOLVED-REFERENCE (`D-B1-PLAIN-ERROR`, `D-GATE-NULL-READ`, `D-GATE-DOUBLE-READ`, `D-VALIDATION-LOG`, `D-DOCS-SHAREDDOCS-LAYOUT`, `D-GQL-DOC-ANCHOR`) — owned by the error-contract, gate-consolidation, rate-limiting, and docs streams respectively.

---

## 6. Related Documents

- Admin surface parent: `docs/admin/user-management.md` (audit-write contract, JR-C-1, guarded-update pattern, idempotency ruling precedent, scope-split record).
- Applicant lifecycle: `docs/teachers/applicant-lifecycle.md` (`applicants` state machine; pass-clears-cooldown rule; `$all` scope-verification pattern §3; inverted oracle ruling precedent).
- Realtime notification engine: `docs/notifications/realtime-engine.md` (persist-first/push-second, single-writer emit contract, receipt composition).
- Error contracts: `docs/graphql/error-handling-contract.md` (masking pipeline, closed taxonomy), `docs/graphql/domain-error-extensions-code.md` (SCREAMING_SNAKE_CASE codes).
- API gateway: `docs/graphql/api-gateway-and-routing.md` (default-deny public allowlist — this operation is NOT public).
- Idempotency: `docs/IDEMPOTENCY.md` (this surface is outside the mandated key set — §2.8 ruling).
- SSR/governance precedent: `backend/lib/auth/server-auth.ts` (governance hard-stop shape mirrored by the target check).
- Authoritative implementations: `backend/graphql/mutation/admin/admin-teachers.mutation.ts`, `backend/services/admin/cold-start-certification.service.ts`, `backend/services/admin/admin-gate.helpers.ts`, `backend/db/repo/teachers/teacher.repository.ts`, `backend/db/repo/teachers/applicant.repository.ts`, `backend/types/teachers/teacher.types.ts`, `frontend/graphql/sharedDocuments/admin/teacher-certification.documents.ts`.
- Test locks: `backend/services/admin/cold-start-certification.service.test.ts`, `backend/services/admin/cold-start-certification.chaos.test.ts`, `backend/services/admin/admin-gate.helpers.test.ts`, `backend/db/repo/teachers/teacher.repository.test.ts`, `backend/db/repo/teachers/applicant.finalize.test.ts`, `backend/graphql/test/admin-teachers.mutation.test.ts`, `test/workflows/admin/cold-start-certification.journey.test.ts`, `frontend/graphql/sharedDocuments/admin/teacher-certification.documents.test.ts`.
