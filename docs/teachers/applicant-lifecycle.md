# Teacher Applicant Lifecycle — Canonical Reference

**Domain:** Teachers / Teacher-applicant verification lifecycle
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md`
**Status:** Implemented and verified

This document is the single canonical reference for the teacher-applicant lifecycle: the `applicants` state machine, the cooldown/attempt contracts, the `myApplicantProfile` query contract, and the consumer obligations for every downstream flow that writes a transition on top of them. All layers (repository, service, GraphQL, frontend) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Applicant State Machine

The `applicants.status` column (varchar(50), default `'pending'`) carries the lifecycle vocabulary `pending`, `in_evaluation`, `failed`, `passed` — byte-identical to the TS enum `ApplicantStatus` (`backend/enum/teachers/applicant-status.enum.ts`), which is the sole runtime vocabulary authority (no pgEnum backs the column). A stored value may only enter typed flow after passing the fail-closed guard `isApplicantStatus`.

| Transition | Trigger | Write ownership |
|---|---|---|
| *(start)* → `pending` | `registerUser(role = "teacher")` creates the `applicants` row: `status='pending'`, `verification_attempts=0`, `last_attempt_at=NULL`, `cooldown_until=NULL`, NO `teacher` row | The pre-existing registration write path (`registerUser`); verified and permanently test-locked (§5) |
| `pending → in_evaluation` | Verification plan purchase | The verification-plan purchase flow; the guard `assertCanPurchaseVerification` must be called before the purchase write (§6) |
| `in_evaluation → passed \| failed` | Aggregation of the 5 evaluation sessions | The evaluation-aggregation flow |
| `failed → in_evaluation` | Re-purchase **after the full cooldown has expired** | The purchase flow, via the guard; the guard plus the `recordReapplication` attempt increment are documented in §2 |
| `passed → teacher row exists` | The aggregation flow writes the `teacher` row | No path in the registration/guard layer documented here mints a `teacher` row |

The state vocabulary is binding on the entire verification chain: `pending`, `in_evaluation`, and `failed` are terminally readable states; `passed` implies the `teacher` row exists. The registration/guard layer itself performs **zero** status writes — the only `status: "pending"` literal in the write path is the pre-existing registration `create`.

---

## 2. Cooldown & Attempt Contracts

### 2.1 Authoritative cooldown source

The determination of whether an applicant may (re-)purchase a verification plan comes **exclusively** from `applicants.cooldown_until`. It never reads `users.suspended` or any governance field — an absence that is grep-verifiable in the shipped service.

The cooldown-active predicate:

```text
cooldownActive ⇔ cooldown_until IS NOT NULL AND cooldown_until > now()
```

The comparison is **strict `>`**: a cooldown that expires exactly NOW no longer blocks (implemented against one captured `new Date()` per invocation). An expired or `NULL` cooldown permits purchase.

### 2.2 Atomic single-statement attempt increment

`ApplicantRepository.recordVerificationAttempt(userId: number, tx?: DBTransaction)` (`backend/db/repo/teachers/applicant.repository.ts`) is ONE atomic in-place UPDATE — no SELECT-then-UPDATE read-modify-write anywhere. Zero rows matched ⇒ `null` (the service maps the miss to `APPLICANT_NOT_FOUND`).

```ts
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical shape lives in
// backend/db/repo/teachers/applicant.repository.ts (Drizzle form).
tx.update(applicants)
  .set({
    verificationAttempts: sql`${applicants.verificationAttempts} + 1`, // DB-side arithmetic
    lastAttemptAt: sql`now()`,
    updatedAt: sql`now()`,
  })
  .where(eq(applicants.id, userId)) // parameterized — the id never enters SQL text
  .returning();                     // RETURNING * audit row for log/audit use
```

Service wrapper: `ApplicantLifecycleService.recordReapplication(userId, locale, tx?)` (`backend/services/teachers/applicant-lifecycle.service.ts`) delegates to the repository method and surfaces a miss as localized `NotFoundError`. All three lifecycle service functions accept optional `tx?: DBTransaction` as their last parameter and propagate it verbatim through every repository call.

### 2.3 Two-source split — login/session gating vs re-purchase gating

| Concern | Authoritative source | Ownership | Governing principle |
|---|---|---|---|
| Login / session-class gating | `users.suspended` (+ governance family on `users`) | The session/governance domain | *"A suspended user cannot request new sessions during the suspension period."* |
| Re-purchase gating (verification plan) | `applicants.cooldown_until` | The cooldown writer sets it; the lifecycle guard documented here reads it | *"A cooldown period must fully expire before an applicant can re-purchase the verification plan."* |

The lifecycle guard **writes neither source**: the failed-evaluation writer owns the cooldown write; this document defines only the read semantics. Governance fields live on the base `users` table, and the `applicants` table is the lifecycle home — both per the recorded decisions in `docs/specs/open-decisions-and-gaps.md`.

### 2.4 Duration-agnostic guard

The guard is deliberately **duration-agnostic**: whatever instant the failure/cooldown writer wrote into `cooldown_until` is honored verbatim. The 30-day (Tajweed) / 90-day (Hifz) minimums are a **write-time concern** of that writer — the reader documented here implements no duration knowledge at all. This is the deliberate two-source-of-truth split: durations are *set* by the failure writer; the guard is a pure `cooldown_until` read. It is recorded here so the cooldown writer does not re-litigate it.

### 2.5 Failed applicant keeps student privileges

After a failed applicant is converted to a student, the `students` record **co-exists** with the `applicants` row; the applicant row is untouched by the conversion (the invariant: *"A failed applicant who is converted to a student retains student privileges — can subscribe to plans and attend sessions — during the cooldown period."*). The lifecycle reader performs no special-casing of that co-existence: `canPurchaseVerification` derives purely from `cooldownActive` and `status !== passed`.

---

## 3. Query Contract & Precedence

**Surface:** `myApplicantProfile: ApplicantProfile` (nullable) — **zero arguments**, registered in `backend/graphql/query/teachers/applicant.query.ts`. Identity is derived exclusively from the verified context (`ctx.user.id`); there is no caller-supplied lookup surface of any kind. BOLA probes that attempt to address a foreign `userId` (inline literal or variable) die as `GRAPHQL_VALIDATION_FAILED` before a resolver runs.

**Authorization:** the field's scope map is:

```ts
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical field config:
// backend/graphql/query/teachers/applicant.query.ts
authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }
```

The explicit `$all` conjunction is load-bearing (verified against the actual engine behavior of `@pothos/plugin-scope-auth`):

- `{ role: [UserRole.Teacher] }` **alone** is wrong: with `ctx.role` null (anonymous), the role scope returns `false` and `scopeAuthOptions.unauthorizedError` maps scope-return failures onto the localized `ForbiddenError` — anonymous callers would get FORBIDDEN (403) instead of UNAUTHORIZED (401).
- A plain `{ authenticated: true, role: [...] }` map is also wrong: Pothos scope-auth combines the keys of ONE scope map with **ANY** semantics by default — any authenticated caller would satisfy the first passing scope and non-teachers would be granted.
- `$all` makes the conjunction explicit: anonymous → the `authenticated` scope's thrown `UnauthorizedError` passes through the mapping verbatim → `UNAUTHORIZED` (401); authenticated non-teacher → role scope false → canonical localized `ForbiddenError` → `FORBIDDEN` (403). Both behaviors are pinned live by the integration test matrix.

**Precedence (the one null answer):** `null` = certified teacher OR never-applied — a single indistinguishable answer (the no-oracle rule: `null` is chosen over throwing `APPLICANT_NOT_FOUND` because a certified teacher calling is a legitimate state, not a client error). Governed (suspended/blocked/deleted) accounts **never reach the resolver** — the fail-closed auth/session context denies them upstream. DomainErrors thrown deeper (`APPLICANT_NOT_FOUND`, `APPLICANT_COOLDOWN_ACTIVE`, `APPLICANT_STATUS_CORRUPT`) propagate uncaught to the masking boundary — the resolver carries no try/catch by contract.

---

## 4. Advisory-Isolation Note

`assertCanPurchaseVerification` / profile shaping are a **single read followed by pure computation against one captured `now`** — no write, no lock needed. The guard is **advisory at its isolation level**: concurrent re-purchase attempts at timestamp boundaries are resolved by the purchase flow's transaction, not by this guard. The TOCTOU window between "guard allows" and "purchase write commits" is closed **only** when the purchase flow passes its own transaction's `tx` into the guard and into `recordReapplication`. The guard is advisory-at-its-isolation-level and is documented as such here.

---

## 5. Registration Write Path Is Pre-Existing

The registration → `applicants` write path **pre-exists and was never rebuilt**. Its locked behavior: `registerUser` with `role = teacher` creates EXACTLY ONE `users` row and exactly one `applicants` row sharing the user's PK, and ZERO rows in `teacher`, within one atomic transaction. The implementation MUST NOT modify the registration write path unless a defect is proven by these very tests.

The permanent lock suite lives in `backend/db/test/logic/auth/registration.service.test.ts` — the registration-contract lock describe block (4 lock cases: exactly-one proof, exact defaults signature, forced child-insert failure ⇒ zero residuals, duplicate-email race ⇒ one winner + `ConflictError(CONFLICT)` replay). Any future change to the registration write path fails CI loudly on these locks.

---

## 6. Consumer Guidance Table

| Consumer | Obligation |
|---|---|
| **Verification plan purchase flow** | Call `ApplicantLifecycleService.assertCanPurchaseVerification(userId, locale, tx)` **before** the purchase write; call `ApplicantLifecycleService.recordReapplication(userId, locale, tx)` on the successful (re-)purchase. **Both accept optional `tx` and MUST receive the purchase transaction's `tx`** — the advisory guard's TOCTOU closes only then (§4). The `pending → in_evaluation` status write belongs to this flow (§1). |
| **Evaluation sessions / aggregation** | The `in_evaluation → passed \| failed` transition writes, and the `teacher` row on `passed`, belong to these flows. The distinct-evaluators rule (5 distinct evaluators) is downstream-owned — this lifecycle layer only stabilized the `in_evaluation` vocabulary for it. |
| **Failure / cooldown writer** | Cooldown **writer** contract: sets `applicants.cooldown_until`. Durations (30d Tajweed / 90d Hifz minimums) are set at write time — the reader documented here is deliberately duration-agnostic (§2.4). Keep the strict-`>` reader honest: when a cooldown should no longer bind (pass, admin clearing), null/clear the column rather than leaving a stale instant. |
| **Failed → student conversion** | Co-existence: the `students` record co-exists with the `applicants` row; the applicants row is not disturbed (§2.5). Student privileges persist during cooldown. |
| **Admin governance / override** | The override surface reads `audit_logs` (the append-only audit trail per the recorded governance decision). No override surface exists in this lifecycle layer; the admin-override-supersedes-aggregation invariant is unaffected, and the admin-governance workflow is not modified. |
| **Direct admin onboarding** | Boundary: direct onboarding is the cold-start certification path. It does **not** route through the purchase/evaluation lifecycle; the cooldown/attempt contracts in §2 do not apply to it, and no applicant file is required by that path. Canonical reference: `docs/admin/cold-start-certification.md`. |

---

## 7. Invariant Anchoring

Bindings to `docs/specs/state-machine-invariants.md` (invariant wording quoted as it exists there), the recorded decisions in `docs/specs/open-decisions-and-gaps.md`, and `docs/workflows/01-teacher-verification-workflow.md`.

### 7.1 Per-invariant service notes

| Invariant (invariant-file wording) | How the lifecycle layer serves it |
|---|---|
| *"An applicant cannot be certified (`is_approved = true`) without either (a) completing 5 evaluation sessions with 5 distinct certified Shuyukh and passing, or (b) being directly onboarded by the Admin (cold-start)."* | "No certification shortcut" is a permanently tested, structurally-enforced property of the applicant surface. |
| *"The 5 evaluation sessions must be with 5 **distinct** certified Shuyukh."* | Not owned here (evaluation/aggregation scope); recorded as a downstream consumer obligation (§6) so the `in_evaluation` vocabulary is stable when it arrives. |
| *"A cooldown period must fully expire before an applicant can re-purchase the verification plan."* | The guard contract ships the authoritative read; all boundary cases are tested (null, future, exact-now, past) plus missing-row behavior. |
| *"Tajweed cooldown = 1 month (30 days); Hifz cooldown = 3 months (90 days). These are minimums."* | Durations are set by the failure/cooldown writer; the guard is duration-agnostic (pure `cooldown_until` read) — the deliberate split documented in §2.4. |
| *"The Admin override can supersede the automated aggregation result in any direction."* | Unaffected — no override surface exists in this layer; admin mutations belong to admin governance with `audit_logs`. |
| *"A failed applicant who is converted to a student retains student privileges during the cooldown period."* | After conversion, the `students` record co-exists with `applicants`; this layer does not disturb the applicants row (§2.5). |
| *"`teacher_verification` record stores `tajweed_level` and `hifz_level` assessments."* | Schema presence verified; untouched by this lifecycle layer. |

### 7.2 Failed-applicant-home and teacher-creation-timing decisions (quoted from `docs/specs/open-decisions-and-gaps.md`)

- **Failed Applicant — Teacher vs. Student Record** — *"Move failed applicants to a separate `applicants` table. … The `teacher` table is reserved for verified sheikhs only. When an applicant fails, their record is moved to `applicants`. If they re-apply after cooldown, a new `teacher` record is created upon passing."* The `applicants` table is THE lifecycle home; the registration contract locks that registration lands here, and the state machine defines its `status` vocabulary accordingly.
- **Teacher Record Creation Timing** — *"Create `teacher` record only after passing verification. … Before that, the user exists in the `applicants` table."* Locked by the registration behavior (zero `teacher` rows at registration, permanently tested) and by the rule that no path in this lifecycle layer mints a `teacher` row.

### 7.3 Teacher-verification workflow stage mapping

The teacher-verification workflow (`docs/workflows/01-teacher-verification-workflow.md`) owns every state transition this lifecycle conditions on. The `applicants.status` vocabulary mirrors its stages: `Registered` → registration (§5); `Pending_Evaluation` → verification purchase (§1/§6); `In_Evaluation` → evaluation sessions; `Evaluation_Complete` → `Qualified` (pass) or `Cooldown_Tajweed`/`Cooldown_Hifz` (fail); re-entry from cooldown → re-purchase (via the guard, §2). The admin-governance workflow is NOT modified.

> **Vocabulary reconciliation (binding reading):** the invariant file's §2 *Cooldown_Tajweed / Cooldown_Hifz* schema-representation column reflects the draft-docs-era model (`students.suspended = true`, `suspended_period_days = 30|90`). The decisions recorded in `docs/specs/open-decisions-and-gaps.md` moved the lifecycle home to `applicants` (`cooldown_until`). The two-source split in §2.3 of this doc is the binding reconciliation: re-purchase gating reads `applicants.cooldown_until`; login/session-class gating reads the `users` governance fields. No edit to the invariant file is required or made — this paragraph IS the addendum-free reconciliation record.

### 7.4 Change / addendum section

**No invariant gaps were discovered; no addendum to `docs/specs/state-machine-invariants.md` is required.** No edits were made to the canonical invariant file's numbering or content. Any future gap discovered by a downstream change MUST be recorded in that change's own doc change section, never by renumbering the invariant file.

---

## 8. Error Contract

All domain rejections are `DomainError` subclasses whose `extensions.code` follows `docs/graphql/domain-error-extensions-code.md` (SCREAMING_SNAKE_CASE; `NotFoundError(entity, …)` entity-name form auto-generates `${entity}_NOT_FOUND`; `ValidationError` custom-code overload for specific codes). Machine code ↔ translation key are bijective (the key is the lowercase camelCase of the code), all resolving through the compile-time `errors` namespace (ar/en parity mechanically pinned by `shared/locale/applicant-namespace.parity.test.ts`).

| `extensions.code` | Producer (path in `backend/services/teachers/applicant-lifecycle.service.ts`) | i18n key (`errorsTranslations`) | Localized copy (en / ar) | Log discipline |
|---|---|---|---|---|
| `APPLICANT_NOT_FOUND` | `NotFoundError("APPLICANT", …)` — guard missing row; reapplication miss | `applicantNotFound` | "Teacher application not found." / "لم يتم العثور على طلب التقديم كمعلم قرآن." | Logged |
| `APPLICANT_COOLDOWN_ACTIVE` | `ValidationError("APPLICANT_COOLDOWN_ACTIVE", …)` — strict-`>` cooldown check blocks | `applicantCooldownActive` | ICU `{cooldownUntil}` template; the single placeholder is expanded server-side with a deterministic UTC stamp (fixed `Intl.DateTimeFormat` options; exact `"en"` else `"ar"`) — parity suites pin EXACTLY ONE placeholder per locale | Logged |
| `APPLICANT_STATUS_CORRUPT` | `ValidationError("APPLICANT_STATUS_CORRUPT", …)` — stored varchar status fails `isApplicantStatus`; fail closed, the row is never interpreted loosely | `applicantStatusCorrupt` | "Your application status could not be read. Please contact support." / "تعذر قراءة حالة طلبك. يرجى التواصل مع فريق الدعم." | **Not logged** (profile path is silent by design) |

Logging discipline (the authoritative count): **3 `logger.logDomainError` sites / 5 enumerated rejections, 2 of which are silent by design**. The three log sites carry `{ code, entity: "applicants", entityId, locale }` — entity ids only, no PII. `getMyApplicantProfile` emits NOTHING on any path. The GraphQL-level assertion targets are exactly the three codes above.

---

## 9. References

- Requirements & invariants: `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (§2 Teacher Verification Lifecycle; §6 session-governance invariant) — **read-only for this lifecycle layer**
- Recorded decisions: `docs/specs/open-decisions-and-gaps.md`
- Workflow: `docs/workflows/01-teacher-verification-workflow.md`
- Error contract: `docs/graphql/domain-error-extensions-code.md`
- Registration canonical contract: `docs/auth/user-registration.md` (its teacher-record-timing blockquote links back here)
- Authoritative implementations: `backend/enum/teachers/applicant-status.enum.ts`, `backend/db/repo/teachers/applicant.repository.ts`, `backend/services/teachers/applicant-lifecycle.service.ts`, `backend/graphql/query/teachers/applicant.query.ts`, `backend/graphql/pothos/teachers/applicant.pothos.ts`
- Test locks: `backend/db/test/logic/auth/registration.service.test.ts` (registration contract locks), `backend/db/test/logic/teachers/applicant-lifecycle.test.ts`, `backend/services/teachers/applicant-lifecycle.service.test.ts`, `frontend/graphql/test/teachers/applicant-profile.test.ts`
