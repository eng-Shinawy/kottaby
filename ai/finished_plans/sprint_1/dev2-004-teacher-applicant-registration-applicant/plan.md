# Technical Architecture & Implementation Design: DEV2-004 — Teacher Applicant Registration & Applicants Table

> **Plan of record:** `ai/plans/dev2-004-teacher-applicant-registration/`
> **Specs:** `specs.md` REQ-001..REQ-083
> **Canonical refs:** `docs/auth/user-registration.md`, `docs/auth/jwt-authentication-service.md`, `docs/graphql/domain-error-extensions-code.md`, `docs/drizzle/prepared-statements.md`, `docs/specs/open-decisions-and-gaps.md` (B.6/B.7/A.7/C.2), `docs/specs/state-machine-invariants.md` (INV-TV1..TV7), `docs/workflows/01-teacher-verification-workflow.md`

---

## 1. System Overview & Architecture Diagram

### 1.1 Scope Statement

DEV2-004 is a **mostly-verification + small-additive ticket**. The applicant write path (registration → `applicants` row) already exists from DEV1-002 and is structurally correct. The net-new work is:

1. **Canonical vocabulary:** `ApplicantStatus` TS enum over the existing `varchar(50)` column (NO `pgEnum`, NO schema change).
2. **Lifecycle substrate:** `ApplicantLifecycleService` (cooldown guard + attempt-counter contract + profile shaping) and one new repo method (`recordVerificationAttempt`).
3. **Read surface:** no-argument `myApplicantProfile` GraphQL query gated to `role: [UserRole.Teacher]` plus an applicant status card on the teacher-applicant dashboard.
4. **Permanent test locks** for the registration contract (zero `teacher` rows, exact applicant defaults, full rollback).

New write paths are intentionally minimal and server-internal only; DEV2-005..010 consume the contracts.

### 1.2 Data Flow — New Surfaces

```
┌── CLIENT (React 19 / Apollo 4) ──────────────────────────────────────────────┐
│ TeacherApplicantDashboard                                                    │
│   └─ <ApplicantStatusCard />                                                 │
│        useQuery(myApplicantProfileQueryDocument)   (stateful — NO lazy)      │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼  Apollo → GraphQL API
┌── POTHOES ──────────────────────────────────────────────────────────────────┐
│ query/teachers/applicant.query.ts                                            │
│   myApplicantProfile: ApplicantProfile | null                                │
│   authScopes: { role: [UserRole.Teacher] }   ← 401/403 before resolver body  │
│   NO ARGS (BOLA: identity = ctx.user.id only)                                │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼
┌── SERVICE ──────────────────────────────────────────────────────────────────┐
│ ApplicantLifecycleService (backend/services/teachers/)                       │
│   getMyApplicantProfile(userId, locale)     → queries + pure compute         │
│   assertCanPurchaseVerification(userId, locale, tx?) → ValidationError|null  │
│   recordReapplication(userId, locale, tx?)  → repo.atomic increment          │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼
┌── REPOSITORY ───────────────────────────────────────────────────────────────┐
│ ApplicantRepository (backend/db/repo/teachers/)                              │
│   create(userId, tx)                                  (EXISTING — DEV1-002)  │
│   findByUserId(userId, tx?)                           (new if absent)        │
│   recordVerificationAttempt(userId, tx?)              (NEW — single UPDATE)  │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼
┌── POSTGRESQL ───────────────────────────────────────────────────────────────┐
│ applicants (DEV1-001 — UNCHANGED): id PK=FK users.id,                        │
│   verification_attempts int default 0, last_attempt_at ts,                   │
│   cooldown_until ts, status varchar(50) default 'pending'                    │
│ users (UNCHANGED): role user_role, governance fields (A.7)                   │
│ teacher (UNCHANGED): NO row for applicants (B.7)                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Verification Lane (permanent contract locks)

```
runInRollback(tx)
  ├─ registerUser(role=teacher)  (existing surface, unmodified)
  │     └─ via entity-setup createTestUser + tx
  ├─ assert: users +1, applicants +1 (shared PK), teacher +0
  ├─ assert defaults: status='pending', attempts=0, last_attempt_at=NULL, cooldown_until=NULL
  └─ forced child-insert failure → zero residual rows (rollback proof)

ApplicantLifecycleService tests (runInRollback or service-level)
  ├─ assertCanPurchaseVerification: null / future / now / past ⇒ allow/block
  ├─ missing applicant row ⇒ APPLICANT_NOT_FOUND
  └─ recordVerificationAttempt: 0→1→2 sequential; Promise.allSettled concurrent ⇒ attempts=2

GraphQL integration (setupTestServerLifecycle + testClient)
  └─ anonymous UNAUTHORIZED; student/parent/admin FORBIDDEN; applicant shape OK + id; certified ⇒ null
```

### 1.4 Key Design Decisions Table

| #  | Decision | Options Considered | Pros / Cons | Rationale (Maintainability, Scalability, Reliability) |
|----|----------|--------------------|-------------|--------------------------------------------------------|
| D1 | `ApplicantStatus` as a plain TS enum over the existing `varchar(50)` | (a) add a `pgEnum("applicant_status", …)`; (b) TS enum + guard only | (a) Pros: DB-enforced values. Cons: requires schema change + `db push` — violates REQ-045; DEV1-001 already shipped varchar contract. (b) Pros: zero schema drift; app-layer guard is the canonical gate. Cons: DB doesn't reject raw junk writes. | (b). The Drizzle schema ground truth defines status as varchar; the canonical value set is documented in this plan; all writes in-scope are server-internal through the canonical enum. REQ-012 mandates exactly this. |
| D2 | Cooldown computed purely from `applicants.cooldown_until` (never `users.suspended`) | (a) single-source from users.suspended; (b) applicants.cooldown_until only; (c) read both | (a) conflates governance gates (login/session) with re-purchase eligibility — violates A.7/INV-TV3 two-source split. (c) ambiguous rules when values disagree. (b) unambiguous, duration-agnostic (INV-TV4 handled at write time by DEV2-008). | (b). REQ-015/016 explicitly fix this separation. The guard becomes: `cooldown_until IS NOT NULL AND cooldown_until > now()`. |
| D3 | Attempt increment = single atomic `UPDATE … SET verification_attempts = verification_attempts + 1, last_attempt_at = now() … RETURNING *` | (a) SELECT then UPDATE; (b) advisory lock/multi-statement; (c) single in-place UPDATE | (a) Pros: simple reads. Cons: TOCTOU window; concurrent increments lose a write. (b) Reliable but heavier than needed; pointless on a counter row. (c) Pros: no TOCTOU, zero lost updates under concurrency; atomicity delegated to the DB. Cons: none material. | (c). REQ-014/042 mandate no read-modify-write for the counter; a single statement is the minimal correct primitive. |
| D4 | Profile query is zero-argument; identity is `ctx.user.id` | (a) accept `userId: ID` arg; (b) context-only | (a) Pros: flexible for admin consumers. Cons: massive BOLA/IDOR surface on self-service data; REQ-030 forbids. (b) Pros: structurally impossible to read someone else's applicant file; resilient to client tamper. Cons: admin lateral read needed later (DEV3-016) — that's a separate privileged operation. | (b). REQ-030. Admin/supervisor lateral reads are out-of-scope and will be their own admin-scoped resolver in a later ticket. |
| D5 | New query is nullable `myApplicantProfile: ApplicantProfile \| null` — `null` = certified teacher / no active applicant file | (a) throw `APPLICANT_NOT_FOUND` when a certified teacher calls; (b) return null | (a) mixes control flow with errors and turns a legitimate state into a client error; leaks state semantics via error channels. (b) Pros: certified state is a first-class render branch, easy UI; aligns with REQ-017 precedence. | (b). Clean preconditions for restricted consumers; the frontend treats `null` as the "certified" rendering branch. |
| D6 | ApplicantStatus Pothos registered once via enum-object form in `shared/enum.pothos.ts` | (a) `values: [...]` literal registration; (b) enum-object registration from TS enum | (a) violates the CRITICAL enum registration rule (drift risk). (b) single-source registration. | (b). Mandatory per `backend/graphql/pothos/AGENTS.md`; REQ-061 requires it. Codegen sync follows. |
| D7 | Status card is a client component on the teacher-applicant dashboard; all copy from compile-time i18n | (a) server-rendered profile into a client card with props only; (b) client fetch via Apollo | (a) Pros: fewer client hooks; Cons: needs new SSR data plumbing whose only surface is this card; wastes a Cold-Start read on the whole dashboard for one card. (b) Pros: simple, cache-normalized via Apollo `id`, fetch-on-demand. Cons: one extra round trip. | (b). The data is only needed when the applicant visits their own dashboard; an Apollo query keeps server components clean and matches the existing frontend GraphQL conventions. |
| D8 | No new admin/supervisor surfaces | — | Adding one here would multiply BFLA concerns (BOLA across tenant boundaries), belong to DEV3-016/019 surface maps, and exceed a 3-SP verify+contract ticket. | Scope integrity. The permission matrix below documents this non-existence explicitly (REQ-030/032). |

---

## 2. Data Models & Database Schema

### 2.1 Existing Schema Verification (READ-ONLY)

All required structures exist from DEV1-001. Verification targets (no edits are allowed):

| Element | Existing implementation | Verified at |
|---|---|---|
| `applicants` table | `id` shared PK → `users.id` (cascade), `verification_attempts integer default 0`, `last_attempt_at timestamp`, `cooldown_until timestamp`, `status varchar(50) default 'pending'`, timestamps | `backend/db/schema/teachers/applicants.ts` |
| `user_role` enum (contains `parent`, C.1) | `pgEnum("user_role", ["admin","teacher","student","parent"])` | `backend/db/schema/enums.ts` |
| `users` governance fields (A.7) | `is_deleted / suspended / is_blocked / *_at / suspended_period_days / last_active_at` | `backend/db/schema/users/users.ts` |
| `teacher` table | exists but never written by registration | `backend/db/schema/teachers/teacher.ts` |
| `teacher_verification` | present (INV-TV7) | `backend/db/schema/teachers/teacher-verification.ts` |

**`backend/db/schema/**` remains byte-stable for this ticket** (REQ-045) — no schema diff is permitted; the Drizzle schema in `backend/db/schema/` is the sole structural ground truth and the applicants value set is documented verbatim in this plan.

### 2.2 Canonical Enums (NEW — TypeScript only)

```
backend/enum/teachers/applicant-status.enum.ts     (NEW)
backend/enum/teachers/index.ts                     (add: export * from "./applicant-status.enum")
backend/enum/index.ts                              (already re-exports teachers — verify only)
```

Authoritative enum body:

```typescript
// backend/enum/teachers/applicant-status.enum.ts
export enum ApplicantStatus {
  Pending = "pending",
  InEvaluation = "in_evaluation",
  Failed = "failed",
  Passed = "passed",
}

export function isApplicantStatus(value: unknown): value is ApplicantStatus {
  return (
    typeof value === "string" &&
    (Object.values(ApplicantStatus) as string[]).includes(value)
  );
}
```

- Value import when used at runtime (never `import type`).
- DB-side column stays `varchar(50)`; there is **no pgEnum registration**.

### 2.3 Canonical Types (existing + new)

| File | Change | Types |
|---|---|---|
| `backend/types/teachers/applicant.types.ts` (exists) | extend | `ApplicantSelectType`, `ApplicantInsertType` (unchanged), `ApplicantProfileReturnType` (NEW) |
| `backend/types/teachers/index.ts` (exists) | no change needed | barrel unchanged (`applicant.types.ts` already exported) |

New type body (LGTM-only fields; no governance state, no secrets, no write fields):

```typescript
// backend/types/teachers/applicant.types.ts (extend)
export interface ApplicantProfileReturnType {
  readonly id: number;                                  // shared PK (= users.id)
  readonly status: ApplicantStatusMendable;             // typed from stored varchar via guard
  readonly verificationAttempts: number;
  readonly lastAttemptAt: Date | null;
  readonly cooldownUntil: Date | null;
  readonly cooldownActive: boolean;                     // computed server-side
  readonly canPurchaseVerification: boolean;            // computed server-side
}
```

Note: `ApplicantStatusMendable` is realized as the `ApplicantStatus` union at construction: the service validates the stored raw `status` with `isApplicantStatus` before returning `ApplicantProfileReturnType`, so the return type's `status` field is typed simply as `ApplicantStatus`. Unknown values fail closed (`ValidationError` — REQ-050).

### 2.4 Explicit Schema-Drift Prohibition (REQ-045)

```
git diff -- backend/db/schema/** backend/db/migration/**  ⇒ MUST BE EMPTY
```

---

## 3. API Contracts & Pothos Resolvers

### 3.1 GraphQL Schema Additions

```graphql
enum ApplicantStatus {
  PENDING
  IN_EVALUATION
  FAILED
  PASSED
}

type ApplicantProfile {
  id: ID!
  status: ApplicantStatus!
  verificationAttempts: Int!
  lastAttemptAt: DateTime
  cooldownUntil: DateTime
  cooldownActive: Boolean!
  canPurchaseVerification: Boolean!
}

extend type Query {
  myApplicantProfile: ApplicantProfile
}
```

> Note on scalar choice: `lastAttemptAt`/`cooldownUntil` surface through the project's existing DateTime scalar patterns; the Pothos side exposes them as nullable DateTime fields. The exact scalar name follows whatever DEV1-002 established for timestamp exposure on `User`/`Student`; verification at implementation time.

### 3.2 Registration Behavior (UNCHANGED — verify only)

`registerUser` (existing, DEV1-002) requires **no surface change**. Its teacher branch already creates `applicants` via the existing repo and never creates a `teacher` row. REQ-060 / REQ-010 jointly mean: no edits to `auth.mutation.ts`, `RegistrationService`, or `RegisterPublicRole`. Permanent tests (§4.4) lock this surface.

### 3.3 Pothos Implementation Contract

| Aspect | Rule |
|---|---|
| File | `backend/graphql/query/teachers/applicant.query.ts` (NEW) + domain barrel wiring |
| Object type | `backend/graphql/pothos/teachers/applicant.pothos.ts` (NEW): `gqlSchemaBuilder.objectRef<ApplicantProfileReturnType>("ApplicantProfile")` exposing every field; `id` always exposed |
| Enum registration | `backend/graphql/pothos/shared/enum.pothos.ts`: `ApplicantStatusPothosEnum = gqlSchemaBuilder.enumType(ApplicantStatus, { name: "ApplicantStatus" })` (enum-object form, CRITICAL) |
| authScopes | `{ role: [UserRole.Teacher] }` — evaluates against DEV1-002's context after DEV2-002's `role` scope; unauth → `UNAUTHORIZED`, wrong-role → `FORBIDDEN` |
| Resolver body | delegates entirely to `ApplicantLifecycleService.getMyApplicantProfile(ctx.user.id, ctx.locale)`; localized errors via `ctx.t("errors")`/`ctx.t("applicant")`; NO try/catch swallowing; plain `Error` never thrown |
| Codegen | run `bun run generate:gqlSchema && bun codegen`; commit generated artifacts in the same change set (REQ-061) |

### 3.4 Error Code Mapping (per `docs/graphql/domain-error-extensions-code.md`)

| Scenario | Code | Producer |
|---|---|---|
| anonymous caller | `UNAUTHORIZED` | Pothos `scopeAuth`/`authenticated` layer |
| authed non-teacher | `FORBIDDEN` | DEV2-002 `role` scope |
| certified teacher calls (no `applicants` row) | returns `null` (no error) | Service precedence |
| stored status is junk (corrupt row) | `VALIDATION` (custom code) | `isApplicantStatus` failure path |
| cooldown blocks re-purchase | `APPLICANT_COOLDOWN_ACTIVE` | `ApplicantLifecycleService.assertCanPurchaseVerification` (ValidationError with custom code) |
| attempt-record on missing row | `APPLICANT_NOT_FOUND` | `NotFoundError` from service layer |

### 3.5 Permission Matrix

| Caller | `registerUser` (existing) | `myApplicantProfile` (new) | Notes |
|---|---|---|---|
| Anonymous | ✅ public + rate-limit stub (unchanged) | ❌ `UNAUTHORIZED` | no new public surface |
| Student | ✅ (if registering self) | ❌ `FORBIDDEN` | no privilege surface |
| Parent | ✅ (if registering self) | ❌ `FORBIDDEN` | INV-P2 unaffected |
| Teacher applicant | ✅ registration path | ✅ own profile only | cert-flag not consumable (DEV2-011+) |
| Certified Sheikh | n/a (already registered) | ✅ → returns `null` | null = certified state, UI renders "certified" branch |
| Supervisor | n/a | ❌ `FORBIDDEN` | later lateral read is DEV3-016 scope |
| Super Admin | ✅ (only via DEV3 onboarding) | ❌ `FORBIDDEN` by scope; uses admin surfaces later | no admin read here (REQ-032) |

---

## 4. Backend Services, Repositories & Concurrency Model

### 4.1 New Service — `applicant-lifecycle.service.ts`

Location: `backend/services/teachers/applicant-lifecycle.service.ts` (domain folder matches DEV1-002/DEV1-003 teacher domains).

```typescript
// namespace pattern, runtime only — NO types here (backend/types owns them)
export namespace ApplicantLifecycleService {
  export async function getMyApplicantProfile(
    userId: number,
    locale: string
  ): Promise<ApplicantProfileReturnType | null>;

  export async function assertCanPurchaseVerification(
    userId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<void>;

  export async function recordReapplication(
    userId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<ApplicantSelectType>;
}
```

**Behavior contracts:**

- **`getMyApplicantProfile`** — 1 read of `applicants` by PK; if no row ⇒ `null` (certified / not-an-applicant answer); if row exists, validate `status` via `isApplicantStatus`; compute `cooldownActive = cooldownUntil !== null && cooldownUntil > now` and `canPurchaseVerification = !cooldownActive && status !== ApplicantStatus.Passed`. All pure compute after a single read — **no write, no lock**.
- **`assertCanPurchaseVerification`** — single read + pure compute against a captured `now`. Throws `ValidationError("APPLICANT_COOLDOWN_ACTIVE", t.<keyInterpolatingCooldownUntil>)` when active; `NotFoundError("APPLICANT", t.applicantNotFound)` when no `applicants` row; no-op otherwise. Documented (REQ-043) as advisory-at-its-isolation-level — the racing purchase write ultimately lives in DEV2-005's transactional flow.
- **`recordReapplication`** — delegates to `ApplicantRepository.recordVerificationAttempt(userId, tx)`. Zero-row return ⇒ `NotFoundError("APPLICANT", …)` + `logger.logDomainError` (REQ-052). NEVER logs full payloads; never uses `console.*`.

**Logging discipline (REQ-052):** only expected domain rejections go through `logDomainError` with context `{ code, entity: "applicants", entityId: userId }`; unexpected internals bubble upward to the GraphQL masking boundary (DEV3-002). `logger.error` stays reserved for true 5xx.

### 4.2 Repository — `backend/db/repo/teachers/applicant.repository.ts` (existing, add methods only)

Conventions per `backend/db/repo/AGENTS.md`:

| Method | Signature | Notes |
|---|---|---|
| `create` (existing) | `create(userId, tx: DBTransaction)` | verify-only; unchanged |
| `findByUserId` | `findByUserId(userId: number, tx?: DBTransaction): Promise<ApplicantSelectType \| null>` | NEW if absent. Read → `queryDb(tx)` Neon-HTTP pattern if a comparable repo method already uses that; otherwise plain parameterized query (REQ-044). |
| `recordVerificationAttempt` | `(userId: number, tx?: DBTransaction): Promise<ApplicantSelectType>` | NEW. **Single** `UPDATE applicants SET verification_attempts = verification_attempts + 1, last_attempt_at = now(), updated_at = now() WHERE id = $1 RETURNING *` via Drizzle `sql` expression. No `inArray`; no prepared statement (writes are out of prepared scope). No raw inline `--` comments inside the `sql` template (Drizzle parameter-binding gotcha). |

BOPLA: `recordVerificationAttempt` accepts zero client input — no whitelist concerns.

### 4.3 Existing DEV1-002 Surface (Verify-Only)

`RegistrationService` / `StudentRepository` / `ApplicantRepository.create` etc. are not modified unless tests prove a defect. Test helpers: verify `createTestApplicant`/registration helpers exist in `backend/db/test/entity-setup.ts`; add only if missing (Rule 17: verify signatures first).

### 4.4 Concurrency & Race Condition Assessment

This ticket's runtime writes are minimal (one atomic counter update + one pure read). The only heavy transactional concern is *guarding* the existing DEV1-002 flow behavior under stress tests, not changing it.

| Scenario | Actors | Risk | Mitigation |
|---|---|---|---|
| Concurrent registration with same email | 2 anonymous clients | duplicate account → duplicate applicant | Existing `users.email` 23505 → `ConflictError` translation (inherited, REQ-040); verified by race test via `Promise.allSettled` inside `runInRollback`. |
| Forced failure mid-registration (child insert fails after user insert) | tx internal | partial account | DEV1-002 `withTransaction(outerTx)` SAVEPOINT-aware pattern; lock tests assert zero residual `users`/`applicants` rows. |
| Two application recordings on same applicant | service concurrent invocations | lost update on `verification_attempts` | REQ-042: single in-place UPDATE with server-side `+ 1` — atomic under PG isolation; concurrency test asserts final attempts = 2 after two concurrent calls. |
| Rapid calls to `assertCanPurchaseVerification` at exact cooldown boundary | 1 caller, repetitive | flaky allow/block | Capture `now` once per call; deterministic results per request; the racing write is DEV2-005's responsibility (documented in canonical doc). |
| Certified teacher probes profile | certified sheikh client | information leak about applicant state precedence | Service returns `null` strictly after checking `applicants` row existence; does not distinguish "never an applicant" from "passed" publicly (REQ-035); role gate keeps non-teachers out wholesale. |
| Junk `status` strings committed outside app | admin scripts / future bug | UI/render inconsistency | `isApplicantStatus` guard at service boundary fails closed with `ValidationError`. |
| `db push` drift mid-ticket | dev machine | schema divergence | REQ-045: empty-schema-diff gate; no `db push` is ever run for this ticket. |

**Explicit:** no `SELECT FOR UPDATE` and no advisory locks are introduced in this ticket; every mutable-state touch above is either already DB-atomic (single UPDATE) or read-only compute. No Redis/`SET NX EX` surface is added.

### 4.5 Testing Strategy (covers REQ-070..075)

```
backend/db/test/logic/teachers/applicant-lifecycle.test.ts    (NEW — logic tests)
backend/services/teachers/applicant-lifecycle.service.test.ts (NEW — mocked adapter-free pure service)
frontend/graphql/test/teachers/applicant-profile.test.ts      (NEW — theme server lifecycle + testClient)
test/ui/components/teachers/ApplicantStatusCard.test.tsx      (component — Happy DOM + Apollo mocks + translation preload)
```

All DB tests: `runInRollback`, `tx` propagated everywhere, `entity-setup.ts` helpers only, `expectRepoError` try/catch (never `rejects.toThrow()`), assertions against translated-message substrings (never raw keys), UUID/randomized emails.

---

## 5. Frontend UX & Navigation Specification

### 5.1 Routes & URLs Table

No new routes; one new on-dashboard surface.

| Path | Purpose | Required permission | Allowed roles |
|---|---|---|---|
| `/teacher/dashboard` (existing) | Renders new `<ApplicantStatusCard />` when the caller is a teacher with an active applicants file | `authenticated` + role-gated page wrapper (existing) | teacher (applicant + certified — certified branch renders differently) |

The existing page-level guards from DEV2-001/DEV2-002 (`withPageAuth({ roles: [UserRole.Teacher] })` / layout guard) stay the **server-side boundary**; the client card is UI affordance only.

### 5.2 Sidebar & Navigation Integration

- **New sidebar items:** none.
- **Mobile bottom nav:** unchanged.
- **Card placement:** inside the existing teacher dashboard content region, above the fold for applicants; hidden entirely on certified teachers (the card swaps to a "certified" summary branch rather than disappearing causelessly).

### 5.3 Per-Audience Rendering

| Audience | What they see |
|---|---|
| Student | never reaches the surface (page is role-gated) |
| Parent | never reaches the surface |
| Teacher — Applicant (pending) | status chip "Pending Evaluation" (translated), attempts count, no cooldown block |
| Teacher — Applicant (in_evaluation) | "In Evaluation" chip, attempt count, target info (5 sessions) simplification |
| Teacher — Applicant (failed, cooldown active) | `COOLDOWN_UNTIL` rendered via ICU-formatted date; re-application CTA **disabled** with explanatory copy |
| Teacher — Applicant (failed, cooldown expired) | "Eligible to Re-apply" affordance (CTA enabled, purchases route handled later by DEV2-005) |
| Teacher — Certified Sheikh | the existing certified-teacher dashboard state; the status card shows the certified summary — never pending/evaluation copy |
| Supervisor | never reaches the surface |
| Admin | never reaches the surface (admin dashboard is separate) |

### 5.4 Apollo Document & Component Tree

- **Document:** `frontend/graphql/sharedDocuments/teachers/applicant.documents.ts` (NEW) → `myApplicantProfileQueryDocument`, typed as `TypedDocumentNode<MyApplicantProfileQuery>` (no variables), selection set includes `id`. Registered in the existing `frontend/graphql/sharedDocuments/teachers/index.ts` barrel (top-level barrel already re-exports `teachers`). Run codegen after authoring.
- **Hooks:** `useQuery` from `@apollo/client/react` only; **no `useLazyQuery`**; `useAppTranslation(Translation.<Namespace>)` with enum-property access (`t.someLabel`, never `t("someLabel")`); localized datetime formatting handled through project locale utils.

**Component tree (conceptual):**

```
app/(dashboard)/teacher/dashboard/page.tsx          (Server Component, existing guards)
  └─ <TeacherDashboardContainer />                  (existing)
        └─ <ApplicantStatusCard />                  (NEW — client component)
              ├─ useAppTranslation(Translation.Applicant or Dashboard.Teacher namespace)
              ├─ useQuery(myApplicantProfileQueryDocument)
              ├─ Skeleton (loading)
              ├─ null payload ⇒ CertifiedSummaryBranch
              ├─ cooldownActive ⇒ disabled CTA + expiry copy
              └─ else ⇒ ReapplyAffordance
```

**MUI v9 constraints:** all spacing/weight/color through `sx`, `theme.palette.*` only, `*Outlined` icons only, `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>` for any form in this area, no hardcoded colors, `<Box component="output" aria-busy>` or `component="alert"` patterns per `frontend/AGENTS.md`.

### 5.5 Visual Design & Responsive Specifications

- **Breakpoints:** Desktop (1440px) card rides the dashboard's standard card grid; Tablet (768px) grid collapses to 2 columns; Mobile (375px) single-column full-bleed card under the dashboard header. The CTA button is comfortably tappable (≥44px hit area).
- **RTL/Arabic:** full bidirectional mirroring; logical properties (`marginInlineStart/End`, `text-align: start`); Arabic copy uses taller line heights per the shared typography scale; date formatting follows the locale-aware formatter from the existing i18n surface.
- **Visual State Matrix:**

| State | Render |
|---|---|
| Loading | MUI Skeleton card (title, one badge line, one CTA placeholder) |
| Error (UNAUTHORIZED / FORBIDDEN) | Existing `PermissionDeniedFallback` pattern — never bare null on a page-level deny |
| `null` payload (certified) | Certified summary: "You are certified" + shortcut to main teaching surfaces |
| Pending | Chip + "awaiting purchase" prompt (purchase flow is DEV2-005 scope) |
| In-Evaluation | Chip + attempt counter + progress hint |
| Failed / Cooldown Active | Warning chip + expiry date + disabled re-apply CTA |
| Failed / Cooldown Expired | Success/info-style affordance with active re-apply CTA |
| Status unknown/corrupt | Inline generic error toast/alert via the DEV3-002 mapping contract — never crash |

**Agent-Browser Verification Protocol:** verification is compile + integration + component-test based (no new URLs to screenshot). Equivalents: GraphQL `testClient` matrix tests, Happy DOM card render tests across all five branches + RTL, and page-load smoke on `/teacher/dashboard` within the existing role-based E2E suite (reused, not newly authored as a dedicated E2E run).

---

## 6. Security, Authorization & Tenancy Mitigations

| Threat Class | Mitigation |
|---|---|
| **BOLA / IDOR** | `myApplicantProfile` takes **no arguments** — identity is only `ctx.user.id` (REQ-030). The surface to pass a foreign user id *does not exist*. Reads inside service/repo use the caller's own user id as PK. No cross-tenant joins introduced. |
| **BOPLA (mass assignment)** | No client input maps into any DB write in this ticket. `ApplicantProfileReturnType` is a closed `readonly` shape; the only write is the server-internal `recordVerificationAttempt` (no input shape). No `{ ...input }` spread anywhere; static review asserts zero hits in diff. |
| **BFLA (function-level authorization)** | `authScopes: { role: [UserRole.Teacher] }` gate the only new operation; non-teachers get `FORBIDDEN`. Nothing in this ticket grants certification: no mutation writes `teacher.is_approved`, `is_evaluator`, `is_online`, `subjects`, or `request_preference` (REQ-033). Admin/supervisor lateral reads do NOT exist here (zero mutation surface for privilege escalation). |
| **Error oracles / disclosure** | Rejections are canonical localized denies; errors never reveal whether some *other* user has an applicants row, nor which governance flag produced a deny for the caller's own account beyond the documented public copy (REQ-035, A.7 governance-nondisclosure from DEV1-002). |
| **SQL / LIKE injection** | No LIKE/ILIKE user-driven queries in this ticket; all writes are parameterized via Drizzle/`sql` templates with no string concatenation and no inline `--` comments. Future search surfaces that consume applicants (e.g., admin filters in DEV3-016) must use `escapeLikeWildcards` — noted for downstream. |
| **Soft-delete / governance integrity** | Read paths handle `isDeleted/isBlocked/suspended` upstream in DEV2-001/002 (fail-closed contexts); this ticket's service does not leak "governed but readable" rows. INV-U5 preserved: applicants rows survive governance actions untouched. |
| **Timing/oracle on cooldown boundary** | Cooldown evaluation is a pure read against a single captured `now`; no write-at-read pattern exists in the guard. |
| **Token / secret hygiene** | No tokens or credentials are logged; PII in `logDomainError` context is limited to codes + entity id. |

---

## Verification Anchors (used by tasks.md)

1. `bun run db` is **never** invoked for schema changes in this ticket; `git diff` on schema/migration paths is empty.
2. `bun run generate:gqlSchema && bun codegen` after all GraphQL work, artifacts committed in the same change set.
3. Per-file `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 for every created/modified file.
4. Test suites: logic tests, service tests, GraphQL integration tests (via `setupTestServerLifecycle` + `testClient`), component tests — all green (`bun run test:db`, `bun run test:services`, `bun run test:graphql`, `bun run test:ui:components` as applicable), 100% statement/branch on new logic, `bun run test/scripts/run-test.ts` used for DB-bound tests.
5. Final gates: zero new tsgo/biome/lint issues vs Phase-0 baseline; `grep -c "❌\|⚠️"` on `deferred-items.md` = 0 (forward items for DEV2-005 purchase wiring must be expressed as resolved reference entries, not open debt); canonical doc `docs/teachers/applicant-lifecycle.md` exists and is referenced from `docs/auth/user-registration.md`, `backend/services/AGENTS.md`, and the root `AGENTS.md` Important References.
