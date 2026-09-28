# Task 6 Outcome — GraphQL `ApplicantCooldownState` enum + `cooldownState` field + `adminExtendApplicantCooldown` mutation

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-007, REQ-008, REQ-011) · **Design:** `plan.md` §4.1–§4.4 · **Task def:** `tasks.md` Phase 3
> **Scope guard:** Task 6 touched ONLY the three production GraphQL files, the new wire-test file, and the plan's own tracking files (`tasks.md` checkboxes, this outcome). The mutation barrel chain already imported the mutation file — zero barrel edits. No `git commit` (orchestrator-owned). `generate:gqlSchema` / `bun codegen` NOT run (Task 7 owns them).

---

## 1. READ THIS FIRST — journey flip lands at 11/12; one journey-authored guard conflicts with the shipped DateTime transport representation

`bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` went **7 pass / 5 fail → 11 pass / 1 fail** with ZERO journey-file edits. All five previously-RED steps turned green (5-partial: the mutation executed, the DB row moved, the audit row landed — the step's later assertions are reachable only past its payload guard; 6, 9, 10, 11 fully green). The one remaining failure is **step 5**, and it is **NOT fixable within Task 6's authorized delta** — it is a plan-internal contract conflict between the journey's payload guard and the schema's shipped, documented DateTime runtime behavior:

- Journey guard (`test/workflows/teachers/cooldown-state-machine.test.ts:645`): `typeof cooldownUntil !== "string"` → `"the mutation payload did not match the applicant profile wire shape"`.
- The `cooldownUntil` field is a **pre-existing** field of `ApplicantProfilePothosObject` (Task 6 is forbidden to touch the existing 7 fields) exposed via the `DateTime` scalar registered in `backend/graphql/pothos/shared/scalar.pothos.ts` (outside Task 6's delta).
- The repo pins `graphql-scalars@2.0.0`, whose `GraphQLDateTime.serialize` returns a **`Date` object** (verified in `node_modules/graphql-scalars/esm/scalars/iso-date/DateTime.js`: `if (value instanceof Date) { return value; }`; string/number inputs also route to `new Date(...)`). The ISO string only materializes at `JSON.stringify` on the HTTP boundary (`Date.prototype.toJSON`).
- Consequence: over the **real HTTP wire** the payload's `cooldownUntil` IS an ISO string (pinned green by the new wire test — `status: 200`, `Date.parse(payload.cooldownUntil)` exact). Under the journey's **in-process** `graphql()` execution the payload's `cooldownUntil` is a `Date` — for ANY resolver return shape: `serialize(string)` → `parseDateTime` → `Date`, so even pre-stringifying the source cannot produce an in-process string through `GraphQLDateTime`.
- The repo's own builder typing acknowledges exactly this: `backend/graphql/pothos/builder.ts:83` — `DateTime: { Input: Date; Output: Date | string }`. The journey's guard accepts only one of the two declared output shapes. No repo test has ever asserted a DateTime field as an in-process string (the parent-link suite asserts ISO strings only over HTTP — `backend/graphql/test/parent-link.wire.test.ts:389`).
- A diagnostic probe (temporary script, deleted; result archived in the worklog) executed the journey's exact document/context in-process: `id: number, status: "Failed", cooldownUntil: Date, cooldownActive: true, canPurchaseVerification: false, cooldownState: "Active"` — every field correct except the transport representation of `cooldownUntil`.

**Sanctioned reconciliation options for the orchestrator (any one flips step 5; journey file untouched by this task):**
1. **Swap the scalar registration** in `backend/graphql/pothos/shared/scalar.pothos.ts` from `DateTimeResolver` to `DateTimeISOResolver` (`GraphQLDateTimeISO` serializes to an ISO string in-process AND over HTTP — HTTP wire byte-identical, in-process becomes a string). Fixes EVERY DateTime field repo-wide and matches the scalar's documented intent ("Serializes `Date` to an ISO-8601 UTC string").
2. Relax the journey guard at `:645` to accept the builder's declared `Date | string` output (e.g. `typeof cooldownUntil !== "string" && !(cooldownUntil instanceof Date)`, with `Date.parse` already handling both).
3. Defer to the Task 7 / post-implementation review wave with this evidence.

Task 6's own gates (6.QL/6.TE/6.SEC/6.SR/6.IV) are all green and the checkboxes are flipped; this blocker is reported, not silently dropped.

## 2. Files created / modified

| File | Change |
|---|---|
| `backend/graphql/pothos/shared/enum.pothos.ts` | EXTEND — value import of `ApplicantCooldownState` (canonical TS enum from `backend/enum/teachers/`, alphabetical slot before `ApplicantStatus`); `ApplicantCooldownStatePothosEnum` registered ONCE with the enum-OBJECT form (`gqlSchemaBuilder.enumType(ApplicantCooldownState, { name: "ApplicantCooldownState" })`) directly mirroring the `ApplicantStatusPothosEnum` registration shape (JSDoc + two-line call); the registry docblock's "Registered enums" list gains the name. Wire names follow the TS member keys (`None`/`Active`/`Expired`) — the `ApplicantStatus` precedent. NO pgEnum (D1). |
| `backend/graphql/pothos/teachers/applicant.pothos.ts` | EXTEND — `ApplicantCooldownStatePothosEnum` import added to the existing shared/enum.pothos import; the `ApplicantProfilePothosObject` gains ONE additive field `cooldownState: t.field({ type: ApplicantCooldownStatePothosEnum, resolve: parent => parent.cooldownState })` appended after `canPurchaseVerification`; the existing 7 fields untouched; module docblock updated (closed 7-field → 8-field shape + the new mapping bullet). |
| `backend/graphql/mutation/admin/admin-governance.mutation.ts` | APPEND — `adminExtendApplicantCooldown` mutationField per plan §4.4, mirroring the `adminSetUserSuspended` side-effect shape: `type: ApplicantProfilePothosObject`, args `applicantId: t.arg({ type: "Int", required: true })` + `additionalDays: t.arg({ type: "Int", required: true })`, `authScopes: adminOnlyAuthScopes` (the shared `$all` prelude), resolve → `const user = await requireAdminUser(ctx)` → `ApplicantLifecycleService.extendApplicantCooldown(args.applicantId, args.additionalDays, user.id, ctx.locale)`. `actorId` from the narrowed session user ONLY (no `args.actorId` exists to smuggle — pinned by the wire smuggling probe). NO try/catch (domain errors propagate uncaught). Imports: `adminOnlyAuthScopes`/`requireAdminUser` join the existing `@/backend/graphql/shared` import; `ApplicantProfilePothosObject` (direct module path, mirroring `applicant.query.ts`); `ApplicantLifecycleService` via the `@/backend/services` barrel (mirroring the file's existing service import). Module docblock: title line + a contract paragraph for the new mutation (the pre-existing REQ-060/D10 docblock lines are untouched). |
| `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | CREATE — the wire/role matrix (no applicant wire-test file existed; mirrors `admin-teachers.mutation.test.ts`). 12 tests / 54 expects, all green. |

## 3. Wire-test inventory (`backend/graphql/test/admin-applicant-cooldown.wire.test.ts`)

- **SDL contract pins** (no server, no DB): return type `ApplicantProfile!` with exactly `additionalDays`/`applicantId`, both `Int!`; printed SDL contains `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!` (printSchema renders args in sorted order); the `pothosOptions.authScopes` snapshot equals `{ $all: { authenticated: true, role: [UserRole.Admin] } }` VERBATIM; the operation is absent from `PUBLIC_OPERATIONS` (default-deny allowlist); `cooldownState` rides `ApplicantProfile` as `ApplicantCooldownState!` with member names `None`/`Active`/`Expired` (set-compared — the engine sorts values); `cooldownState` appears on the `myApplicantProfile` SDL.
- **Anonymous**: `UNAUTHORIZED` through the Apollo testClient AND over raw HTTP with `data: null` — pre-resolver.
- **Non-admin (teacher)**: `FORBIDDEN` with the generic scope copy (`tErrorsEn.forbidden`), zero audit delta, applicant row byte-identical.
- **Domain denials over the wire**: `additionalDays: 0` → `APPLICANT_COOLDOWN_EXTENSION_INVALID` with the Task-3 localized bounds copy, zero writes, zero audit rows; nonexistent applicant (beyond max id) → `APPLICANT_NOT_FOUND`, zero writes; a smuggled `actorId` root arg → `GRAPHQL_VALIDATION_FAILED` pre-resolver (there is no caller-supplied actor surface).
- **Admin happy path** (last, mutating): HTTP **200**, payload `id` = target, `status: "Failed"`, `cooldownState: "Active"`, `cooldownActive: true`, `canPurchaseVerification: false`, `cooldownUntil` = **stored base + 60 days exactly** (server-computed, never-shorten honored verbatim — the fixture stamps the base 30 days out, so the assertion is skew-free); DB oracle matches the wire instant; exactly ONE audit row (`Adjust`, `entityType: "applicant"`, `actorId` = admin, details exactly `{field, from, to, additionalDays}` — names/instants only); two-source-split observable (`users.suspended === false`, `suspendedAt === null`, `suspendedPeriodDays === null`); zero notification fan-out.
- **Fixtures/teardown**: admin + failed-applicant cast in ONE committing transaction (`createTestUser`/`createTestAdmin`/`createTestApplicant` with a stamped future `cooldownUntil`); tokens via the real `login` mutation; `afterAll` sweeps audit rows (under `withAuditDeleteTriggersSuspended`), notifications, applicants, admin, users, then `countUsersByIds === 0`.

## 4. Verification results

| Gate | Command | Result |
|---|---|---|
| 6.QL | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` ×4 (enum.pothos, applicant.pothos, admin-governance.mutation, the new wire test) | ✅ exit 0 on ALL four (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates) |
| 6.TE | `bun run test/scripts/run-test.ts backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | ✅ **12 pass / 0 fail / 54 expects** |
| Acceptance | `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | ⚠️ **11 pass / 1 fail** (was 7/5 baseline — re-verified on the stashed pre-Task-6 tree). Steps 6, 9, 10, 11 flipped green; step 5 fails ONLY on the journey's `typeof cooldownUntil !== "string"` guard vs the shipped `Date`-returning DateTime scalar in-process (§1) |
| Typecheck | `bun tsgo` | ✅ exit 0 — ZERO errors |
| Regression | `bun run test/scripts/run-test.ts backend/graphql/test/admin-governance.matrix.test.ts` | 41 pass / 7 fail — **identical on the pre-Task-6 baseline** (pre-existing sandbox failures in that suite, untouched by this delta) |
| Task-7 fallout (expected) | `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` | 84 pass / 5 fail (baseline 89/0) — exactly the Task-7-owned surface pins: enum inventory, whole-schema named-type delta, mutation inventory, admin sorted-contiguous block, committed-SDL codegen sync. Re-anchored when Task 7 regenerates + re-anchors (`7.TE`) |
| Hygiene | diff-scoped greps over all 4 files | zero `console.*`, zero `REQ-*`/task-number/`Phase \d` references, no `Translation.` enum, no two-arg `getTranslations` |

## 5. Pipeline checklist evidence

- **6.QL** ✅ — four per-file sub-loops exit 0 (§4).
- **6.TE** ✅ — wire tier: 200/403/401 matrix + SDL visibility of `cooldownState` on `myApplicantProfile`, via the repo's standard runner; the honest in-process scope matrix additionally lives in the journey (steps 9–11, now green).
- **6.SEC** ✅ — `authScopes: adminOnlyAuthScopes` (the `$all` conjunction pinned verbatim off the built schema); `requireAdminUser(ctx)` narrows before the service call; `actorId` from the session user only — proven positively (audit row attribution) AND negatively (smuggled `actorId` arg dies as `GRAPHQL_VALIDATION_FAILED`; there is no such declared arg).
- **6.SR** ✅ — the Pothos registration passes the enum OBJECT and mirrors `ApplicantStatusPothosEnum` in shape; `UserRole`/`AuditActionType`/`ApplicantStatus` are VALUE imports wherever referenced (mutation via the shared prelude, wire test directly); no `Translation.` enum; no hardcoded value arrays or string unions in any Pothos file.
- **6.IV** ✅ — rule files read before/while implementing: root `AGENTS.md`, `backend/AGENTS.md`, `backend/graphql/AGENTS.md` (CRITICAL enum rule + admin-mutation census + scope composition + masking boundary), `backend/graphql/mutation/AGENTS.md` (via the file's own docblock), `.agents/instructions/backend.instructions.md`, plus `docs/teachers/applicant-lifecycle.md` §3 (no-try/catch resolver discipline).

## 6. Comment discipline

Zero plan-artifact references in every comment/JSDoc line ADDED by this task (diff-scoped grep §4). The pre-existing `REQ-060`/`D10` docblock lines in `admin-governance.mutation.ts` predate this plan and were left byte-identical. The new code comments describe domain behavior only (registered-once enum vocabulary, derived read-model passthrough, session-sourced actor identity).

## 7. Notes for downstream tasks

- **Task 7 (SDL/codegen):** run `bun run generate:gqlSchema` + `bun codegen`, then re-anchor `backend/graphql/test/schema-surface.test.ts` — the five failing pins (§4) enumerate the exact anchors to extend: add `ApplicantCooldownState` to the enum inventory + named-type delta, `adminExtendApplicantCooldown` to the sanctioned mutation additions + the admin sorted block (`adminEx` < `adminFi`, so it lands immediately BEFORE the finance trio inside the contiguous admin block), and commit the regenerated `schema.graphql`. NOTE: the generated SDL will render the mutation args in the engine's sorted order (`additionalDays: Int!, applicantId: Int!`) — the tasks.md 7 bullet's `applicantId: Int!, additionalDays: Int!` literal should be re-anchored to the engine-sorted rendering when verifying.
- **Orchestrator (journey flip):** §1 lists the three sanctioned reconciliation options; option 1 (scalar swap to `DateTimeISOResolver`) is HTTP-wire-identical and flips step 5 with zero journey edits, but its file is outside Task 6's delta and it touches every DateTime surface repo-wide — an orchestrator-owned ruling with the review wave is the safe path.
- **Task 9 (security-probing):** the wire suite's smuggling probe (no `actorId` surface) + scope-conjunction pin + allowlist-absence pin are the BOLA/BOPLA anchors for this mutation.
- Orchestrator: no `git commit` performed; `tasks.md` Task 6 checkboxes (6. + 6.QL/6.TE/6.SEC/6.SR/6.IV) flipped.

---

## Addendum — Journey step-5 guard normalization (post-Task-6)

**Agent:** `6-fix-journey` (fix-wave subagent, journey file ONLY — zero production changes).
**Resolution:** reconciliation option 2 from §1 (relax the journey guard to the builder's declared `Date | string` output) — the shipped `DateTime` scalar is untouched.

### Normalization applied (`test/workflows/teachers/cooldown-state-machine.test.ts`)

| Site | Before | After |
|---|---|---|
| Payload guard (`readProfilePayload`, feeding step 5) | `typeof cooldownUntil !== "string"` | `(typeof cooldownUntil !== "string" && !(cooldownUntil instanceof Date))` — admits both declared output shapes (`builder.ts:83`: `Output: Date \| string`) |
| Instant conversion | `cooldownUntilMs: Date.parse(cooldownUntil)` | `cooldownUntilMs: new Date(cooldownUntil).getTime()` — one epoch-ms instant from EITHER serialization |
| Docblocks | one-liner | dual-serialization normalization documented on the helper + the `WireProfilePayload.cooldownUntilMs` field |

Grep census: the guard above is the ONLY string type-guard on `cooldownUntil`/`cooldown_until` in the journey — steps 2, 4, 6, 9, 10, 11, 12 read the instant solely from DB rows / service profiles as `Date` (`.getTime()` forms); no other site required normalization. All temporal assertion semantics are intact everywhere.

### Two latent step-5 defects exposed (post-guard assertion bodies had NEVER executed — Task 5 died on the absent mutation field, Task 6 died on this guard)

1. **Upper temporal bound anchored to the wrong base.** Authored: `Date.now() + EXTENSION_DAYS*MS_PER_DAY + CLOCK_SKEW_MS` (≈ now+60d). The correct extended instant is `stamped + 60d` ≈ **now+90d** (the tajweed base rides verbatim under never-shorten), so the bound was unsatisfiable by a correct implementation — first exercised when this fix ran the journey. Restored to `stamped.getTime() + EXTENSION_DAYS*MS_PER_DAY + CLOCK_SKEW_MS`: the window is now two-sided `[stamped+60d−skew, stamped+60d+skew]`, exactly the step comment's "lands at stamped + 60 days (≈ now + 90 days from the stamp window)", same `CLOCK_SKEW_MS` tolerance, lower bound unchanged — tightened, not weakened.
2. **Absolute inbox count.** Authored: `inboxCount(applicant)).toBe(1)` assumed the fail verdict was the applicant's only inbox row; the real pre-extension chain legitimately emits 7 (activation receipt + 5 session-completion notifications + the fail verdict — pre-existing product behavior outside this plan's delta). Normalized to the zero-delta form the comment already states ("no notification fan-out rode the admin action"): `inboxBefore` captured at step start (beside `auditCountBefore`/`publishesBefore`), asserted `toBe(inboxBefore)`.

### Final matrix

| Gate | Result |
|---|---|
| `bun run scripts/health/sub-loop.ts test/workflows/teachers/cooldown-state-machine.test.ts --lifecycle duplicates` | ✅ exit 0 (re-run after final edits) |
| `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | ✅ **12 pass / 0 fail / 264 expects** — twice consecutively (idempotent-teardown proof) |
| `bun tsgo` | ✅ exit 0 — 0 errors |
| Hygiene (diff-scoped) | zero `console.*`, zero plan-artifact/REQ/task references |

Step-by-step: 1–12 all pass; step 5 now exercises its FULL body (payload shape → extended-instant window → DB-oracle equality → ONE adjust audit row with names-only details → governance triple → inbox/publish zero-deltas). §1's blocker is closed; options 1 and 3 are moot.
