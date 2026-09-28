# Round R8 — Independent Review Outcome (API CONTRACT & CONSUMER SAFETY focus)

**Scope:** `git diff 94160b9..HEAD` (46 files; backend cooldown state-machine cluster + SDL/codegen + i18n + tests).
**Reviewer:** independent iteration subagent R8 — no knowledge of prior review rounds; judgment formed from the code alone.
**Constraints honored:** no `bun quality-gate` / `bun oxlint` / `bun lint:type-aware` / `bun biome:check` (4GB sandbox); verification substituted per the allowed set (below). Working tree left byte-clean (verified with `git status` after all runs; the `bun run codegen` re-run produced a byte-identical artifact).

## Verdict

**R8: 0 findings** (0 fixed / 0 remaining)

---

## Special focus — API contract & consumer safety (point-by-point)

**(a) Mutation return type `ApplicantProfile!` vs a dedicated payload type — CONSISTENT.**
Surveyed the live SDL (`frontend/graphql/generated/schema.graphql`): sibling single-entity admin writes return the canonical entity detail directly — `adminSetUserSuspended/Blocked/Deleted`, `adminCreateUser`, `adminUpdateUser`, `adminCertifyTeacherColdStart` → `AdminUserDetail!`; the session quartet → `Session!`; `submitRubricEvaluation` → `RubricEvaluation!`. Dedicated payload/result types are reserved for multi-entity or creation flows (`AdminOnboardStudentResult!`, `PurchaseSubscriptionPayload!`, `ChangeSubscriptionPlanPayload!`). A one-entity update returning the refreshed canonical read shape matches the dominant convention; `ApplicantProfile!` is the correct sibling-shape choice.

**(b) Arg names/typage — CONSISTENT.**
`applicantId: Int!` + `additionalDays: Int!`. The admin-users trio uses bare `id: Int!`, but domain-qualified ids are the established precedent for cross-domain targets (`adminCertifyTeacherColdStart(userId: Int!)`, `adminStopBroadcast(broadcastId: Int!)`) — `applicantId` follows that and is pinned by the specs' SDL contract (REQ-007.1). The resolver guard `requirePositiveIntId(args.applicantId, "applicantId")` mirrors the sibling `requirePositiveIntId(args.id, "id")` discipline byte-for-byte. Wire test pins both arg types as `Int!` and the full SDL signature string.

**(c) Nullability semantics — SOUND, can never return null.**
`ApplicantProfile!` is non-null and the service guarantees it: the missing-row arm throws localized `APPLICANT_NOT_FOUND` (never null), and the post-write profile re-read has a fail-closed arm that converts an impossible miss into a throw + rollback rather than widening the contract to null. The one-null-answer contract stays where it belongs — the nullable `myApplicantProfile` QUERY (`ApplicantProfile`), pinned separately in the wire suite. A concurrent row deletion between the guarded UPDATE and the re-read rolls back the extension and surfaces an error, never a null.

**(d) Enum exposure path — COMPLETE on every surface typed `ApplicantProfile`.**
`ApplicantProfilePothosObject` is the single canonical object (grep: exactly 3 usage sites) — `myApplicantProfile` query, `AdminUserDetail.applicant` slot (admin/user detail), and the mutation return — so `cooldownState: ApplicantCooldownState!` rides all of them with zero duplication. The directory listing (`AdminApplicantItem`) intentionally stays raw-instant-only (`cooldownUntil`); consistent, because that surface never exposed the derived booleans (`cooldownActive`/`canPurchaseVerification`) either. Wire member names `None | Active | Expired` (TS member names, the `ApplicantStatus` precedent) are pinned in `enum.pothos.ts` docs, `schema-surface.test.ts`, the wire suite's `enumValueNamesOf` pin, and a `printSchema` literal pin.

**(e) Deprecation/compat — SAFE.**
The field is additive; GraphQL sends only what a document selects, so every existing client query (including the shared `myApplicantProfileQueryDocument`'s 7-field selection and `AdminUserDetailFieldsFragment`) is unaffected — `frontend/graphql/test/teachers/applicant-profile.test.ts` uses `objectContaining` and stays green without edits. `bun run codegen` re-run against the new schema produced a **byte-identical** `frontend/graphql/generated/gql/graphql.ts` (zero drift — the checked-in artifact is current; the next ticket's typed-document-node consumption path is live and self-consistent, and codegen's native-enum path is proven by the `ApplicantStatus` precedent at `graphql.ts:163`). The frozen-SDL suites (`schema-surface`, `sdl-static-assertions`) were re-anchored with explicit documented rationale (53-op baseline reconciliation), not silent baseline flips. One behavior change on an existing consumer: `buildApplicantSnapshot` no longer hardcodes `cooldownActive: false`, so the admin user-detail page now shows a real cooldown date where it always showed "—" — a correction delivered by the shared derivation; the consuming component (`TeacherApplicationPanels.tsx:91`) already branches on the boolean, so no consumer breaks.

---

## Per-perspective evidence

### 1. review-types
- `bun tsgo` → **0 errors**.
- `ApplicantCooldownState` is a real TS enum in `backend/enum/teachers/` (members `none|active|expired`, docblocked strict-`>` boundary) + fail-closed `isApplicantCooldownState` guard over a pre-allocated `ReadonlySet` — mirrors `applicant-status.enum.ts` discipline; barrel export added; NOT a pgEnum, NOT a string-literal union (D5/D1 respected).
- `applicant.types.ts`: `import type` for both enums (type-only positions; Biome `useImportType` discipline documented); `ApplicantProfileReturnType` extended additively with `readonly cooldownState` appended last (field order preserved); new `ApplicantCooldownExtensionAudit` is a fully `readonly` contract (field NAME + ISO instants + day count).
- Value imports at runtime positions: service (`deriveCooldownState` returns/compares members), mappers (`ApplicantCooldownState.Active`), schema-surface test.
- Enum guard suite 22/22 (member admission, case/whitespace/unicode/fuzz/coercion/prototype fail-closed).

### 2. review-backend
- Repo `extendCooldownOnce`: ONE guarded UPDATE — `status IN (Pending, InEvaluation, Failed)` folded into WHERE as enum-member bound values; writes ONLY `cooldownUntil` + `updatedAt` (`sql\`now()\``); `RETURNING *`; `tx` required (no standalone branch); parameterized, no prepared statements. Two-source-split grep proof: **zero** `suspended` matches inside the new diff hunks (the only repo `suspended` hits are pre-existing lines outside the diff).
- Service `extendApplicantCooldown`: strict BFLA actor gate FIRST (`assertActiveActorAdmin` — the strict governance variant, zero writes/audits on denial), then integer bounds [1,3650] BEFORE any further DB contact (test-locked with absent-id probes: bounds code wins over existence), then guard read → terminal-certified deny → base `max(stored, now)` (+ EPOCH_PAST sentinel for null) → guarded write with typed `APPLICANT_ALREADY_CERTIFIED` collapse on zero-row miss → exactly ONE in-tx `AuditActionType.Adjust`/`"applicant"` audit row (metadata-only details, shared commit/rollback fate) → fail-closed post-write re-read → post-commit domain event. `outerTx` is the final positional parameter through `withTransaction` (savepoint vs top-level semantics).
- Captured-now discipline holds (one instant per derivation; `cooldownState` rides the same captured `now` as `cooldownActive`); the pre-existing `cooldownActive` expression was left untouched per the plan's additive-only rule.
- Admin snapshot mapper now derives all three observables from the ONE shared boundary (`deriveCooldownState` export; boolean read OFF the state) — fixes the pre-existing `cooldownActive: false` hardcode; D7 ledger row documents the mapper-test-home deferral.
- Concurrency matches plan §6 accepted semantics: extend-vs-extend last-write-wins (D4, incl. the audit `from` = guard-read-snapshot nuance); extend-vs-repurchase worst case = pre-extension baseline; extend-vs-status-transition resolved atomically by the WHERE predicate; no FOR UPDATE (plan §6 "NONE").
- Tests: repo 17/17, service 57/57 (incl. bounds bisection against absent ids, concurrent finalize/certify arms, ghost-actor BFLA probe, forced guarded-write miss, actor attribution, two-source-split direct read-back).

### 3. review-frontend (generated-SDL integrity + contract focus)
- `frontend/graphql/generated/schema.graphql`: exactly the three sanctioned additions (`enum ApplicantCooldownState {Active Expired None}` sorted; `cooldownState: ApplicantCooldownState!` on `ApplicantProfile`; `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!`) — no manual-edit smell, regenerated commit `d8487d2`.
- Codegen artifact integrity: re-ran `bun run codegen` → `frontend/graphql/generated/gql/graphql.ts` byte-identical (`git diff` empty) — the frozen typed-document-node layer is current; no stale-artifact risk for the next ticket.
- Frozen-SDL suites green: `schema-surface.test.ts` 93/93 (mutation-set pin, 18-admin contiguous-slice pin, enum-set pin, whole-schema delta), `sdl-static-assertions.test.ts` 57/57 (53-op baseline, admin band, exact signatures).
- Frontend compat: shared documents unchanged and valid; `documents.contract.test.ts` unaffected; audit-trail vocabulary (`applicant` entityType label) wired + tested (8/8) in both locales; adminUsers parity 67/67, errors parity 50/50.
- Consumption path for the NEXT ticket: the surface is complete and self-consistent — args naming, `Int!` typage, non-null return, and enum wire names are all pinned by tests; a frontend document adding `cooldownState` will codegen to `ApplicantCooldownState { None = 'None', Active = 'Active', Expired = 'Expired' }` exactly as the wire serializes it (wire test asserts `"Active"` over HTTP).

### 4. pentester
- BFLA: pre-resolver `authScopes: {$all: {authenticated, role:[Admin]}}` (inlined literal, census-scannable; anonymous→401 / teacher→403 wire-locked with the generic forbidden copy and byte-identical applicant row) PLUS the service-tier strict active-admin gate before any write or audit; denials mint zero audit rows (test-locked).
- BOLA / actor smuggling: no caller-supplied actor surface — smuggled `actorId` root arg dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver with zero side effects; audit `actorId` only from `ctx.user.id` (service signature enforces; attribution test-locked against applicant/other-admin ids).
- Input abuse: `additionalDays` integer-strict [1,3650]; 0 / 3651 / −5 / 2.5 all rejected before DB contact; extension can only lengthen (`max(stored, now)` base); target status re-evaluated atomically at write time.
- Injection: bound parameters only (id, instant, enum members); no string concatenation into SQL; no prepared statements; no inline `--` in templates.
- Audit/PII: details carry field NAME + ISO instants + day count only; `varchar(2000)` defensive truncation downstream; in-transaction atomicity (rollback wipes the row — chaos-probed).
- Two-source split: zero `users.suspended*` contact in the new code (grep proof + tier-4 direct read-back tests + journey step-2 lock).
- Hygiene: zero `console.*` in the diff (the sole "console." match is a test asserting its absence in source); zero plan-artifact refs (`REQ-n`, `tasks.md`, `outcome/`) in added lines; zero TODO/FIXME markers.

---

## Checks executed (all green)

| Check | Result |
|---|---|
| `bun tsgo` | 0 errors |
| `sub-loop <file> --lifecycle duplicates` — all 27 changed code files | exit 0 ×27 |
| `run-test.ts backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | 22 pass / 0 fail |
| `run-test.ts backend/db/test/repo/teachers/applicant.repository.test.ts` | 17 pass / 0 fail |
| `run-test.ts backend/services/teachers/applicant-lifecycle.service.test.ts` | 57 pass / 0 fail |
| `run-test.ts backend/graphql/test/schema-surface.test.ts` | 93 pass / 0 fail |
| `run-test.ts backend/graphql/test/sdl-static-assertions.test.ts` | 57 pass / 0 fail |
| `run-test.ts backend/graphql/test/admin-applicant-cooldown.wire.test.ts` (real server boot) | 12 pass / 0 fail |
| `run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | 12 pass / 0 fail (all 12 REQ-011 steps) |
| `run-test.ts test/workflows/admin/audit-completeness.journey.test.ts` | 19 pass / 0 fail |
| `run-test.ts backend/services/admin/user-management.service.test.ts` | 61 pass / 0 fail |
| `run-test.ts frontend/views/admin/audit/audit-trail-filters.entityType.test.ts` | 8 pass / 0 fail |
| `run-test.ts shared/locale/errors-namespace.parity.test.ts` | 50 pass / 0 fail |
| `run-test.ts shared/locale/adminUsers-namespace.parity.test.ts` | 67 pass / 0 fail |
| `bun run codegen` (artifact freshness) | byte-identical output, zero drift |
| Two-source-split grep over new diff hunks | zero matches |
| Plan-artifact-ref / console.* grep over added lines | zero matches |
| Working tree after review | clean (no modifications by R8) |

## Observations (non-findings, for the record)

1. `tasks.md` Phase 6 Task 10 (knowledge doc `docs/teachers/applicant-cooldown.md` + close-out) is still unchecked — plan bookkeeping for the docs phase, not a code defect; every code task (0–9) is complete.
2. Extend-vs-extend last-write-wins (stale-base read can, in a narrow READ-COMMITTED interleaving, overwrite a concurrent longer extension) is explicitly plan-accepted — plan §6 race table + ledger D4 (which also documents the audit `from` = guard-read-snapshot nuance). The implementation matches the accepted design; a `FOR UPDATE` variant is the ledgered future hardening.
3. The shared frontend document `myApplicantProfileQueryDocument` still selects the 7-field shape; adding `cooldownState` to it is the child ticket's consumption work per the plan (this ticket ships zero frontend feature code). The GraphQL surface it will consume is complete, typed, and wire-verified.

## Verdict

**R8: 0 findings** — no code changes made; all four perspectives (types / backend / frontend-contract / pentester) pass with the evidence above; the API surface (`adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!): ApplicantProfile!` + `ApplicantProfile.cooldownState: ApplicantCooldownState!` with wire names `None | Active | Expired`) is contract-consistent with sibling admin mutations and safe for every existing and next-ticket consumer.
