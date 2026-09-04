# Technical Architecture & Implementation Design: DEV3-004 — Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled)

> **Plan of record:** `ai/plans/sprint_1/dev3-004-session-creation-lifecycle-scheduled-sta/`
> **Specs:** `specs.md` REQ-001..REQ-083, Journeys §2.9 (J1/J2, REQ-J1..J6)
> **Canonical refs:** `docs/auth/user-registration.md` (atomicity + `withTransaction(outerTx)` SAVEPOINT pattern + 23505 cause-chain), `docs/auth/jwt-authentication-service.md` (authScopes contract, fail-closed governance at login/SSR), `docs/teachers/applicant-lifecycle.md` (`$all` conjunction semantics — verified pattern, and the varchar-status enum precedent), `docs/students/free-trial-provisioning.md` (guarded conditional UPDATE, INV-B8 trial-first), `docs/graphql/domain-error-extensions-code.md`, `docs/graphql/error-handling-contract.md` (`DUPLICATE_REQUEST` success-equivalent UX), `docs/graphql/api-gateway-and-routing.md` (gateway Rule 8 registration; Rule 3 `ctx.idempotencyKey` context capture), `docs/backend/cross-stream-contracts.md` (`SessionRequestContract`, TOCTOU binding), `docs/IDEMPOTENCY.md` (class-instance booking mandate — extended to session booking by intent consistency; the doc's Affected Operations list names Students/Invoices/Class Instances/Payments and contains NO explicit `session` mandate), `docs/specs/open-decisions-and-gaps.md` (A.8/A.10/B.2/B.3/B.4/B.18/C.5), `docs/specs/state-machine-invariants.md` (INV-S1..S8, INV-B1/B4/B8, INV-W3/W4, INV-U2/U5, INV-TV1), `docs/workflows/02-on-demand-matching-workflow.md`, `docs/workflows/03-session-lifecycle-escrow.md`, `docs/DATABASE_MIGRATIONS.md`, `docs/testing/workflow-journey-tests.md`, plus the guarded-update precedents `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/plan.md` and `ai/plans/sprint_3/dev1-013-student-handshake-code-generation/plan.md`

---

## 1. System Overview & Architecture Diagram

### 1.1 Scope Statement

DEV3-004 ships the **P2P session lifecycle vertical slice**: one creation mutation (guarded debit-at-request hold + idempotency claim + certification-locked insert), three guarded single-statement transitions (start / complete / cancel-with-refund), one oracle-safe detail read, two participant-scoped paged list reads, and two role-bound dashboard pages (`/student/sessions`, `/teacher/sessions`). It touches ONLY the `session` table domain (`backend/db/schema/classes/session.ts`) — the quota-era `class_instances` scheduling subsystem is documented in docs/AGENTS.md prose but has NO code in the current tree (no `class_instances` file under `backend/db/schema/classes/`, no `ClassSessionService` anywhere): it is a different domain and is never touched, and the real hazard is naming collision with those *documented* names, which REQ-004's verify-absence gate guards against. Write surfaces are restricted by construction to exactly three tables: `session`, `students` (one balance lane), `session_request_idempotency`.

### 1.2 Write Path — Create (four-phase transaction)

```
┌── CLIENT: future DEV3-009 booking UI (this ticket: tests + journey harness) ─┐
│   useMutation(createSessionMutationDocument, { headers: X-Idempotency-Key }) │
└──────────────────────────────────┬───────────────────────────────────────────┘
▼                                  ▼
┌── GraphQL: backend/graphql/mutation/classes/session-lifecycle.mutation.ts ───┐
│   createSession(input: { teacherId, intent })                                │
│   authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }    │
│     anonymous → scopeAuth UnauthorizedError → UNAUTHORIZED (401)             │
│     non-student → role scope false          → FORBIDDEN (403)                │
│   resolve → SessionLifecycleService.createSession(                           │
│              ctx.user.id, args.input, ctx.idempotencyKey, ctx.locale)        │
└──────────────────────────────────┬───────────────────────────────────────────┘
▼
┌── SessionLifecycleService (backend/services/classes/session-lifecycle.svc) ──┐
│   PRE-DB boundary validation (REQ-054):                                      │
│     • idempotencyKey present → else ValidationError(idempotencyKeyRequired)  │
│     • teacherId positive-safe-int guard (NO `as number`)                     │
│     • intent ∈ {Hifz, Tajweed} → else VALIDATION (invalidSessionIntent)      │
│   then withTransaction(outerTx) {         — DEV1-002 SAVEPOINT-aware pattern │
│     PHASE 1: TeacherRepository.lockForCertificationCheck(teacherId, tx)      │
│              SELECT … FOR UPDATE                                             │
│              ├─ null row → NotFoundError("TEACHER", …)  (applicant ⇒ this!)  │
│              └─ isApproved=false → ConflictError(TEACHER_NOT_CERTIFIED)      │
│     PHASE 2: guarded debit ladder (INV-B8 trial-first)                       │
│              StudentRepository.decrementLaneIfAvailable(studentId,"trial",tx)│
│                UPDATE … SET balance_trial = -1 WHERE id AND balance_trial>0  │
│              ├─ matched → heldLane = HeldBalanceLane.Trial                   │
│              └─ miss → decrementLaneIfAvailable(studentId, intentLane, tx)   │
│                  ├─ matched → heldLane = Hifz | Tajweed                      │
│                  └─ miss → ValidationError(INSUFFICIENT_BALANCE) → ROLLBACK│
│     PHASE 3: SessionRequestIdempotencyRepository.insertClaim(                │
│              { idempotencyKey, userId }, tx)                                 │
│              └─ 23505 → cause-chain → DUPLICATE_REQUEST (replay THROWS the   │
│                  409 — client maps it success-equivalent per REQ-065; the    │
│                  replay tx rolls back its own partial writes → zero new rows)│
│     PHASE 4: SessionRepository.insertSession(insert, tx)  INSERT … RETURNING │
│              defaults layered server-side only (status/type/fee/feeHeld/     │
│              deadline = now+24h)                                             │
│              + claim backfill UPDATE claim.session_id = newId (same tx)      │
│   }  — ANY failure rolls back ALL FOUR phases atomically (REQ-040)           │
└──────────────────────────────────┬───────────────────────────────────────────┘
▼
┌── Repositories (all `tx?: DBTransaction` optional-last) ─────────────────────┐
│   SessionRepository (NEW, backend/db/repo/classes/)                          │
│   StudentRepository (EXISTING — 2 additive guarded methods)                  │
│   TeacherRepository (NEW — backend/db/repo/teachers/teacher.repository.ts)   │
│   SessionRequestIdempotencyRepository (NEW)                                  │
└──────────────────────────────────┬───────────────────────────────────────────┘
▼
┌── PostgreSQL ────────────────────────────────────────────────────────────────┐
│   session (DEV1-001 base) + Δ held_balance_lane varchar(20) NULL (REQ-013a)  │
│   session_request_idempotency (NEW TABLE, REQ-013b)                          │
│   students.balance_trial / balance_hifz / balance_tajweed (lane writes)      │
│   teacher (SELECT … FOR UPDATE certification lock)                           │
│   UNWRITTEN BY DESIGN: notifications, audit_logs, wallet,                    │
│   teacher_transaction, student_payments, reports, home_work, recitation      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Ruling (2026-08-30, orchestrator):** `INSUFFICIENT_BALANCE` is constructed as `ValidationError("INSUFFICIENT_BALANCE", …)` → HTTP **422** (REQ-050 is the spec authority; the PHASE-2 debit-ladder miss row in the diagram above was amended from `ConflictError(INSUFFICIENT_BALANCE)`). `ValidationError` already supports the `(code, message)` ctor (`backend/lib/errors.ts:65-130`) — NO class extension is needed for this code. The additive `ConflictError (code, message)` extension (task 2.8 prerequisite) remains REQUIRED for the other custom 409 codes: `TEACHER_NOT_CERTIFIED`, `SESSION_INVALID_TRANSITION`, `DUPLICATE_REQUEST`.

### 1.3 Transition Path — guarded single statements

```
startSession / completeSession / cancelSession (mutations)
  authScopes: $all{authenticated, role:[Teacher]}  (start/complete)
              { authenticated: true }              (cancel — participant
                                                   predicate is service-side)
  ▼
SessionLifecycleService.{start|complete|cancel}Session(...)
  ▼
ONE guarded UPDATE … WHERE id=? AND <ownership> AND <state-precondition>
                    [complete: AND EXISTS (SELECT 1 FROM teacher
                     WHERE teacher.id = session.teacher_id AND is_approved)]
                    … RETURNING *                ← predicate+mutation fused
  │ rows[0] → return row (cancel: SAME-tx lane re-increment, then return)
  └─ null   → ONE cold-path probe (findTransitionProbeForCaller) →
              nonexistent/foreign → NotFoundError("SESSION") SESSION_NOT_FOUND
              wrong state        → ConflictError SESSION_INVALID_TRANSITION
              complete+decertified → ConflictError TEACHER_NOT_CERTIFIED
              (probe NEVER influences writes — error-class disambiguation
               only; DEV1-005 D3 pattern)
```

### 1.4 Read Path

```
sessionById(id)  { authenticated: true }
  → service: repo.findById → null ⇒ null; row.studentId/teacherId vs
    ctx.user.id mismatch ⇒ null   (oracle-safe: nonexistent ≡ foreign)

myStudentSessions / myTeacherSessions  (role-gated lists)
  → ONE paged list query + ONE count query sharing ONE predicate builder
    WHERE student_id|teacher_id = ctx.user.id [AND status = filter]
    ORDER BY created_at DESC, id DESC  LIMIT/OFFSET
```

### 1.5 Key Design Decisions Table

| # | Decision | Options Considered | Pros / Cons | Rationale (Maintainability, Scalability, Reliability) |
|---|---|---|---|---|
| D1 | **Canonical names `SessionRepository` / `SessionLifecycleService` placed in the `classes` domain, staying clear of the future contract-implied `SessionService`** | (a) `session/` domain dir mirroring schema location ambiguity; (b) `classes/` domain matching the schema file's home | (a) Cons: the P2P session table physically lives under `backend/db/schema/classes/` — a parallel `sessions` domain would double the domain taxonomy. (b) Pros: repo/service/graphql subtrees mirror the existing sub-directory taxonomy (`classes/` exists today in schema and types ONLY — session enums live under `backend/enum/scheduling/`, and `backend/db/repo/classes/` + `backend/services/classes/` are created by this ticket); the `Lifecycle` suffix keeps the service clear of the future `SessionService` implied by `backend/types/contracts/session-request.contract.types.ts:3` (REQ-004 gate proves absence before authoring). | Consistency with the established sub-directory taxonomy; the future contract-implied `SessionService` name remains free for the contract consumer. |
| D2 | **Hold = guarded debit-at-request with trial-first ladder; same-lane refund on cancel** | (a) hold-as-flag-only (no debit until confirmation); (b) debit-at-request | (a) Cons: contradicts REQ-012/INV-B8 and the ticket AC's "released back to balance" semantics — an undebted lane has nothing to release; double-spend window opens (two concurrent requests against one unit both read `> 0`). (b) Pros: double-spend is structurally impossible (guarded `WHERE lane > 0` under row lock); cancel refund is a provable inverse operation. | REQ-012 + specs reconciliation note #2 (supersedes TEAM_ALLOCATION Contract-1's older phrasing). The guarded-debit pattern is the DEV1-004-proven `grantFreeTrialOnce` shape inverted (decrement instead of increment). |
| D3 | **Four-phase creation transaction: lock → debit → claim → insert (order is load-bearing)** | (a) claim first; (b) debit last; (c) the above order | (a) Cons: a 23505 replay discovered AFTER the debit leaves the debit refunded-but-session-shadowed bookkeeping mess or forces a compensation write. (b) Cons: a failed claim insert after a session insert = orphaned session without claim. (c) Pros: every failure class rolls back to zero rows; failed bookings never burn keys (claim rolls back with the tx); debit can never be stranded by a failed insert (debit precedes insert, shares its fate). | REQ-040. The order makes every intermediate failure mode invisible — rollback granularity per phase is unnecessary because the tx IS the granularity. |
| D4 | **Certification gate = `SELECT … FOR UPDATE` on the `teacher` row INSIDE the creation tx; re-asserted via EXISTS subquery inside the complete transition** | (a) plain read before insert (no lock); (b) lock in create + EXISTS in complete | (a) TOCTOU: admin decertification could land between check and insert → INV-S5 violated. (b) Locks the certification attribute for the create write window; the complete-time re-assertion is fused INTO the UPDATE predicate, so decertification-then-completion is a zero-row guarded miss, not a check-then-write race. | INV-S5 + `docs/backend/cross-stream-contracts.md` TOCTOU binding ("re-assert under `SELECT FOR UPDATE`"). Zero advisory locks; row locks carried by the statements themselves. |
| D5 | **Zero-row guarded update → ONE cold-path probe to disambiguate error CLASS (never influences writes)** | (a) SELECT-then-UPDATE on the hot path; (b) probe-first; (c) guard-first, probe-on-miss | (a)/(b) reintroduce TOCTOU on the state branch. (c) hot path is ONE statement; the probe runs only on the failure path and only chooses between `SESSION_NOT_FOUND` / `SESSION_INVALID_TRANSITION` / `TEACHER_NOT_CERTIFIED`. | DEV1-005 D3 precedent, proven by its chaos suite. The guarded UPDATE remains the ONLY mutation primitive for all three transitions. |
| D6 | **Idempotency via dedicated `session_request_idempotency` table; 23505 on the unique key → `DUPLICATE_REQUEST` conflict via the DEV1-002 cause-chain traversal; claim inserted in-phase so rollback releases the key; NO 24h sweeper in this ticket** | (a) Redis SET-NX-EX only; (b) DB claim table; (c) no idempotency | (a) Cons: Redis evictions/outages lose claims; booking-class mutations are reached by IDEMPOTENCY intent-consistency: `docs/IDEMPOTENCY.md`'s mandated Affected Operations list names Students/Invoices/Class Instances/Payments (the quota-era `class_instances` bookings) with NO explicit `session` entry — the claim table EXTENDS that class-instance mandate to session booking, plus the `DUPLICATE_REQUEST` contract in `docs/graphql/error-handling-contract.md`; the durable DB claim is the enforcement layer. (b) Pros: transactional fate-sharing with the booking itself; replay joins the existing claim to return the already-created session row (success-equivalent semantics per the error contract). Cons: one extra table + insert. (c) rejected outright — double-booking on network retries is the exact bug class. | REQ-014 + REQ-013(b). Idempotency is adopted by extension of `docs/IDEMPOTENCY.md`'s class-instance booking mandate plus the `DUPLICATE_REQUEST` contract in `docs/graphql/error-handling-contract.md` — no explicit `session` mandate exists in IDEMPOTENCY.md. Sweeper deferral documented (D2 ledger-adjacent; DEV3-012 owns lifecycle timing). |
| D7 | **`held_balance_lane` as nullable `varchar(20)` with `.$type<HeldBalanceLane>()` + TS enum + `isHeldBalanceLane` guard — NO new pgEnum** | (a) new pgEnum; (b) varchar + typed guard | (a) Cons: migration-time enum ceremony for a 3-value internal provenance vocabulary; the ApplicantStatus precedent (DEV1-001/DEV2-004) explicitly validated varchar+TS-enum. (b) Pros: zero DB enum churn; `.$type<>()` fixes inference at the source so `SessionSelectType.heldBalanceLane` is `HeldBalanceLane \| null` with NO casting anywhere (no `no-unsafe-enum-comparison` hazards). | REQ-013(a) + REQ-045. `docs/quality/linting-rules.md` §no-unsafe-enum-comparison prescribes exactly this `.$type` fix. |
| D8 | **authScopes use the `{$all: {authenticated, role:[…]}}` conjunction on role-gated ops; `{authenticated: true}` + service-side participant predicate on `cancelSession`/`sessionById`** | (a) plain `{ authenticated, role }` key-map; (b) `$all`; (c) role-gate cancel to both roles via two ops | (a) PROVEN WRONG in DEV2-004/DEV1-013: Pothos combines sibling keys with ANY semantics. (b) Correct: anonymous → 401 via thrown `UnauthorizedError`; wrong role → 403. (c) Cons: cancel is legitimately dual-role (either participant may cancel — Workflow 03); splitting into two ops duplicates guarded logic for zero security gain. | REQ-032. The `$all` semantics lesson is documented in `docs/teachers/applicant-lifecycle.md` §3 and is binding. The participant predicate (row's `student_id`/`teacher_id` vs `ctx.user.id`) is evaluated in SQL, not in input. |
| D9 | **Sessions are SENSITIVE — oracle-safe rulings everywhere (null on reads; `SESSION_NOT_FOUND` on mutations), deliberately the OPPOSITE of the DEV1-005 plan-catalog ruling** | (a) `FORBIDDEN` for foreign ids; (b) NOT_FOUND/null collapse | (a) turns the error channel into an existence oracle: foreign-vs-nonexistent distinctions leak private student↔teacher relationships. (b) foreign, nonexistent, and never-existed are observationally identical. | REQ-030/033 + REQ-J4. The canonical doc records the anti-copy-paste warning in BOTH directions (plans public ⇒ NOT_FOUND fine; sessions private ⇒ collapse mandatory). |
| D10 | **Platform fee from `shared/constants/session-fees.constants.ts` as decimal STRINGS; input structurally cannot carry fee** | (a) plan-lookup pricing now; (b) constant interim fees; (c) Float | (a) Cons: depends on DEV1-006 subscription↔plan linkage rules not yet landed; would entangle Sprint-1 scope. (b) Pros: B.3 honored (platform-set), zero float-precision hazard (DEV1-005 money discipline), fee never influential from the wire. (c) rejected — money-as-float is banned. | REQ-021 + REQ-031. Plan-linked pricing is an explicit forward contract → DEV3-013 (decisions addendum REQ-081). |
| D11 | **Zero side-effect writes outside {session, students-lane, claim} — enforced by grep gates + journey count-delta assertions, not by convention** | (a) emit notifications/audit inline "for convenience"; (b) strict absence | (a) Cons: couples the lifecycle core to DEV3-010's engine before it exists; shadows the future emitters' ownership; pollutes the audit trail with non-admin rows (JR-C-1-style findings). (b) Pros: INV-S3/INV-W4 hold BY ABSENCE; the forward seams are documented and tested as absent. | REQ-018/019. The notification wiring is DEV3-011's, audit is admin-action-scoped (A.5), wallet credit is DEV3-013's `fee_held` consumer. |
| D12 | **No DataLoader, no prepared statements, no `inArray` anywhere in the slice** | (a) add loaders "for future-proofing"; (b) plain parameterized queries | (a) Cons: flat single-table reads by PK/participant have no per-parent N+1 surface — loaders would be cargo cult (and `t.loadable()` can't return lists anyway). Prepared statements are read-only-path candidates only and unnecessary here. | REQ-047. Documented-N/A so reviewers don't flag absence as omission (`docs/graphql/dataloader-batching.md` forward contract for any future per-parent field). |

---

## 2. Data Models & Database Schema

### 2.1 Existing Schema Verification (READ-ONLY baseline)

`backend/db/schema/` is the sole structural ground truth; all dependencies exist from DEV1-001:

| Contract dependency | Existing implementation | Verified at |
|---|---|---|
| `session` base | `id` identity PK; `teacherId` NOT NULL FK→`teacher` (restrict); `studentId` NOT NULL FK→`students` (restrict); `status sessionStatus` default `'scheduled'`; `sessionType sessionType` default `'student_session'`; `intent sessionIntent` NULL; `fee decimal(10,2)` NULL; `feeHeld boolean` default `false`; `startedAt`/`endedAt`/`confirmedByStudentAt`/`confirmedByTeacherAt`/`confirmationDeadline` timestamps NULL; `createdAt`/`updatedAt` | `backend/db/schema/classes/session.ts` |
| `sessionStatus` enum | `["scheduled","started","completed","cancelled","disputed"]` (B.18's `disputed` present; unreachable from this ticket) | `backend/db/schema/enums.ts` |
| `sessionType` / `sessionIntent` enums | full value sets incl. `evaluation` (structurally rejected by this surface) | same file |
| `students` balance lanes | `balanceHifz`/`balanceReviews`/`balanceTajweed` (`int`, default 0, CHECK ≥ 0); `balanceTrial` NOT NULL DEFAULT 0 + CHECK; `trialGrantedAt` | `backend/db/schema/students/students.ts` |
| `teacher` certification flag | `isApproved boolean default false`; shared PK → `users.id` cascade | `backend/db/schema/teachers/teacher.ts` |
| `users` governance (A.7) | fail-closed governance enforced at login/SSR (DEV2-001/002) — the GraphQL context boundary carries NO governance filter; in this slice the service layer reads governance columns only for the acting-user re-check on create/start/complete (cancelSession exempt — Ruling 2026-08-30); journey fixtures materialize them | `backend/db/schema/users/users.ts` |

**Diff discipline (REQ-045):** at completion, `git diff backend/db/schema/** backend/db/migration/**` contains EXACTLY the two REQ-013 artifacts below and nothing else. `db reset`/`cleanGenerate` remain permanently disabled (`docs/DATABASE_MIGRATIONS.md`); the deltas apply via `bun run db push` in the same commit set as the code.

### 2.2 Schema Delta (a) — `session.held_balance_lane` (REQ-013a)

```ts
// backend/db/schema/classes/session.ts — ADDED column only:
import type { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";

heldBalanceLane: varchar("held_balance_lane", { length: 20 }).$type<HeldBalanceLane>(),
```

- Nullable by design: `NULL` while unheld / after release / after confirmation; populated exactly when `feeHeld = true`.
- NO new CHECK constraint (lane vocabulary is app-layer guarded per the ApplicantStatus-varchar precedent); NO index (never queried by lane).
- `.$type<HeldBalanceLane>()` flows the enum into `$inferSelect`/`$inferInsert` — zero enum casts anywhere downstream.

### 2.3 Schema Delta (b) — `session_request_idempotency` table (REQ-013b)

```ts
// backend/db/schema/classes/session-request-idempotency.ts (NEW FILE)
import { integer, pgTable, timestamp, unique, index, varchar } from "drizzle-orm/pg-core";
import { session } from "@/backend/db/schema/classes/session";
import { users } from "@/backend/db/schema/users/users";

export const sessionRequestIdempotency = pgTable(
  "session_request_idempotency",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").references(() => session.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    unique("session_request_idempotency_key_unique").on(t.idempotencyKey),
    index("session_request_idempotency_user_id_idx").on(t.userId),
  ],
);
```

Barrel: add `export * from "./session-request-idempotency";` to `backend/db/schema/classes/index.ts`. No top-level barrel change (`classes` is already re-exported).

### 2.4 Canonical Enum — `HeldBalanceLane` (NEW, TypeScript-only)

```ts
// backend/enum/scheduling/held-balance-lane.enum.ts (NEW)
export enum HeldBalanceLane {
  Trial = "trial",
  Hifz = "hifz",
  Tajweed = "tajweed",
}

export function isHeldBalanceLane(value: unknown): value is HeldBalanceLane {
  return typeof value === "string" && (Object.values(HeldBalanceLane) as string[]).includes(value);
}
```

Barrel: `backend/enum/scheduling/index.ts` += `export * from "./held-balance-lane.enum";` (top-level `backend/enum/index.ts` already re-exports `./scheduling`). Value import at runtime everywhere; NO GraphQL exposure (the lane is server-internal provenance — it never appears in SDL, so NO Pothos registration and NO codegen enum entry).

### 2.5 Canonical Types

**`backend/types/classes/session.types.ts` (EXTENDED additively — existing `SessionSelectType`/`SessionInsertType` unchanged):**

```ts
import type { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import type { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { session } from "@/backend/db/schema/classes/session";

// existing (UNCHANGED): SessionSelectType, SessionInsertType

/** Canonical GraphQL/API read shape. `heldBalanceLane` is HeldBalanceLane-typed
 *  via the column's .$type<> marker — no Omit/re-typing needed and NO forbidden
 *  fields exist on this table (participant ids are exposed deliberately; REQ-060). */
export type SessionReturnType = SessionSelectType;

/** Hifz | Tajweed only — the evaluation member is structurally unreachable. */
export type SessionStudentIntentType = SessionIntent.Hifz | SessionIntent.Tajweed;

/** Create input: client-controlled whitelist ONLY (BOPLA, REQ-031).
 *  studentId/fee/status/sessionType/feeHeld/deadlines/heldBalanceLane are
 *  structurally absent by construction. */
export interface SessionSubmitInput {
  readonly teacherId: number;
  readonly intent: SessionStudentIntentType;
}

/** List filters (REQ-020). Empty/absent members drop out — never error. */
export interface SessionListFilterInput {
  readonly status?: SessionStatus | null;
}

export interface SessionPageReturnType {
  readonly items: readonly SessionReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Cold-path probe row for error-class disambiguation (D5). */
export type SessionTransitionProbeRowType = Pick<
  SessionSelectType, "id" | "status" | "studentId" | "teacherId"
>;
```

**`backend/types/classes/session-request-idempotency.types.ts` (NEW):**

```ts
import type { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
export type SessionRequestIdempotencySelectType = typeof sessionRequestIdempotency.$inferSelect;
export type SessionRequestIdempotencyInsertType = typeof sessionRequestIdempotency.$inferInsert;
```

Barrels: `backend/types/classes/index.ts` += `export * from "./session-request-idempotency.types";` (`session.types` is already exported). No service-layer `.types.ts`; `DBTransaction` from `@/backend/types` only; no local Pothos types. A static conformance assertion (journey-adjacent unit test) proves the phase-4 insert shape `satisfies SessionRequestContract`'s invariants (`feeHeld: true` literal, non-null `fee`/`confirmationDeadline`, `intent ∈ Hifz|Tajweed`, idempotency key carried) — consuming `backend/types/contracts/session-request.contract.types.ts`, never redefining it.

### 2.6 Shared Constants — platform fees (B.3 / REQ-021)

```ts
// shared/constants/session-fees.constants.ts (NEW — zero imports; shared-layer pure)
export const SESSION_FEE_HIFZ = "25.00";
export const SESSION_FEE_TAJWEED = "25.00";
export const SESSION_FEE_CURRENCY = "EGP";
export const SESSION_CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
```

- `shared/constants/index.ts` gains one line: `export * from "./session-fees.constants";`.
- Decimal STRINGS end-to-end (Drizzle `decimal` infers as string; SDL `String`; UI renders verbatim). Zero arithmetic is performed on fees anywhere in this ticket (money discipline per DEV1-005 D4).

### 2.7 i18n Data Contract

**(a) `errors` namespace — new FLAT domain-prefixed keys (REQ-051):**

| File | Change |
|---|---|
| `shared/locale/types/errors/index.ts` | Add FLAT domain-prefixed keys to the existing FLAT `ErrorsLabels` interface (NO nested `sessions: {…}` grouping — the interface holds domain-prefixed keys such as `applicantNotFound`): `sessionNotFound: string; sessionInvalidTransition: string; teacherNotCertified: string; teacherNotFound: string; insufficientBalance: string; idempotencyKeyRequired: string; invalidSessionIntent: string;` **Ruling (2026-08-30, orchestrator):** these are REQ-051's EXACT seven keys — the single source of truth; the previous `session*`-renamed spellings (`sessionTeacherNotCertified`, `sessionTeacherNotFound`, `sessionInsufficientBalance`, `sessionIdempotencyKeyRequired`, `sessionInvalidIntent`) are DROPPED. `TEACHER_NOT_FOUND` maps onto the NEW `teacherNotFound` key, NOT the pre-existing generic `notFound`. |
| `shared/locale/en/errors/index.ts` | English implementations |
| `shared/locale/ar/errors/index.ts` | Arabic implementations (natural RTL phrasing) |

Existing keys are REUSED, never near-duplicated: `duplicateRequest`, `validation`, `forbidden`, `unauthorized`, `notFound`, `internalServerError` come from the existing `errors` registry (`notFound` remains reused by its existing generic consumers — it is no longer the mapping target for `TEACHER_NOT_FOUND`). Compile-time `Translations` parity is the gate (missing ar/en key ⇒ `tsgo` failure). REQ-051's "FLAT domain-prefixed" phrasing is resolved as: flat camelCase keys on `ErrorsLabels` — `teacher*`/`insufficientBalance` members spelled exactly as REQ-051 lists them, with NO forced `session` prefix and NO nested grouping.

**(b) NEW `sessions` UI namespace (REQ-065)** — full registration per the namespace-registration checklist in `shared/AGENTS.md` (types interface → `en` + `ar` implementations → entry on the top-level `Translations` interface (`shared/locale/types/message.ts`) → namespace-path registration), with the handle const built via `defineNamespace` per `shared/locale/namespaces/define-namespace.ts`:
- Page chrome: `studentPageTitle`, `teacherPageTitle`, `statusFilterAll`, list column labels (`status`, `intent`, `fee`, `deadline`, `createdAt`), empty-state title/body for both pages.
- Status chips (per `SessionStatus` member): `statusScheduled`, `statusStarted`, `statusCompleted`, `statusCancelled`, `statusDisputed` (translated even though unreachable here — the chip vocabulary must not fork later).
- Action copy: `startSession`, `completeSession`, `cancelSession`, `cancelConfirmTitle`, `cancelConfirmBody`, `cancelReasonLabel` (optional reason field), `cancelReasonPlaceholder`.
- Feedback: `sessionStartedNotice`, `sessionCompletedNotice`, `sessionCancelledNotice`, `holdReleasedNotice`, `duplicateBookingInfo` (success-equivalent), generic error-state copy.

Consumption: client components via the new `Sessions` handle const (`useAppTranslation(Sessions)` with property access — namespaces are `defineNamespace` handle consts; NO `Translation` enum exists); Server Components via `await getTranslations(locale)`; resolvers via `ctx.t("errors")`; services via the ONE-arg `getServerTranslations(locale)` returning the full `Translations` tree with property access (e.g. `.errorsTranslations`), per `shared/locale/server-graphql.ts`.

---

## 3. API Contracts & Pothos Resolvers

### 3.1 GraphQL Schema Additions (exact contract — REQ-060)

```graphql
extend type Query {
  sessionById(id: ID!): Session
  myStudentSessions(filter: SessionListFilterInput, page: Int = 1, pageSize: Int = 25): SessionPage!
  myTeacherSessions(filter: SessionListFilterInput, page: Int = 1, pageSize: Int = 25): SessionPage!
}

extend type Mutation {
  createSession(input: CreateSessionInput!): Session!
  startSession(id: ID!): Session!
  completeSession(id: ID!): Session!
  cancelSession(id: ID!, reason: String): Session!
}

type Session {
  id: ID!
  teacherId: ID!
  studentId: ID!
  status: SessionStatus!
  sessionType: SessionType!
  intent: SessionIntent
  fee: String
  feeHeld: Boolean!
  startedAt: DateTime
  endedAt: DateTime
  confirmedByTeacherAt: DateTime
  confirmedByStudentAt: DateTime
  confirmationDeadline: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}

type SessionPage {
  items: [Session!]!
  totalCount: Int!
  page: Int!
  pageSize: Int!
}

input CreateSessionInput {
  teacherId: ID!
  intent: SessionIntent!
}

input SessionListFilterInput {
  status: SessionStatus
}
```

- `heldBalanceLane` is deliberately ABSENT from SDL — internal provenance, never client-consumed (its presence would invite client-trust of a raceable value).
- `id` FIRST on `Session` (Apollo normalization rule); `teacherId`/`studentId` exposed intentionally (both are known to every authorized viewer of a row by construction — REQ-060).
- No `disputed` producer exists; the enum member exists in the enum without any transition surface (B.18 → DEV3-022).
- Timestamp fields use the `DateTime` scalar (registered in `backend/graphql/pothos/shared/scalar.pothos.ts` via `DateTimeResolver` from `graphql-scalars`; typed on the builder's `Scalars` slot as `{ Input: Date; Output: Date | string }`; precedent: `backend/graphql/pothos/teachers/applicant.pothos.ts` — wire format is ISO-8601 UTC, codegen maps `DateTime → string`); REQ-060/REQ-074 parity assertions test this `DateTime` shape.

### 3.2 Pothos Definition Details

| Concern | Contract |
|---|---|
| Files | `backend/graphql/pothos/classes/session.pothos.ts` (object + page wrapper); `backend/graphql/query/classes/session-lifecycle.query.ts`; `backend/graphql/mutation/classes/session-lifecycle.mutation.ts`; domain barrels registered via side-effect imports per gateway Rule 8 (`docs/graphql/api-gateway-and-routing.md`) |
| Object | Single canonical `SessionPothosObject = gqlSchemaBuilder.objectRef<SessionReturnType>("Session").implement({...})`; `SessionPage` wrapper allowed by the single-canonical-type exception policy (list/pagination wrapper) |
| Enums | Verify-first against `backend/graphql/pothos/shared/enum.pothos.ts`; register ONLY the missing among `SessionStatus`/`SessionIntent`/`SessionType` via enum-object form (`gqlSchemaBuilder.enumType(SessionStatus, { name: "SessionStatus" }`) — literal-array registration and re-registration both prohibited (CRITICAL rule) |
| authScopes | `createSession`/`myStudentSessions`: `{ $all: { authenticated: true, role: [UserRole.Student] } }` · `startSession`/`completeSession`/`myTeacherSessions`: `{ $all: { authenticated: true, role: [UserRole.Teacher] } }` · `sessionById`/`cancelSession`: `{ authenticated: true }` (participant predicate is service-side; REQ-032/D8) |
| Resolver bodies | Thin delegation only: boundary id parsing → `SessionLifecycleService.<method>(ctx.user.id, …, ctx.locale)`; ZERO business logic, ZERO repository calls, top-level static imports ONLY (`await import(` = A1 static-assertion failure); `UserRole` is a VALUE import from `@/backend/enum/users/user-role.enum` |
| Allowlist | `backend/lib/gateway/public-operations.ts` UNTOUCHED — all seven operations carry scopes; the 1:1 allowlist-coverage gate stays green |
| Idempotency header | `ctx.idempotencyKey` consumed exactly as captured by `createGraphQLContext` (capture contract: `docs/graphql/api-gateway-and-routing.md` Rule 3; PROPAGATION-ONLY; never re-derived, never influences authorization); missing/empty on `createSession` → service throws `VALIDATION` (`idempotencyKeyRequired`) pre-DB |
| Codegen | `bun run generate:gqlSchema && bun codegen`; generated artifacts committed in the same change set; SDL diff contains ONLY this ticket's additions |

### 3.3 Error → `extensions.code` Map (REQ-050)

| Condition | Class | `extensions.code` | Semantics |
|---|---|---|---|
| Anonymous on any op | `UnauthorizedError` (scopeAuth, `$all` authenticated leg) | `UNAUTHORIZED` | 401 |
| Authenticated, wrong role on role-gated op | Pothos scope fails closed | `FORBIDDEN` | 403 |
| `sessionById` foreign/nonexistent id | — (null payload, oracle-safe) | *(no error)* | null channel |
| Mutation on foreign/nonexistent id | `NotFoundError("SESSION", msg)` | `SESSION_NOT_FOUND` | 404-class, oracle-safe |
| Foreign/nonexistent `teacherId` target (incl. applicants) | `NotFoundError("TEACHER", msg)` | `TEACHER_NOT_FOUND` | 404-class |
| `teacher` row exists, `isApproved=false` (create) / decertified (complete) | `ConflictError` via the additively-extended overloaded `(code, message)` constructor (see note below) | `TEACHER_NOT_CERTIFIED` | 409 |
| Both lanes empty at booking | `ValidationError("INSUFFICIENT_BALANCE", …)` via the EXISTING overloaded `(code, message)` constructor (no class extension needed) | `INSUFFICIENT_BALANCE` | 422 |
| Terminal/regressive state transition | `ConflictError` via the same overloaded `(code, message)` constructor | `SESSION_INVALID_TRANSITION` | 409 |
| Missing/empty idempotency key; bad id shape; `intent=evaluation`; bad filter/pagination | `ValidationError` (custom code where listed) | `VALIDATION` | 422, pre-DB |
| Idempotency replay of an already-applied booking | `ConflictError` via the same overloaded constructor on the replay branch | `DUPLICATE_REQUEST` | 409, success-equivalent UX (error-handling contract §Client mapping) |
| Unexpected driver failure | masked at the DEV3-002 boundary | `INTERNAL_SERVER_ERROR` | 500 |

`NotFoundError` receives entity NAMES (`"SESSION"` / `"TEACHER"`), never full codes (double-suffix rule, `docs/graphql/domain-error-extensions-code.md`). **Custom-code decision (decisive, REQ-052):** `ConflictError` as shipped (`backend/lib/errors.ts:159-163`) has a FIXED `(message, options?)` constructor hardcoding code `"CONFLICT"` — no custom-code facility exists on it today — the ONLY custom-code facility in `backend/lib/errors` is `ValidationError`'s overloaded constructor. This ticket SHALL additively extend `ConflictError` with an overloaded `(code, message)` constructor mirroring the `ValidationError` overload precedent (`backend/lib/errors.ts:65-130`, documented in `docs/graphql/domain-error-extensions-code.md`); where a constructible class already fits the need, `DomainError(code, message)` MAY be used directly instead. The §3.3 rows keep their codes and HTTP statuses unchanged EXCEPT the `INSUFFICIENT_BALANCE` row (amended per the ruling below); the mechanism choice is recorded in the outcome file. **Ruling (2026-08-30, orchestrator):** `INSUFFICIENT_BALANCE` is a `ValidationError` row — spec REQ-050 is the authority: it is constructed as `ValidationError("INSUFFICIENT_BALANCE", …)` on the ALREADY-EXISTING `(code, message)` overload (`errors.ts:65-130`) → **422**, NOT ConflictError/409 (this §3.3 row and plan §1.2's diagram were amended accordingly; task 2.8's implementer must NOT route this code through the extended `ConflictError`). No class extension is needed for this code. The additive `ConflictError (code, message)` extension remains required for the remaining custom 409 codes: `TEACHER_NOT_CERTIFIED`, `SESSION_INVALID_TRANSITION`, `DUPLICATE_REQUEST`.

### 3.4 Permission Matrix (REQ-064)

| Caller | `createSession` | `myStudentSessions` | `startSession`/`completeSession` | `myTeacherSessions` | `cancelSession` | `sessionById` | `/student/sessions` | `/teacher/sessions` |
|---|---|---|---|---|---|---|---|---|
| Anonymous | `UNAUTHORIZED` | `UNAUTHORIZED` | `UNAUTHORIZED` | `UNAUTHORIZED` | `UNAUTHORIZED` | `UNAUTHORIZED` | redirect `/login?redirect=…` | redirect `/login?redirect=…` |
| Student | ✅ (own id server-side) | ✅ own | `FORBIDDEN` | `FORBIDDEN` | ✅ own; foreign → `SESSION_NOT_FOUND` | own ✅ / foreign `null` | ✅ | redirect to role dashboard (`roleDashboardPath(ctx.role)`) |
| Certified teacher | `FORBIDDEN` | `FORBIDDEN` | ✅ own; foreign/wrong state → typed conflict | ✅ own | ✅ own; foreign → `SESSION_NOT_FOUND` | own ✅ / foreign `null` | redirect to role dashboard (`roleDashboardPath(ctx.role)`) | ✅ |
| Teacher applicant (no `teacher` row) | `FORBIDDEN` | `FORBIDDEN` | no session can exist for him | ✅ (always empty) | `SESSION_NOT_FOUND` | `null` | redirect to role dashboard (`roleDashboardPath(ctx.role)`) | ✅ (empty) |
| Parent | `FORBIDDEN` | `FORBIDDEN` | `FORBIDDEN` | `FORBIDDEN` | `SESSION_NOT_FOUND` (authenticated, never participant) | `null` | redirect to role dashboard (`roleDashboardPath(ctx.role)`) | redirect to role dashboard (`roleDashboardPath(ctx.role)`) |
| Super Admin | `FORBIDDEN` | `FORBIDDEN` | `FORBIDDEN` | `FORBIDDEN` | `SESSION_NOT_FOUND` (NO admin bypass — DEV3-021 owns the future surface) | `null` | redirect to role dashboard (`roleDashboardPath(ctx.role)`) | redirect to role dashboard (`roleDashboardPath(ctx.role)`) |

**Rulings (2026-08-30, orchestrator):** (1) **`createSession` × teacher = `FORBIDDEN`, unconditional in this slice** — REQ-011's teacher-holding-a-`students`-row carve-out is struck and deferred → deferred-items **D7** (future ticket); REQ-032's static `role:[UserRole.Student]` scope stands unchanged; INV-TV6's honest-denial intent for applicant teachers is preserved (they fail the role scope like any non-student — honest denial, never an existence oracle). Student identity on the happy path still resolves server-side through the `students.id = ctx.user.id` shared PK. (2) **REQ-023 service-layer governance re-check: SHALL honored with a bounded scope** — `SessionLifecycleService` re-checks the ACTING user's governance status (deleted/blocked/suspended per REQ-023's own wording) on `createSession` (student), `startSession` (teacher), `completeSession` (teacher) — governed → `FORBIDDEN` (defense-in-depth behind the login/SSR boundary). `cancelSession` is EXPLICITLY EXEMPT — a governed student may still cancel in-flight sessions (preserving REQ-023's no-punishment clause and its cancel-must-still-work tension note). The context boundary itself carries NO governance filter (`createGraphQLContext`/`UserRepository.findById`) and the plan makes no enforcement claim about it — login/SSR (`backend/services/auth/auth.service.ts` / `frontend/lib/auth/server-auth.ts`) remain the primary fail-closed boundary (REQ-023). All role-mismatch redirects target the caller's role-specific dashboard via `roleDashboardPath(ctx.role)` (`frontend/lib/auth/withPageAuth.ts:81-87`) — bare `/dashboard` is FORBIDDEN as a redirect target (`frontend/lib/auth/roleDashboardRoute.ts`).

---

## 4. Backend Services, Repositories & Concurrency Model

### 4.1 New Service — `backend/services/classes/session-lifecycle.service.ts`

```ts
export namespace SessionLifecycleService {
  // CREATE (REQ-010..014, REQ-040)
  createSession(
    studentId: number,
    input: SessionSubmitInput,
    idempotencyKey: string,          // pre-validated non-empty by resolver-premise + re-guarded
    locale: string,
    outerTx?: DBTransaction,
  ): Promise<SessionReturnType>;

  // TRANSITIONS (REQ-015..017, REQ-041/042)
  startSession(teacherUserId: number, sessionId: number, locale: string, tx?: DBTransaction): Promise<SessionReturnType>;
  completeSession(teacherUserId: number, sessionId: number, locale: string, tx?: DBTransaction): Promise<SessionReturnType>;
  cancelSession(callerUserId: number, sessionId: number, reason: string | null, locale: string, outerTx?: DBTransaction): Promise<SessionReturnType>;

  // READS (REQ-020)
  getSessionById(callerUserId: number, sessionId: number, tx?: DBTransaction): Promise<SessionReturnType | null>;
  listMyStudentSessions(studentId: number, filter: SessionListFilterInput, page: number, pageSize: number, tx?: DBTransaction): Promise<SessionPageReturnType>;
  listMyTeacherSessions(teacherId: number, filter: SessionListFilterInput, page: number, pageSize: number, tx?: DBTransaction): Promise<SessionPageReturnType>;
}
```

Method contracts:

- **`createSession`** — pre-DB boundary validation: `idempotencyKey` non-empty ≤128 (`idempotencyKeyRequired`); `teacherId`/`studentId` positive safe integers via a type guard (never `as number`); `intent` must satisfy `intent === SessionIntent.Hifz || intent === SessionIntent.Tajweed` (else `VALIDATION` + `invalidSessionIntent`). Capture ONE `now` (REQ-046). Then `withTransaction(outerTx)`: **the DEV1-002 SAVEPOINT-aware `withTransaction` helper is today MODULE-PRIVATE inside `backend/services/auth/registration.service.ts:128-136` and is NOT importable — an explicit EARLY task SHALL extract it into a shared location (or re-implement it locally with the same SAVEPOINT semantics) before the service consumes it:**
  1. `TeacherRepository.lockForCertificationCheck(input.teacherId, tx)` → `null` → `NotFoundError("TEACHER", t.teacherNotFound)` (an applicant's users.id dies HERE — INV-TV1); `isApproved === false` → `ConflictError(TEACHER_NOT_CERTIFIED, …)` via the §3.3 extended constructor.
  2. Debit ladder: `StudentRepository.decrementLaneIfAvailable(studentId, HeldBalanceLane.Trial, tx)`; if it returned false and `intent === Hifz` → `…(studentId, HeldBalanceLane.Hifz, tx)`; if `Tajweed` → the tajweed lane; all miss → `ValidationError("INSUFFICIENT_BALANCE", …)` → 422 (Ruling 2026-08-30 — REQ-050; see §3.3); the transaction roll-back is the only cleanup (zero partial state).
  3. `SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey, userId: studentId, sessionId: null }, tx)` — 23505 on `session_request_idempotency_key_unique` → cause-chain traversal (DEV1-002 `isUniqueViolation` precedent, cycle-safe, NEVER reading `.code` off the top-level Drizzle error) → replay branch: fetch the existing claim's `sessionId` and return the ALREADY-CREATED session row if present (success-equivalent `DUPLICATE_REQUEST` semantics; if the claim is true but the session join is absent the claim was a stale orphan — surface `DUPLICATE_REQUEST` identically; recovery resolution is documented in the canonical doc).
  4. `SessionRepository.insertSession({ teacherId, studentId, status: SessionStatus.Scheduled, sessionType: SessionType.StudentSession, intent: input.intent, fee: <constant for intent>, feeHeld: true, confirmationDeadline: new Date(now.getTime() + SESSION_CONFIRMATION_WINDOW_MS) }, tx)` → `RETURNING` row; then backfill the claim (`updateClaimSessionId(claimId, newSessionId, tx)`).
  - Static conformance: the insert object literal is type-pinned against `SessionRequestContract`'s invariants via a `satisfies`-adjacent assertion in tests (feeHeld literal `true`, non-null fee/deadline, idempotency key present).
  - `reason` on cancel: validated (≤500 chars, trimmed) and DISCARDED — never persisted in this ticket (DEV3-005's status-history seam owns persistence; REQ-031 documents this).
- **`startSession`** — `SessionRepository.startSessionOnce(sessionId, teacherUserId, tx)`; null → probe classification → errors per §3.3. `startedAt`/`updatedAt` written from one captured `now`; `confirmationDeadline` NEVER touched.
- **`completeSession`** — `completeSessionOnce` (guarded UPDATE with fused `EXISTS (SELECT 1 FROM teacher WHERE teacher.id = session.teacher_id AND teacher.is_approved = true)`); null → probe → wrong-state vs decertified vs not-found classification. Sets `status=completed`, `endedAt`, `confirmedByTeacherAt`, `updatedAt` from one `now`. Writes ZERO report/homework rows (INV-S7 enforcement is DEV3-005 — D5 ledger).
- **`cancelSession`** — `withTransaction(outerTx)`: `cancelSessionOnce(sessionId, callerUserId, tx)` (`WHERE id=? AND (student_id=? OR teacher_id=?) AND status IN ('scheduled','started') RETURNING *`); null → probe (`SESSION_NOT_FOUND` non-participant/nonexistent, else `SESSION_INVALID_TRANSITION` — terminal states collapse here, so double-cancel can NEVER double-refund). On success: if `row.heldBalanceLane !== null` → `StudentRepository.incrementLane(row.studentId, row.heldBalanceLane, tx)` (unguarded increment — no upper bound exists; CHECK `>= 0` cannot trip on `+1`); the refund ALWAYS returns to the lane that paid (trial→trial, paid→paid). Cancelled rows keep `startedAt` as-is and never get `endedAt`.
- **Reads** — `getSessionById`: `findById` → null ⇒ null; `row.studentId !== caller && row.teacherId !== caller` ⇒ null (constant-shape oracle safety, D9). Lists: ONE shared predicate-builder module-scope helper producing `WHERE (student_id|teacher_id) = $1 [AND status = $2]`, consumed by both list and count so `totalCount` can never diverge from the filtered set; ordering `createdAt DESC, id DESC`; page bounds validated pre-DB (`page ≥ 1`, `pageSize ∈ 1..50`, default 25); `hasMore`-style math is replaced by the honest `{ totalCount, page, pageSize }` echo (out-of-range page ⇒ empty `items` + honest count).
- **Logging (REQ-036)** — expected rejections via `logger.logDomainError` with `{ code, entity: "session", entityId? }` ONLY (never the other party's identity, never lane values, never the idempotency key, never titles/payloads); unexpected → `logger.error`; `console.*` prohibited in the whole diff.
- **Side-effect absence (REQ-018/019)** — the service file physically imports NOTHING related to `notifications`, `audit_logs`, `wallet`, `teacher_transaction`, `student_payments`, `reports`, `home_work`, `recitation`; a grep-level static assertion enforces this in the verification suite; the journey suite asserts it behaviorally via row-count deltas (§4.5).

### 4.2 Repositories

**`backend/db/repo/classes/session.repository.ts` (NEW namespace `SessionRepository`)** — every method's LAST parameter is `tx?: DBTransaction`; non-transactional reads use the `queryDb(tx)` Neon-HTTP-eligible pattern (`backend/db/repo/AGENTS.md`); NO prepared statements (all queries are dynamic variants); NO `inArray`; NO `sql` templates with inline `--` comments anywhere in this slice.

| Method | Signature essence | Notes |
|---|---|---|
| `insertSession` | `(insert: SessionInsertType, tx?) → SessionSelectType` | one `INSERT … RETURNING *` |
| `findById` | `(id: number, tx?) → SessionSelectType \| null` | PK read |
| `startSessionOnce` | `(id, teacherId, tx?) → SessionSelectType \| null` | `WHERE id AND teacher_id AND status='scheduled'`; sets `startedAt/updatedAt` |
| `completeSessionOnce` | `(id, teacherId, tx?) → SessionSelectType \| null` | `WHERE id AND teacher_id AND status='started' AND EXISTS(certified teacher)` — certification fused INTO the statement |
| `cancelSessionOnce` | `(id, participantId, tx?) → SessionSelectType \| null` | `WHERE id AND (student_id=? OR teacher_id=?) AND status IN ('scheduled','started')`; sets `status='cancelled'`, `feeHeld=false`, `updatedAt` |
| `findTransitionProbe` | `(id, tx?) → SessionTransitionProbeRowType \| null` | cold-path probe ONLY (never written from) |
| `listForStudent` / `listForTeacher` | `(ownerId, filter, limit, offset, tx?) → rows` | shared predicate helper; `ORDER BY created_at DESC, id DESC` |
| `countForStudent` / `countForTeacher` | `(ownerId, filter, tx?) → number` | SAME predicate helper as list |

**`backend/db/repo/classes/session-request-idempotency.repository.ts` (NEW namespace `SessionRequestIdempotencyRepository`):**

| Method | Notes |
|---|---|
| `insertClaim(insert: SessionRequestIdempotencyInsertType, tx?) → SessionRequestIdempotencySelectType` | one INSERT; 23505 surfaces to the service's cause-chain handler |
| `updateClaimSessionId(claimId, sessionId, tx?)` | phase-4 backfill inside the same tx |
| `findByKey(key, tx?)` | replay-branch join to the already-created session |

**Repository work on the other two domains — ONE newly-created repository (teachers) + additive methods on the EXISTING `StudentRepository` (never fork, never re-implement):**

`backend/db/repo/teachers/` today contains ONLY `applicant.repository.ts` + `index.ts` — no `TeacherRepository` symbol exists anywhere in the codebase. This ticket therefore CREATES `backend/db/repo/teachers/teacher.repository.ts` with the NEW `TeacherRepository` namespace and adds its line to the `backend/db/repo/teachers/index.ts` barrel.

| Repository | Addition | Statement shape |
|---|---|---|
| `TeacherRepository` (NEW — `backend/db/repo/teachers/teacher.repository.ts`, new namespace + barrel line) | `lockForCertificationCheck(teacherId: number, tx): Promise<{ id: number; isApproved: boolean \| null } \| null>` | `SELECT id, is_approved FROM teacher WHERE id = $1 FOR UPDATE` via Drizzle `.for("update")`; write-path — NO prepared statement |
| `StudentRepository` (`backend/db/repo/students/student.repository.ts`) | `decrementLaneIfAvailable(studentId, lane: HeldBalanceLane, tx): Promise<boolean>` | ONE guarded conditional UPDATE per lane mapping: `UPDATE students SET balance_<lane> = balance_<lane> - 1, updated_at = now() WHERE id = $1 AND balance_<lane> > 0` returning row presence — the lane column is chosen from a frozen `{ lane → column }` map keyed by enum members (never string keys from callers) |
| `StudentRepository` (same) | `incrementLane(studentId, lane: HeldBalanceLane, tx): Promise<void>` | unguarded `+ 1` refund increment (REQ-017 ruling: no upper bound exists; row existence guaranteed by the session's restrict FK) |

Repo files contain ZERO business logic, ZERO i18n imports, ZERO log strings.

### 4.3 Concurrency & Race Condition Assessment

| Scenario | Actors | Risk | Mitigation |
|---|---|---|---|
| Double-start (two tabs / retries) | teacher × 2 | duplicate transition | Guarded `status='scheduled'` predicate; second matches zero rows → probe → `SESSION_INVALID_TRANSITION`. REQ-043(a) `Promise.allSettled` proof: exactly one success, final `started`, `startedAt` written once. |
| start ⚡ cancel race | teacher vs student | interleaving divergence | Both transitions are single guarded statements over the same row — PostgreSQL row locking serializes them; EXACTLY ONE wins; the winner's outcome is the final state; refund happens iff cancel won (REQ-043(b)). |
| Double-complete | teacher × 2 | duplicate `confirmedByTeacherAt` churn | Guarded `status='started'`; second matches zero → `SESSION_INVALID_TRANSITION`; timestamp written exactly once (REQ-043(c)). |
| Two concurrent creations against a student holding exactly ONE unit (trial-only) | student retries / two tabs | double-spend (INV-B1/B4 violation) | Both creations contend on the SAME `students` row: the trial-lane guarded decrement serializes on the row lock; the loser re-evaluates `balance_trial > 0` against the committed `0`, matches zero rows, falls to the intent lane, misses → `INSUFFICIENT_BALANCE` and full rollback. REQ-043(d) proof: exactly one session, lane never negative, CHECKs intact. |
| Same idempotency key replayed N times concurrently | client retry storm | N sessions for one intent | The claim's unique index is the arbiter: exactly one INSERT wins; losers get 23505 → `DUPLICATE_REQUEST` replay branch returning the already-created session. REQ-043(e): one session row, one debit, N−1 duplicates. |
| Failed booking burns the key | client legitimate retry after server failure | key wedged forever | The claim shares the creation tx — a failed booking rolls the claim back with everything else, so the SAME key is accepted on retry (REQ-073 proof: failed attempt → identical retry succeeds). |
| Certification flip mid-create | admin / DEV2-stream writer vs student create | INV-S5 race | Teacher row is `FOR UPDATE`-locked for the transaction (D4); the certification value read is the value the insert commits against. |
| Decertified teacher completes a session | teacher + admin decertify (post-create) | escro-ward drift toward a decertified teacher | Complete's `EXISTS` subquery is evaluated UNDER the statement's row lock; decertified → zero rows → probe → `TEACHER_NOT_CERTIFIED` (REQ-016). |
| Cancel after completed (double-refund probe) | student/teacher | refund of an already-earned advisory state | `status IN ('scheduled','started')` excludes `completed`; → `SESSION_INVALID_TRANSITION`; zero refund (REQ-042 exact-refund-once assertion across two replays). |
| Terminal-state regression (ANY actor, ANY transition) | any | INV-S1/S2 breach | Structural: every reachable predicate excludes `completed`/`cancelled`; REQ-072's full legality matrix (4 states × 3 actions) proves every illegal pair fails typed. |
| Report/notification/wallet side effects sneaking in | code review gap | INV-S3/W4/A4/A5 violation | REQ-019 by absence: import grep gates + journey count-delta assertions on `notifications`/`audit_logs`/`wallet`/`teacher_transaction`/`reports`/`home_work` all equal zero. |
| TOCTOU on the probe | post-guard-miss classification | wrong error CLASS | The probe is classification-only and never affects writes; sessions referenced by an id probe cannot be hard-deleted (no delete surface exists — INV-S-adjacent permanence + INV-U4); state flips between guard and probe can misclassify NOT_FOUND-vs-INVALID only when the row flipped BECAUSE the caller's own raced transition landed — message correctness at response time is preserved because the row IS now in the post-state. Documented per DEV1-005 D3. |

**Locking summary:** ONE `SELECT … FOR UPDATE` (teacher certification lock in create); every other mutation is a single guarded conditional statement whose predicate rides the row lock. NO advisory locks; NO Redis/`SET NX EX` in this slice (idempotency lives in the DB claim table by design); NO module-level mutable state in any new module (REQ-047). **TOCTOU windows: zero on all writes** — every predicate and its mutation share one statement. The only advisory window (`is_online` availability) is deliberately NOT asserted (specs reconciliation note #3 → deferred D3 to DEV3-008/DEV2-011).

### 4.4 Test-Discipline Anchors

- All DB tests: `runInRollback`, `tx` propagated to EVERY repository/Drizzle call (param positions verified per signature), entities created exclusively via `entity-setup.ts` helpers (verify helper signatures first — Rule 17), failures asserted via `expectRepoError` try/catch on TRANSLATED substrings (never raw keys), executed via `bun run test/scripts/run-test.ts <path>` — never raw `bun test`.
- If `entity-setup.ts` lacks a certified-teacher fixture helper (user + `teacher` row with `isApproved=true`), add it there — journey and logic tiers both consume it.
- Service tests use `runInRollback` through the REAL repository for integration realism; NO external adapter mocking is needed (this slice has none).
- 100% statement/branch coverage on all new service/repo code (`bun test --coverage`), including: every debit-ladder branch (trial-hit, hifz-hit, tajweed-hit, total-miss), every probe-classification branch, replay/claim branches, every boundary guard.
- Chaos tier: the six REQ-043 scenarios via `Promise.allSettled`; REQ-042 exact-refund-once; trial-first ordering (a student holding trial + paid books twice: lane sequence is trial THEN paid — REQ-072).
- GraphQL integration tier: `setupTestServerLifecycle` + `testClient`; every §3.4 cell asserted with `expectMutationError`-class helpers on `extensions.code`; SDL snapshot parity with §3.1; allowlist untouched; probe-oracle timing/shape constancy between foreign and nonexistent ids.

### 4.5 Cross-Actor Journey Design (MANDATORY — specs §2.9)

**Shared-entity state machine (the `session` row; the `students` lane pair as couriers):**

```mermaid
stateDiagram-v2
    [*] --> Scheduled: Student createSession\n(create tx: teacher lock → trial-first debit → claim → insert)
    Scheduled --> Started: Teacher startSession (guarded)
    Scheduled --> Cancelled: Student|Teacher cancelSession (guarded → same-lane refund)
    Started --> Completed: Teacher completeSession (guarded + EXISTS is_approved)
    Started --> Cancelled: Student|Teacher cancelSession (guarded → same-lane refund)
    Completed --> [*]: TERMINAL (INV-S1; dual-confirm/wallet = DEV3-012/013)
    Cancelled --> [*]: TERMINAL (INV-S2)
    note right of Completed: INV-S3 holds BY ABSENCE —\nzero wallet/transaction writes in this ticket
```

**Transition authority table:**

| Transition | Driving actor & permission | Guard predicate |
|---|---|---|
| `[*] → Scheduled` | Student (`$all{authenticated, role:[Student]}` + units + target certified) | teacher FOR UPDATE + `is_approved`; lane `> 0` per lane; claim unique |
| `Scheduled → Started` | Teacher (`role:[Teacher]` + ownership) | `id ∧ teacher_id=ctx ∧ status=scheduled` |
| `Started → Completed` | Teacher (ownership) | `id ∧ teacher_id=ctx ∧ status=started ∧ EXISTS(is_approved)` |
| `{Scheduled,Started} → Cancelled` | EITHER participant | `id ∧ (student_id=ctx ∨ teacher_id=ctx) ∧ status ∈ (scheduled,started)` |
| `Completed/Cancelled → anything` | **NO actor exists** (structural) | every predicate excludes terminal states |
| `* → Disputed` | NO surface (DEV3-022) | unreachable in this ticket |

**Side-effect matrix (per transition):**

| Transition | Rows written | Notifications (channel → recipient) | Idempotency |
|---|---|---|---|
| Create | `session` +1; `students` lane −1; claim +1 (+ sessionId backfill) | NONE (→ DEV3-010/011) | `X-Idempotency-Key` → claim row; replay → `DUPLICATE_REQUEST` + original session |
| Start | `session.status/startedAt/updatedAt` | NONE | guarded predicate (statement-level) |
| Complete | `session.status/endedAt/confirmedByTeacherAt/updatedAt` | NONE | guarded predicate |
| Cancel | `session.status/feeHeld/updatedAt` + lane +1 on `students` | NONE | guarded predicate; refund exact-once because only the winner's tx proceeds |
| All reads | none | none | n/a |

**Cross-actor visibility after each J1 step (the journey's assertion set):**

| After step | Student A | Student B | Teacher T | Applicant / other actors | Parent / Admin / Anonymous |
|---|---|---|---|---|---|
| 2 · A creates (trial debited) | own list shows `scheduled`, trial −1 | unchanged | list +1 `scheduled` | nothing | nothing |
| 2 · B creates | — | trial bound | +1 more | — | — |
| 4 · K1 replay | `DUPLICATE_REQUEST`; zero new rows; balances static | — | list count stable | — | — |
| 5 · T starts A's | `sessionById` shows `started` | — | state flipped once | — | — |
| 6 · T completes A's | sees `completed` + `confirmedByTeacherAt`; deadline UNCHANGED | — | terminal; no wallet signal anywhere | — | — |
| 7 · B cancels | — | `cancelled`, `feeHeld=false`, trial +1 exactly once | sees `cancelled` | — | — |
| 8 · T cancels completed id | row byte-identical | — | `SESSION_INVALID_TRANSITION` | — | — |
| 9 · teardown | all fixtures hard-deleted by tracked ids; second consecutive run green | — | — | — | — |

**Journey harness mapping:**

- `test/workflows/sessions/session-lifecycle.journey.test.ts` (J1: happy lifecycle + refund) and `…/session-lifecycle-denials.journey.test.ts` (J2: hostile legs — applicant target, zero-unit student, cross-participant probes, `intent=evaluation`, admin/parent denials with zero audit-row count delta).
- Written TEST-FIRST before the service surface exists. Rules honored: NO `runInRollback` (services own their transactions); committed fixtures in `beforeAll` via REAL services/`entity-setup.ts` factories; tracked-ID hard-delete in `afterAll`; honest permissions via real role fixtures (an "applicant" fixture holds ONLY an `applicants` row — INV-TV1 by construction); side effects (none external today) asserted ABSENT via row-count deltas rather than spies.
- `test/workflows/AGENTS.md` EXISTS in the tree (rules-only). The harness gaps this ticket scaffolds: `test/workflows/helpers/` — `journey-fixtures.ts` (tracked-ID registry + cleanup honoring FK order), `session-cast.ts` (student-with-trial, student-with-paid-lane, certified teacher, applicant, second student/teacher builders). Layer rule updates: append the helpers' guidance to the existing `test/workflows/AGENTS.md` — no rewrite of its rules.

---

## 5. Frontend UX & Navigation Specification

### 5.1 Routes & URLs Table

| Path | Purpose | Required Permission | Allowed Roles |
|---|---|---|---|
| `/student/sessions` | student's own session list + status | `withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/sessions" })` | Student only |
| `/teacher/sessions` | teacher's own session list + start/complete/cancel affordances | `withPageAuth({ roles: [UserRole.Teacher], redirectTo: "/teacher/sessions" })` | Teacher only (applicant renders empty list) |
| `/api/graphql` | hosts the seven operations | per §3.4 | — |

NO session-creation route ships (no directory exists yet — deferred D4 → DEV3-009); `createSession` is exercised by tests/journeys and consumed by the future directory. NO admin route (DEV3-021).

### 5.2 Sidebar & Navigation Integration

- **Group:** existing per-role dashboard nav groups (no new group).
- **The nav items ALREADY EXIST:** `frontend/views/dashboard/navItems.ts:54,61` carries per-role "Sessions" entries (`{ route: "/sessions", labelKey: "sessions", Icon: SchoolOutlined }` for both Student and Teacher; the `sessions` key already exists in `DashboardLabels`), currently resolving to the single-segment `[feature]` catch-all ComingSoon page.
- **The work is a RETARGET, not an addition:** update the existing Student entry's `route` to `/student/sessions` and the existing Teacher entry's to `/teacher/sessions` — NO new nav item, NO new label key, and the existing `SchoolOutlined` icon is KEPT.
- **Mobile navigation:** there is NO bottom-nav component / per-role slot map in this tree; mobile navigation is the temporary MUI `Drawer` (`frontend/views/dashboard/DashboardLayout.tsx:44-59`) driven by the same nav items — it inherits the retarget with no change of its own.

### 5.3 Per-Audience Rendering

| Audience | `/student/sessions` | `/teacher/sessions` |
|---|---|---|
| Student | Full list; per-row status chip + cancel affordance on scheduled/started rows | SSR redirect → role dashboard (`roleDashboardPath(ctx.role)`) |
| Certified teacher | redirect → role dashboard (`roleDashboardPath(ctx.role)`) | Full list; Start on `scheduled`, Complete on `started`, Cancel on `scheduled`/`started` |
| Teacher applicant | redirect → role dashboard (`roleDashboardPath(ctx.role)`) | Page renders with the localized EMPTY state (no sessions can exist for him) — never an error |
| Parent / Supervisor / Admin | redirect → role dashboard (`roleDashboardPath(ctx.role)`) | redirect → role dashboard (`roleDashboardPath(ctx.role)`) |
| Anonymous | redirect → `/login?redirect=…` | redirect → `/login?redirect=…` |

### 5.4 Apollo GraphQL Documents & UI Components

**Documents — `frontend/graphql/sharedDocuments/scheduling/session.documents.ts` (NEW).** The `scheduling/` sub-directory does NOT exist today (`frontend/graphql/sharedDocuments/` hosts only `auth/`, `teachers/`, `documents.contract.test.ts`, and `index.ts`; no `class-session.documents.ts` exists anywhere). This ticket therefore CREATES the full chain: the new `scheduling/` directory + its `index.ts` barrel + the new `session.documents.ts` file + `export * from "./scheduling";` added to the top-level `frontend/graphql/sharedDocuments/index.ts` barrel.

| Document const | Operation |
|---|---|
| `sessionByIdQueryDocument` | `query SessionById($id: ID!)` — `TypedDocumentNode<SessionByIdQuery, SessionByIdQueryVariables>` |
| `myStudentSessionsQueryDocument` | `query MyStudentSessions($filter, $page, $pageSize)` |
| `myTeacherSessionsQueryDocument` | `query MyTeacherSessions($filter, $page, $pageSize)` |
| `createSessionMutationDocument` | `mutation CreateSession($input: CreateSessionInput!)` |
| `startSessionMutationDocument` | `mutation StartSession($id: ID!)` |
| `completeSessionMutationDocument` | `mutation CompleteSession($id: ID!)` |
| `cancelSessionMutationDocument` | `mutation CancelSession($id: ID!, $reason: String)` |

Rules: `gql` + `TypedDocumentNode` from `@apollo/client` (never `/core`); codegen types from `@/frontend/graphql/generated/gql/graphql` ONLY (no inline literals, no mapping layers, no indexed-access workarounds — extracted names like `MyStudentSessionsQuery_myStudentSessions_items` are used directly); `id` in EVERY `Session` selection; hooks from `@apollo/client/react`; `useQuery` stateful ONLY (NO `useLazyQuery`); mutations consume returned `Session!` payloads for Apollo cache normalization (no refetch storms).

**Component tree:**

```
app/(dashboard)/student/sessions/page.tsx              (Server Component)
  → withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/sessions" })
  → getTranslations(locale) → shell labels as props
  → <StudentSessionsContainer />                       (client)
      useAppTranslation(Sessions)                    (handle const; property access)
      useQuery(myStudentSessionsQueryDocument, { variables })
      ├─ SessionStatusFilterChips (status filter incl. "all")
      ├─ SessionList / SessionRow (status chip, intent, fee string +
      │    currency label, deadline via locale date formatter)
      ├─ CancelSessionConfirmDialog (optional reason field ≤500 chars,
      │    helper text, aria-invalid; submit disabled while pending)
      └─ states: skeleton / empty / inline errors / success snackbars

app/(dashboard)/teacher/sessions/page.tsx              (Server Component, same pattern)
  → <TeacherSessionsContainer />                       (client)
      + row-level Start / Complete / Cancel actions (disabled while their
        mutation is in flight), same filter/list skeleton; deny surfaces use
        PermissionDeniedFallback — never bare null.
```

- **State management:** NO new Zustand store; NO `persist` anywhere; filter/pagination state is local React state; server truth lives in Apollo cache; after any transition mutation, the returned `Session!` payload normalizes by `id` (list items converge WITHOUT refetch).
- **Idempotency at the UI seam (forward note):** when the DEV3-009 directory UI lands, it MUST generate and persist a UUIDv4 per booking ATTEMPT and reuse it across retries; THIS ticket's only client-side uses are the tests/journeys, which pass fresh keys per logical operation.
- **MUI v9 / React 19 discipline (REQ-063/065):** ALL styling inside `sx` (zero direct style props on Typography/Box/Stack/Grid); colors ONLY `theme.palette.*` via theme-callback (`sx={(theme) => …}`); status chips map `SessionStatus` members to theme tokens via a `Record<string, …>` lookup (never enum-comparison branching — `no-unsafe-enum-comparison`); icons `*Outlined` only; forms submit via `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>` (never `FormEvent`); error TextFields carry `aria-invalid={!!error}`; errors branch on `extensions.code` ONLY via `mapGraphQLErrorByCode`/`RetryableNotice`/field-projection seams — masked `INTERNAL_SERVER_ERROR` renders generic copy + `requestId` correlation guidance; `DUPLICATE_REQUEST` renders the success-equivalent `duplicateBookingInfo` notice.
- **Logging:** frontend failures go through `@/frontend/lib/logger` — never `console.*`.

### 5.5 Visual Design & Responsive Specifications

**Breakpoints:**

- **Desktop (1440px):** list as a table-like grid (status chip · intent · fee · deadline · created · actions); filters inline above; actions inline-end.
- **Tablet (768px):** created/deadline columns collapse into a per-row detail expansion; action column becomes an overflow menu (`MoreVertOutlined`).
- **Mobile (375px):** stacked session cards (status chip header, intent + deadline body, full-width action buttons ≥44px touch targets); filters collapse behind a `FilterListOutlined` toggle.

**Multi-Language & RTL:**

- Full bidirectional mirroring via logical properties ONLY (`marginInlineStart/End`, `text-align: start`); action placement mirrors; Arabic labels come from the SAME keys (`Translations` compile-parity gate); Arabic line-height tokens honored on dense rows; dates rendered via the existing locale-aware date formatter; fee renders as the verbatim decimal string + localized currency label — never reformatted numerically.

**Visual State Matrix:**

| State | Rendering |
|---|---|
| Loading | skeleton rows matching final geometry; filters visible but disabled |
| Empty (no sessions) | localized empty-state (icon + title + body); NO action row |
| Empty (filtered) | localized "no sessions for this filter" state + clear-filter affordance |
| `FORBIDDEN` (defense-in-depth slip) | `PermissionDeniedFallback` (`LockOutlined` + `role="alert"`) — never bare `null` |
| `SESSION_NOT_FOUND` (stale row action) | localized snackbar + row removed via cache update |
| `SESSION_INVALID_TRANSITION` | localized inline alert on the row/dialog; list converges to truth from cache |
| `INSUFFICIENT_BALANCE` | localized blocking alert (used by the future booking dialog; rendered in tests) |
| `TEACHER_NOT_CERTIFIED` / `TEACHER_NOT_FOUND` | localized alert (future booking dialog surface) |
| `DUPLICATE_REQUEST` | info-severity success-equivalent notice (`duplicateBookingInfo`) — NOT an alarm |
| Cancel confirm | translated dialog; reason field validated ≤500 with `aria-invalid`; submit disabled in flight |
| Refund visible effect | status chip flips to cancelled; a localized `holdReleasedNotice` snackbar surfaces |
| Masked `INTERNAL_SERVER_ERROR` | generic localized toast + requestId correlation guidance |

**Agent-Browser Verification Protocol:**

1. Anonymous `GET /student/sessions` and `/teacher/sessions` → redirect to `/login?redirect=…` (screenshots 375/768/1440 × en/ar).
2. Login as parent fixture → both routes redirect to the parent's role dashboard via `roleDashboardPath(ctx.role)` (bare `/dashboard` is never the target; no render flash).
3. Login as student fixture → `/student/sessions` renders empty state (en + ar screenshots); RTL mirroring verified.
4. Fixture-driven populated state (productive fixture via GraphQL/journey harness or the seeded demo student with sessions when available): list renders rows with correct translated chips; cancel action opens the confirm dialog; confirm transitions the chip to cancelled with the release notice (functional + screenshots both locales).
5. Login as certified teacher fixture → `/teacher/sessions` renders; Start → chip flips started; Complete (with a same-row disabled-while-pending check) → completed; terminal rows show NO actions.
6. Login as applicant fixture (teacher role, applicants row only) → `/teacher/sessions` renders the localized EMPTY state — never an error surface.
7. All assertions translation-driven: component/journey tests load translations synchronously via `getTranslations(locale)` (`shared/locale/server.ts`) warmed through `test/ui/components/translation-preload.ts` — the `readTranslation` module / `translation-cache-store` explicitly does NOT exist on this branch; zero hardcoded strings; DOM-first verification, screenshots sequential (never batch-loaded).

---

## 6. Security, Authorization & Tenancy Mitigations

### 6.1 BOLA / IDOR

- Actor identity derives EXCLUSIVELY from `ctx.user.id` (DEV2-001 verified context). `createSession` accepts NO student identity input; `studentId` is server-bound (`ctx.user.id` ≡ `students.id` shared PK). Mutation targets (`id`) and reads (`id`) authorize against the ROW's `student_id`/`teacher_id` — never against caller-supplied identity fields (none exist).
- Sessions are SENSITIVE (D9): existence reveals a private student↔teacher pairing, so foreign/nonexistent/never-existed are observationally identical — `null` on `sessionById`, `SESSION_NOT_FOUND` on mutations; response shapes are constant across those branches (REQ-030/033, pinned by REQ-074's pairing assertions).
- The teacher TARGET (`teacherId`) is a legitimate client choice (the future directory publishes teacher ids) — its denial vocabulary deliberately distinguishes `TEACHER_NOT_FOUND` from `TEACHER_NOT_CERTIFIED` ONLY for the booking caller (REQ-033's documented ruling: teacher existence becomes public knowledge with the DEV3-009 directory, so this is not an oracle; the canonical doc records the warning so the pattern is never extended to genuinely private targets).
- An applicant's user id can NEVER be a session target: no `teacher` row exists for him (INV-TV1), so `lockForCertificationCheck` returns null → `TEACHER_NOT_FOUND`. The certification boundary (role ≠ certification) is structurally preserved — nothing in this ticket can mint a `teacher` row.
- Tenancy: single-tenant platform; every cross-row predicate carries its participant/ownership predicate in SQL.

### 6.2 BOPLA (Mass Assignment)

- Create input is the closed `{ teacherId, intent }` shape; transitions take `{ id }` (cancel adds bounded `reason`); filters take `{ status?, page?, pageSize? }`. Server-controlled fields (`id`, `status`, `sessionType`, `fee`, `feeHeld`, deadlines, timestamps, `heldBalanceLane`, `confirmedBy*`, `studentId`) are structurally unreachable — SDL input types omit them and the service builds all writes field-by-field.
- Service→repository mapping is explicit property-by-property; a grep-level static assertion proves ZERO `{ ...input }` spreads in every new file (REQ-031). Transport-tampered extra fields are ignored by construction (typed inputs) AND by explicit mapping.
- Intent is pinned to `{Hifz, Tajweed}` both by the SDL enum input surface (the `SessionIntent` member exists in the enum but the SERVICE re-validates membership because SDL enums cannot express the student-only subset — `intent=evaluation` dies pre-DB with `invalidSessionIntent`, REQ-054).

### 6.3 BFLA (Function-Level)

- Exact scopes per §3.2/D8: `$all{authenticated, role:[…]}` on the role-gated five; `{authenticated:true}` + participant predicate on the two shared ones. Anonymous → 401 semantics; wrong role → 403 semantics — evaluated BEFORE any resolver body runs (fail-closed per `docs/auth/jwt-authentication-service.md`).
- NO admin/supervisor bypass: admins get `FORBIDDEN`/`SESSION_NOT_FOUND` identically to other non-participants (the future admin governance surface is DEV3-021's, with its own authScopes — recorded in the canonical doc so nobody "helpfully" widens the participant predicate).
- The public-operations allowlist is byte-unchanged; the gateway's 1:1 allowlist-coverage gate remains green.
- Governed callers (deleted/blocked/actively-suspended) are denied at LOGIN and SSR (DEV2-001/002 fail-closed posture in `backend/services/auth/auth.service.ts` / `frontend/lib/auth/server-auth.ts`) — `createGraphQLContext` (`backend/graphql/gqlContextFactory.ts:187-211`) sets `ctx.user`/`ctx.role` with NO isDeleted/isBlocked/suspended check, so a governed caller with a still-valid token passes the `authenticated` scope. **Ruling (2026-08-30, orchestrator): REQ-023's service-layer governance re-check SHALL is HONORED with a bounded scope** — `SessionLifecycleService` re-checks the ACTING user's governance status (deleted/blocked/suspended per REQ-023's own wording) on `createSession` (student), `startSession` (teacher) and `completeSession` (teacher) only; governed → `FORBIDDEN` — as defense-in-depth behind the login/SSR boundary, never a claim that the context boundary itself enforces it. **`cancelSession` is EXPLICITLY EXEMPT** — a governed student may still cancel in-flight sessions (preserving REQ-023's internal no-punishment clause / cancel-must-still-work tension note). Governance flips mid-lifecycle never rewrite history (INV-U5): in-flight sessions remain cancellable by the participant later via the restored/new context; balances survive suspension untouched.
- NO wallet/transaction/report/notification/audit write surfaces exist anywhere in the diff — BFLA-by-absence, grep-proven (REQ-018/019).

### 6.4 SQL Injection / LIKE Sanitization

- Every query is parameterized Drizzle (equality / `IN` over guarded enum and integer values only); the ONLY dynamic predicate is the optional `status` filter passing through the `SessionStatus` enum guard first and binding as a parameter.
- NO LIKE/ILIKE surface exists anywhere in this ticket → LIKE-pattern escaping is NOT APPLICABLE here; NOTE that `escapeLikeWildcards` is doc-only prose today — no such helper exists in code — so it is marked as a TO-BE-CREATED shared utility for any future LIKE-bearing surface (recorded so security waves don't flag either absence as a gap).
- NO `sql` template in this slice may contain inline `--` comments (parameter-binding rule).
- All id channels pass the positive-safe-integer guard pre-DB — no `as number` narrowing anywhere (oxlint `no-unsafe-type-assertion` compliant by design).
- Idempotency keys are opaque bounded strings (≤128) bound as parameters into the claim insert; never logged.

### 6.5 Error Disclosure Confidentiality

- Localized messages carry generic state copy only — never the other participant's identity, lane balances, governance flags, or internal SQL/constraint text (REQ-035/033). The probe-classification vocabulary leaks exactly one deliberate distinction (`TEACHER_NOT_FOUND` vs `TEACHER_NOT_CERTIFIED`, booking path only — documented in D9/§6.1).
- Unexpected failures mask at the DEV3-002 boundary to `INTERNAL_SERVER_ERROR` with `requestId` correlation; full fidelity is server-side via `logger.error` with redacted context.
- Logging discipline (REQ-036): expected rejections → `logger.logDomainError` `{ code, entity: "session", entityId? }`; NO `console.*` anywhere in the diff (static scan); log context never includes titles, payloads, keys, other party's data.

### 6.6 Abuse & Rate Posture

- Inherits the platform's existing fail-open global limiter posture unchanged (no new public surface; REQ-035). Booking-specific abuse is structurally bounded: each session costs one held allowance unit; spam exhausts itself (eligibility gate); idempotent replay is free of charge. The forward note (real per-student booking rate limits → DEV2-002/Quota stream) is recorded in the ledger-facing canonical doc, not as a blocking item.
- Pagination is hard-capped (`pageSize ∈ 1..50`) so list reads are bounded; no recursion or depth hazard exists in the flat `Session`/`SessionPage` shapes (REQ-069-style depth review: trivially shallow).

### 6.7 Verification Anchors (tie-ins consumed by `tasks.md`)

- **Schema discipline:** `git diff backend/db/schema/** backend/db/migration/**` contains EXACTLY the two REQ-013 artifacts; `bun run db push` is the only schema action; no custom SQL; CHECK constraints untouched.
- **Codegen discipline:** `bun run generate:gqlSchema && bun codegen` diff contains ONLY this ticket's additions, committed in the same change set; static assertions: `id` present on `Session`; zero `session`-CUD surface beyond the seven operations; allowlist byte-unchanged; zero `await import(` in resolver trees (gate A1); zero literal-array enum registrations (gate A2).
- **Quality gates:** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 per created/modified file; final `bun tsgo`/`biome:check`/lint delta = 0 vs the REQ-001 baseline.
- **Test tiers:** shared-constant/enum guard suites (100% branch: casing, wildcard, unicode/RTL, symbol/object-hostile fuzz per the ApplicantStatus-tier precedent) → service/repo suites (`runInRollback`, via `bun run test/scripts/run-test.ts`) covering the REQ-072 full legality matrix + REQ-073 escrow/idempotency proofs → chaos suite (REQ-042/043 `Promise.allSettled` scenarios) → GraphQL integration matrix (REQ-074, `setupTestServerLifecycle` + `testClient`, `extensions.code` per §3.4 cell, oracle shape-constancy pairings) → component suites (REQ-075: Happy DOM + `translation-preload.ts` warm-up + synchronous `getTranslations(locale)` assertions + `TestWrapper locale`, both locales) → journey suites `test/workflows/sessions/*` (REQ-077, REQ-J1..J6, two consecutive green runs).
- **Coverage:** 100% statement/branch on all new service/repository/helper code (`bun test --coverage` evidence in outcomes, REQ-070).
- **Knowledge propagation outputs:** canonical `docs/sessions/session-lifecycle.md` (Why → state machine + guarded-transition pattern → four-phase creation invariant → hold-as-debit ruling + B.4 reconciliation → trial-first ladder + same-lane refund → idempotency claim design → oracle ruling contrast-with-plans + anti-copy-paste warning → `is_online` deferral note → consumer guidance table for DEV3-005/006/011/012/013/021 + DEV2-016); decisions addendum in `docs/specs/open-decisions-and-gaps.md` (hold-as-debit + same-lane refund ruling; interim constant fees → plan-linked pricing forward contract to DEV3-013; `is_online` assertion deferral with owners DEV3-008/DEV2-011; `session_request_idempotency` table + 24h sweeper deferral; sessions-are-sensitive oracle ruling); NO renumbering in `docs/specs/state-machine-invariants.md` (cross-reference line at most); rule-only one-liners in `backend/services/AGENTS.md` (SessionLifecycleService + hold-ordering + zero-notification rule), `backend/db/repo/AGENTS.md` (guarded transitions + provenance column + `FOR UPDATE` certification lock note), `backend/graphql/AGENTS.md` (participant-scoped ops + `$all` reuse pattern), root `AGENTS.md` Important References (REQ-080..082); task 0.1 SHALL pre-seed the deferred ledger (`deferred-items.md`) with items D1–D5: D1 (the `SessionLifecycleService`/`SessionRepository` naming decision staying clear of the future contract-implied `SessionService` — codework resolved INSIDE this ticket), D2 (dual-confirm flips `fee_held=false` + wallet credit → DEV3-012/013), D3 (`is_online` availability + directory wiring → DEV3-008/DEV2-011), D4 (booking UI → DEV3-009), D5 (INV-S6/S7/S8 + `disputed` → DEV3-005/DEV2-013/DEV3-022); the ledger closes with `grep -c "❌\|⚠️"` = 0 EXCEPT these pre-seeded items — each owner-referenced and non-blocking per the ledger template (REQ-083).

---

**Traceability note for consumers (binding):** DEV3-005 SHALL extend (never duplicate) these guarded transition primitives when enforcing INV-S6/S7/S8; DEV3-011 SHALL wire notifications at the documented seams without adding write surfaces here; DEV3-012/013 SHALL consume `fee_held` + `held_balance_lane` EXACTLY as defined (dual-confirm flips `fee_held=false` and credits the wallet; the timeout sweeper reuses THIS ticket's same-lane refund primitive); DEV3-021 SHALL ship the admin surface under its own scopes honoring the REQ-030 sensitivity ruling; DEV2-016 SHALL treat `confirmedByTeacherAt`/`status` as the rating-eligibility substrate. Each SHALL cite this plan's REQ ranges in its own traceability matrix; Phase-1.5 `@plan-review` gates enforce citation.

> Ruling (2026-08-30, orchestrator, 2.8 implementation): the idempotency replay path THROWS `ConflictError("DUPLICATE_REQUEST", …)` and never returns the pre-existing session row from the service. The success-equivalent experience is the CLIENT-side mapping of the 409 (REQ-065 `duplicateSuccessEquivalent` info notice). Throwing guarantees the replayed attempt's own partial writes (its debit-ladder step) roll back with the transaction — zero new rows, zero second allowance unit (REQ-073). The journey expectation (replay → `DUPLICATE_REQUEST`; zero new rows) and REQ-064's error-matrix cell both assert the surfaced 409.
