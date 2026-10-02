# Teacher Applicant Cooldown — Canonical Reference

**Domain:** Teachers / Teacher-applicant cooldown state machine
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md`
**Sibling docs:** `docs/teachers/applicant-lifecycle.md` (the lifecycle state machine and the cooldown read semantics), `docs/teachers/evaluation-rubric-scoring.md` (the failure write path), `docs/teachers/verification-plan-purchase.md` (the gate the cooldown arms)
**Status:** Implemented and verified

This document is the canonical reference for the cooldown state machine: the timed re-purchase lock stamped on a failed evaluation, the derived `cooldownState` read-model, the admin cooldown-extension primitive, and the architectural boundary that keeps cooldown machinery and account governance in two disjoint sources. All layers (repository, service, GraphQL, locale, tests) MUST conform to the contracts described here. Code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Overview

When a teacher applicant's evaluation cycle fails, the platform stamps a **cooldown** — a future instant on the applicant row after which re-application becomes possible again. The cooldown is a *timed re-purchase lock*: it blocks exactly one thing, the purchase of a new verification plan (`purchaseVerificationPlan`), and gates nothing else.

Durations are a **write-time concern of the failure writer**. The rubric-scoring finalization path — `finalizeRubricFail` (`backend/services/teachers/evaluation-rubric.helpers.ts`) → `ApplicantRepository.transitionToFailed` (`backend/db/repo/teachers/applicant.repository.ts`) — derives the window from the cycle's primary failure area:

| Primary failure area | Cooldown stamped |
|---|---|
| `tajweed` | `now + 30 days` |
| `hifz` | `now + 90 days` |

The 30-day (Tajweed) and 90-day (Hifz) windows are **minimums** (INV-TV4); an admin may extend them via the extension primitive documented in §5. The re-purchase reader (`assertCanPurchaseVerification`) is deliberately **duration-agnostic**: whatever instant the writer stored is honored verbatim (see `docs/teachers/applicant-lifecycle.md` §2.4).

**What cooldown does NOT block.** A cooldown-active applicant can still log in, keep sessions, and — once the failed-applicant → student conversion exists (§8) — subscribe to plans and attend sessions as a student. The re-purchase gate gates ONLY the verification-plan purchase; it never touches `purchaseSubscription`, session creation, or any session-class governance check. This is the observable consequence of the two-source split (§3) and is a permanent obligation of every cooldown write path.

---

## 2. Cooldown source of truth

The cooldown lives in exactly one column: `applicants.cooldown_until` (nullable timestamptz). Every cooldown decision — purchase gating, profile shaping, admin extension — reads that column and nothing else:

```text
cooldownActive  ⇔  cooldown_until IS NOT NULL  AND  cooldown_until > now()
```

The comparison is **strict `>`** against ONE captured `now` per invocation: a cooldown that expires exactly at the captured instant has already expired and no longer gates. Captured-now discipline (the wall clock is read once, every comparison is pure compute against that single instant) is what keeps the derived fields in §4 mutually consistent.

The lifecycle of the stored instant:

| Transition | Trigger | Write owner |
|---|---|---|
| `(in_evaluation, none)` → `(failed, active)` | System — FAIL verdict finalization (Tajweed/Hifz window) | The rubric-scoring flow (`finalizeRubricFail` → `transitionToFailed`), consumed zero-delta |
| `(failed, active)` → `(failed, active)`, instant lengthened | Admin — `adminExtendApplicantCooldown` | The extension primitive (§5) |
| `(failed, active)` → `(failed, expired)` | Time — `now` passes `cooldown_until` | None (pure time; nothing is written) |
| `(failed, expired)` → `(in_evaluation, none)` | Applicant — `purchaseVerificationPlan` succeeds | The purchase flow (`recordReapplication` + guarded `transitionToInEvaluation`); the gate reads §2's strict-`>` predicate |
| `(failed, *)` → `(passed, none)` | System — re-evaluation PASS | The certification write (`finalizeOnCertification` clears `cooldown_until → NULL` — the cooldown is terminal-on-pass) |
| `(passed, none)` + admin extend | Admin — extension attempt | REJECTED — certification is terminal (§5) |

There is no "clearing" writer besides certification. If a future admin surface ever needs to end a cooldown early, it must null the column (never leave a stale instant) — the read side is a pure instant comparison with no reactivation normalization.

---

## 3. The two-source split — cooldown vs account governance

Two disjoint concerns, two disjoint sources, two disjoint owners (`docs/teachers/applicant-lifecycle.md` §2.3 is the binding reconciliation):

| Concern | Authoritative source | Owner |
|---|---|---|
| Re-purchase gating (verification plan) | `applicants.cooldown_until` | The cooldown writers (failure stamp, admin extension); the lifecycle guard only READS it |
| Login / session-class gating | `users.suspended` (+ `suspended_at`, `suspended_period_days`) | The account-governance domain (`adminSetUserSuspended` / `setSuspendedAxis`) |

**Cooldown machinery MUST NEVER write `users.suspended*`** — not on the failure stamp, not on the admin extension, not on any future clearing path. The failure finalization writes ONLY `applicants.status` + `applicants.cooldown_until`; the extension writes ONLY `applicants.cooldown_until` (+ `updated_at`). The `users` table is not imported into the cooldown service or the applicant repository's cooldown methods — the absence is grep-verifiable and comment-documented in the module headers.

The invariant this preserves: an applicant in cooldown is NOT a suspended user. The session-class gate (`assertActorGovernanceClean`, `backend/services/classes/session-lifecycle.governance.ts`) re-checks the `users` governance family and is independent of the cooldown; the sole writer of the `users` governance triple remains admin governance.

**Test locks that enforce the split:**

- Repository suite static pins: the extension method's slice writes cooldown + `updated_at` only, with zero `users`/`suspended` vocabulary (runtime lock plus source pins in `backend/db/test/repo/teachers/applicant.repository.test.ts`).
- Service suite: after an extension, the `users` row is read via a direct test query (never through the service) and asserted `suspended === false`, `suspendedAt === null`, `suspendedPeriodDays === null` (`backend/services/teachers/applicant-lifecycle.service.test.ts`).
- Wire suite: the same governance-triple oracle asserted over the real GraphQL execution (`backend/graphql/test/admin-applicant-cooldown.wire.test.ts`).
- Journey: the cross-actor journey re-asserts the untouched triple after BOTH the failure stamp and the admin extension (`test/workflows/teachers/cooldown-state-machine.test.ts`).
- Review gate: a diff-scoped grep (`rg "suspended"` over the added lines of the service + repository) must return zero matches outside the service's pre-existing documented-absence docblock. A comment mentioning `users.suspended` is not a write; new code must add no further mention.

---

## 4. The derived `cooldownState` read-model

`cooldownState` is an **explicit enumeration of the cooldown's temporal position**, shipped so consumers can render "you may re-apply" from one observable instead of inferring it from `cooldownActive=false && cooldownUntil !== null`:

```text
None    ⇔  cooldown_until IS NULL
Active  ⇔  cooldown_until IS NOT NULL AND cooldown_until > now
Expired ⇔  cooldown_until IS NOT NULL AND cooldown_until <= now
```

Contract properties:

- **Derived, never stored.** `cooldownState` is pure compute from `cooldown_until` + one captured `now`. There is NO backing column and NO `pgEnum` — a stored state would be a second source of truth that could drift from `cooldown_until` (exactly the anti-pattern §3 forbids). The TS enum (`backend/enum/teachers/applicant-cooldown-state.enum.ts`, members `None = "none"`, `Active = "active"`, `Expired = "expired"`, plus the fail-closed `isApplicantCooldownState` guard) is the sole runtime authority, mirroring the `ApplicantStatus` enum discipline.
- **One boundary, one helper.** `deriveCooldownState(cooldownUntil, now)` (`backend/services/teachers/applicant-lifecycle.service.ts`) is the shared strict-`>` derivation. Both profile producers — the self profile (`getMyApplicantProfile`) and the admin applicant snapshot (`buildApplicantSnapshot`, `backend/services/admin/user-management.mappers.ts`) — derive through it, so the boolean and the enumeration can never disagree.
- **Mutual consistency.** `cooldownState === Active` ⇒ `cooldownActive === true` AND `canPurchaseVerification === false`. `Expired`/`None` ⇒ `cooldownActive === false` AND `canPurchaseVerification === true`, unless `status === passed` (certification is terminal for the purchase surface). The admin snapshot evaluates the trio at its own read instant; ordinary time-passage divergence between read surfaces is expected and correct — the boundary itself cannot drift.
- **Strict boundary everywhere.** The exact-now instant reads `Expired` (not `Active`) — the same edge the purchase guard uses, so the enumeration and the gate cannot disagree at the boundary.

---

## 5. The admin cooldown-extension primitive

`ApplicantLifecycleService.extendApplicantCooldown(applicantId, additionalDays, actorId, locale, outerTx?)` (`backend/services/teachers/applicant-lifecycle.service.ts`) is the admin primitive behind INV-TV4's "these are minimums". Semantics:

- **New expiry = `max(currentCooldownUntil, now) + additionalDays`.** The stored instant is honored verbatim while still in force; an expired or `NULL` instant collapses onto the captured `now` via the pre-epoch sentinel — extending an applicant whose cooldown has lapsed (or was never stamped) starts a fresh window from today. Because the base is `max(stored, now)`, the extension can only **lengthen** a cooldown, never shorten it.
- **Eligibility.** The guarded write folds the legal pre-states into the WHERE predicate — `status IN ('pending', 'in_evaluation', 'failed')` — so `passed` matches zero rows. The service distinguishes the two misses with a prior read: a missing row → `APPLICANT_NOT_FOUND`; a `passed` row → `APPLICANT_ALREADY_CERTIFIED` (terminal-on-pass: a certified applicant has no cooldown to extend). A certification landing between the guard read and the guarded write collapses onto the same typed certified rejection — never an illegal extension.
- **Bounds.** `additionalDays` must be an integer in `[1, 3650]` — the platform-wide account-governance window convention — validated before any database contact. Violations reject with the localized `APPLICANT_COOLDOWN_EXTENSION_INVALID` (copy pinned placeholder-free in en/ar: "Cooldown extension days must be between 1 and 3650.").
- **Actor attribution.** `actorId` is the verified caller identity handed over by the admin resolver (`ctx.user.id` — the session user id, never a client-supplied field). There is no `actorId` argument on the wire; a smuggled one dies as `GRAPHQL_VALIDATION_FAILED` before the resolver runs.
- **Defense in depth.** Authorization layers in order: the Pothos `authScopes` admin conjunction (401/403 mapping) → `requireAdminUser(ctx)` → the service's strict active-admin actor assertion (`assertActiveActorAdmin` — anonymous, missing, non-admin, or governed actors are denied with zero writes and zero audit rows) → bounds validation → transaction.
- **Atomicity.** Guard read → guarded write → exactly ONE audit row → post-write profile re-read all share ONE transaction (the optional `outerTx` final parameter is the composition seam for caller-owned flows); a rollback anywhere commits nothing. The resolver performs no try/catch — domain errors propagate uncaught to the masking boundary.

```ts
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical shape lives in
// backend/services/teachers/applicant-lifecycle.service.ts
const now = new Date();
const base = row.cooldownUntil ?? EPOCH_PAST;                       // pre-epoch sentinel
const newExpiry = new Date(Math.max(base.getTime(), now.getTime()) + additionalDays * MS_PER_DAY);
const updated = await ApplicantRepository.extendCooldownOnce(applicantId, newExpiry, tx);
if (!updated) denyAlreadyCertified(...);                            // concurrent certification
await AuditService.createAuditLog(composeCooldownExtensionAudit(...), tx);
```

**Concurrent-admin semantics (accepted design).** Two concurrent extensions each compute from their own read; the write is last-write-wins on the computed value — monotonic by construction (every candidate value extends past the then-current expiry or `now`), so the cooldown never shortens. Both attempts remain audit-observable (one `Adjust` row each). A stricter serialized ordering is deliberately not part of the current design — see §7 for the hardening path.

---

## 6. GraphQL surface

The surface is code-first Pothos; the committed SDL (`frontend/graphql/generated/schema.graphql`) is generated, never hand-edited.

| Element | Contract |
|---|---|
| `enum ApplicantCooldownState` | Wire names follow the TS member names — `None \| Active \| Expired` (the `ApplicantStatus` precedent; the generator prints members sorted). Registered once in `backend/graphql/pothos/shared/enum.pothos.ts` by passing the enum OBJECT (never a string-literal union, never a pgEnum). |
| `ApplicantProfile.cooldownState` | Non-nullable `ApplicantCooldownState!` — passthrough resolve of the derived value (`backend/graphql/pothos/teachers/applicant.pothos.ts`). The profile's other cooldown observables (`cooldownUntil: DateTime`, `cooldownActive`, `canPurchaseVerification`) are unchanged and consistent per §4. |
| `adminExtendApplicantCooldown` | `adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!): ApplicantProfile!` (`backend/graphql/mutation/admin/admin-governance.mutation.ts`). Admin-scoped via the inlined `$all { authenticated, role: [UserRole.Admin] }` conjunction; the `applicantId` arg passes `requirePositiveIntId` before the service. Returns the post-extension profile. The admin user-detail page composes this primitive through the shared `AdminExtendApplicantCooldown` document (`frontend/graphql/sharedDocuments/admin/admin-users.documents.ts`): the `CooldownExtensionSection` affordance mirrors the 1–3650 bounds client-side, the returned `ApplicantProfile` merges into the same `ApplicantProfile:<id>` cache entry the detail query reads (id-first fragment), and the extension lands in the audit trail as an `Adjust` row on the applicant entity. |

**Error codes** (all ride `errors[].extensions.code`; machine code ↔ translation key are bijective through the compile-time `errors` namespace):

| Code | Rejection | Producer |
|---|---|---|
| `APPLICANT_COOLDOWN_ACTIVE` | Purchase denied while the cooldown is in force (HTTP 422 family) | `assertCanPurchaseVerification` — the strict-`>` read; copy carries the formatted expiry in a single `{cooldownUntil}` slot expanded server-side |
| `APPLICANT_ALREADY_CERTIFIED` | Extension (or purchase) attempted on a `passed` applicant | Both certified arms of the extension and the purchase guard's terminal arm |
| `APPLICANT_COOLDOWN_EXTENSION_INVALID` | `additionalDays` not an integer in `[1, 3650]` | The extension's bounds validation (i18n leaf `applicantCooldownExtensionInvalid`) |
| `APPLICANT_NOT_FOUND` | Applicant row does not exist | `NotFoundError("APPLICANT", …)` entity-name form |

---

## 7. Operational notes

- **Audit-trail fidelity nuance.** Each audit row's `from` is the guard-READ snapshot, not the true pre-write instant: under concurrent extensions, an interim write may land between the read and the write. Both attempts stay audit-observable with their own from/to instants, and the never-shortens property holds against the original base — treat `from` as "what the acting admin saw", not as a serialized before-image.
- **Audit contract.** Exactly one `audit_logs` row per committed extension, written in the same transaction: `actionType = AuditActionType.Adjust`, `entityType = "applicant"`, `entityId` = the applicant's user id, `actorId` = the session-sourced admin id, and `details` = field NAMES + instants only — `{"field":"cooldown_until","from":"<iso or null>","to":"<iso>","additionalDays":N}` (typed by `ApplicantCooldownExtensionAudit`; no contact PII, credentials, or tokens; defensively truncated by the audit writer). `audit_logs.entity_type_entity_id_idx` returns the applicant's full extension history in `created_at ASC` order.
- **Concurrency hardening path.** The current design's concurrency mechanism is the guarded WHERE-predicate (the lifecycle pre-state IS the predicate — the `transitionToFailed` discipline); there are no row locks. If a serialized extension ordering is ever required, the sanctioned shape is a purpose-built `ApplicantRepository.findByIdForUpdate` (`SELECT … FOR UPDATE` on the applicant row) consumed by the extension transaction — a separate hardening ticket, not an in-place change to the guarded write.
- **Surface-freeze suites re-anchor with the surface.** The generated-SDL freeze pins (`backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/sdl-static-assertions.test.ts`) fail on any schema drift by design; any future surface growth (field, arg, enum member) must re-anchor them as a documented one-time reconciliation, never a silent baseline flip. The schema/artifacts are regenerated with `bun run generate:gqlSchema` + `bun codegen`.
- **Writes take no prepared statements.** The cooldown writes are one-shot guarded UPDATEs with bound parameters (`eq`/`inArray` values; enum members, never concatenated strings) — the repo's prepared-statement discipline is read-path-only (`docs/drizzle/prepared-statements.md`).

---

## 8. Downstream consumers (child tickets)

Two sibling tickets compose on top of this primitive (`docs/planning/TICKETS.md:872-912` and `docs/planning/TICKETS.md:916-958`, both Blocked By the cooldown ticket):

- **Failed Applicant → Student Record Conversion** (shipped): creates the `students` row (zeroed balances + `handshake_code`) so the failed applicant can subscribe/attend during cooldown — atomically INSIDE the rubric fail finalization's transaction, as part of the verdict itself (the failure write's own lifecycle contact stays the guarded `transitionToFailed`; the conversion seam it invokes adds the role-child row + `teacher`→`student` flip on the same `tx` — contract: `docs/teachers/applicant-student-conversion.md`). What it inherited from here: the guarantee that cooldown gates ONLY the verification re-purchase (§1), the two-source split (the conversion must not touch `users.suspended*` either), and the terminal-on-pass co-existence rule (the `students` record survives certification; `finalizeOnCertification` clears the cooldown, not the student).
- **Admin Override of Evaluation Results** (certify / reject / grant-re-evaluation). Composes the extension primitive rather than inventing a second cooldown writer: grant-re-evaluation ends a cooldown by clearing the column through the certification-shaped nulling path, reject re-stamps a window from the same `max(stored, now) + days` semantics, and the certify path rides the terminal guard (a certified applicant rejects further extension with `APPLICANT_ALREADY_CERTIFIED`). The admin-scope + `AuditActionType.Adjust` + same-transaction-audit contract here is the composition-ready pattern for the override surface's audit vocabulary.

Any new writer that must change `applicants.cooldown_until` MUST go through this primitive's discipline — guarded pre-state predicate, lengthen-only math, same-transaction audit, zero `users` contact — and should re-evaluate the stored-enum question only if it bypasses the column (it must not).

---

## 9. Where it lives

| File | Purpose |
|---|---|
| `backend/enum/teachers/applicant-cooldown-state.enum.ts` | The `ApplicantCooldownState` TS enum (`None`/`Active`/`Expired`) + fail-closed guard — the sole runtime authority for the read-model vocabulary |
| `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | Four-tier guard suite (member admission, fail-closed rejection, cross-vocabulary rejection) |
| `backend/types/teachers/applicant.types.ts` | `cooldownState` on the closed `ApplicantProfileReturnType` shape + the `ApplicantCooldownExtensionAudit` details contract |
| `backend/db/repo/teachers/applicant.repository.ts` | `extendCooldownOnce` (guarded single-statement extension UPDATE); sibling lifecycle writes `transitionToFailed`/`finalizeOnCertification` live here |
| `backend/services/teachers/applicant-lifecycle.service.ts` | `deriveCooldownState` (the shared strict-`>` boundary), `extendApplicantCooldown` (the admin primitive), `assertCanPurchaseVerification` (the re-purchase read) |
| `backend/services/admin/user-management.mappers.ts` | `buildApplicantSnapshot` — the admin applicant snapshot derives its cooldown trio through the shared helper |
| `backend/graphql/pothos/shared/enum.pothos.ts` | `ApplicantCooldownStatePothosEnum` registration (enum-object form) |
| `backend/graphql/pothos/teachers/applicant.pothos.ts` | The `cooldownState: ApplicantCooldownState!` field on `ApplicantProfile` |
| `backend/graphql/mutation/admin/admin-governance.mutation.ts` | The `adminExtendApplicantCooldown` mutation field (admin scope, ID guard, session-sourced actor) |
| `shared/locale/types/errors/labels.ts`, `shared/locale/{en,ar}/errors/index.ts` | The `applicantCooldownExtensionInvalid` leaf (bounds copy) alongside the sibling `applicant*` denial leaves |
| `backend/db/test/repo/teachers/applicant.repository.test.ts` | Repo behavioral matrix (eligibility, terminal-on-pass, verbatim-instant oracle, governance-flags lock) + static source pins |
| `backend/services/teachers/applicant-lifecycle.service.test.ts` | Derivation arms, captured-now boundary, bounds matrix, race composition, two-source-split oracle |
| `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | Wire matrix (401/403/200, SDL pins, audit-row oracle, smuggling probe, governance triple) |
| `backend/graphql/test/schema-surface.test.ts` | Freeze pins on the enum/field/mutation surface |
| `test/workflows/teachers/cooldown-state-machine.test.ts` | The 12-step cross-actor journey (fail stamp → extension → expiry → re-purchase → both failure-area arcs) |

---

## 10. References

- Lifecycle read semantics & the binding two-source-split reconciliation: `docs/teachers/applicant-lifecycle.md` (§2.1–§2.4, §7.3)
- The failure write path (duration derivation, guarded finalize): `docs/teachers/evaluation-rubric-scoring.md`
- The gated purchase flow: `docs/teachers/verification-plan-purchase.md`
- Error contract: `docs/graphql/domain-error-extensions-code.md`
- Tickets: `docs/planning/TICKETS.md:818-868` (cooldown state machine), `:872-912` (student conversion), `:916-958` (admin override)
- Test locks: the file map in §9
