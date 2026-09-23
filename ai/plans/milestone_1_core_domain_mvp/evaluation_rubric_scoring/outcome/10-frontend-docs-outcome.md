# Task 10 Outcome — Frontend GraphQL Documents + Barrel

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Branch:** `main`

---

## Summary

Added the evaluator-facing GraphQL documents family for the rubric scoring loop — one mutation document and two query documents as `TypedDocumentNode`s typed exclusively by the codegen output, with `id` FIRST on every object selection (Apollo normalization), the `teachers` documents-barrel import row, regenerated codegen artifacts, and a pure documents-contract suite (mocked pipeline, zero server/DB/network) following the `handshake-code.documents.test.ts` / `documents.contract.test.ts` MO.

## Files Created

| File | Content |
|---|---|
| `frontend/graphql/sharedDocuments/teachers/evaluation-rubric.documents.ts` | `submitRubricEvaluationMutationDocument` (`mutation SubmitRubricEvaluation($sessionId: ID!, $input: RubricEvaluationSubmitInput!)` → exact 8-field `RubricEvaluation` receipt, `id` first), `myRubricPendingSessionsQueryDocument` (`query MyRubricPendingSessions($page: Int, $pageSize: Int)` → canonical `SessionPage` with the 8-field `Session` row selection mirroring `myEvaluationSessionsQueryDocument`, `id` first), `myRubricEvaluationQueryDocument` (`query MyRubricEvaluation($sessionId: ID!)` → same 8-field receipt, nullable root field) — all `TypedDocumentNode`-typed from `@/frontend/graphql/generated/gql/graphql`, never inline literals |
| `frontend/graphql/test/teachers/evaluation-rubric.documents.test.ts` | Documents-contract suite (14 tests / 105 expect(), pure logic tier): named operations + channel + exact variable sets (no dead variables, no literal arguments), closed selection contract with `id` FIRST asserted positionally, `notes` absent from every selection AND every printed body (BOPLA — it rides only inside the typed input variable), compile-time `TypedDocumentNode` proof by assignment, barrel ≡ deep-import identity (root + teachers barrels), comment-stripped filesystem scan pinning NO `useLazyQuery` in the whole `sharedDocuments` tree, MockLink + production `createApolloCache()` round-trips (pending pages under different variables, mutation receipt, own-submission row + legal-null arms) with ZERO cache-data-loss warnings and proof that `id`-first rows normalize into standalone `Session:`/`RubricEvaluation:` cache entries incl. a cache-hit re-read served without a link pass, and a LAST-position dev-mode canary (unpolicied-cache `SessionPage` partial-replace DOES warn → the zero assertions are non-vacuous) |

## Files Modified

| File | Change |
|---|---|
| `frontend/graphql/sharedDocuments/teachers/index.ts` | Barrel row `export * from "./evaluation-rubric.documents";` (alphabetical slot between `evaluation-booking` and `student-evaluation`) |
| `frontend/graphql/generated/gql/graphql.ts` | Regenerated via `bun codegen` — emits `SubmitRubricEvaluation(Mutation|MutationVariables)`, `MyRubricPendingSessions(Query|QueryVariables)`, `MyRubricEvaluation(Query|QueryVariables)` + extracted `_submitRubricEvaluation` / `_myRubricPendingSessions(_items)` / `_myRubricEvaluation` compact types (schema was already current from the GraphQL task; no backend change in this task) |

## Verification Evidence

- `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit **0** for: `evaluation-rubric.documents.ts`, `teachers/index.ts`, `evaluation-rubric.documents.test.ts` (after fixing 6 lint:type-aware findings in the test file: merged `graphql` duplicate imports, replaced regex comment-stripping with linear string scanning — `sonarjs/super-linear-regex`, `sonarjs/prefer-specific-assertions` × 3, `sonarjs/cognitive-complexity` via a `stripBlockComment` helper extraction)
- Generated artifact note: the sub-loop on `frontend/graphql/generated/gql/graphql.ts` reports "No files found to lint" (exit 1 = nothing checkable) — `frontend/graphql/generated` is outside the lint/duplicates scope by design (machine-owned via `bun codegen`; same posture as the prior task, which committed artifacts without per-artifact sub-loops). Artifact verification: `bun codegen` exit 0 + project `bun tsgo` 0 errors + the suite's compile-time assignments.
- `bun run test/scripts/run-test.ts frontend/graphql/test/teachers/evaluation-rubric.documents.test.ts` → **ALL TESTS PASSED — 14 tests / 105 expect() / 0 failed** (pure tier, ~0.7s; no server boot needed by the suite itself)
- `bun tsgo` → **0 errors** project-wide (baseline parity)
- `bun biome:check` → no findings for any touched file
- Infra note: one runner timeout mid-verification was a stale orphaned `next dev` on port 3066 + stale process lock from a killed run (same EADDRINUSE-family flake the GraphQL task documented); resolved via `test:kill` + port cleanup, clean re-run green twice.

## Security / Scope Review (SEC)

- Read shapes carry no `notes` field: `notes` exists ONLY in the mutation's `RubricEvaluationSubmitInput` variable — asserted on the parsed AST (deep walk) and on `loc.source.body` for all three documents.
- No applicant-foreign fields: no document carries an evaluator/evaluated/applicant identity variable (identity is server-bound via `ctx.user.id`); the only client-owned inputs are the session locator and the sealed score/notes/weakness payload. The pending page reuses the canonical PII-free `Session` selection (no `resolutionNote`/`disputeReason`/etc.).
- BOPLA: no spread of the input anywhere — documents declare the typed variable contract only.

## Single-Responsibility Review (SR)

- Documents consume codegen types only (`@/frontend/graphql/generated/gql/graphql`); no inline local result types, no mapping layers, no indexed-access workarounds (the `& { readonly __typename: … }` intersections are mock wire-payload fixtures per the `handshake-code.documents.test.ts` precedent, not type mappings).
- Import discipline: `gql`/`TypedDocumentNode` from `@apollo/client` (never `@apollo/client/core`); hooks untouched — and a regression pin now enforces NO `useLazyQuery` across the entire documents layer (comment-stripped scan).
- `SessionPage` deliberately NOT added to `apolloCache.ts` typePolicies: it is a pre-existing canonical type (already consumed by existing session documents without a policy), not a new id-less type introduced by this task — the embedded-type policy applies to NEW types. Round-trip evidence shows page writes under different variables are warning-free with the production cache.

## Surface Handed to Task 11 (UI wiring)

Exact document export names (all re-exported from `@/frontend/graphql/sharedDocuments` and `@/frontend/graphql/sharedDocuments/teachers`):

| Export | TypedDocumentNode type | Purpose |
|---|---|---|
| `submitRubricEvaluationMutationDocument` | `TypedDocumentNode<SubmitRubricEvaluationMutation, SubmitRubricEvaluationMutationVariables>` | mutation arm of `useRubricEvaluation` (`variables: { sessionId, input: { score, notes, weaknessArea } }`) |
| `myRubricPendingSessionsQueryDocument` | `TypedDocumentNode<MyRubricPendingSessionsQuery, MyRubricPendingSessionsQueryVariables>` | stateful `useQuery` pending-read arm (optional `page`/`pageSize`, service-normalized) |
| `myRubricEvaluationQueryDocument` | `TypedDocumentNode<MyRubricEvaluationQuery, MyRubricEvaluationQueryVariables>` | own-submission read (nullable — unsubmitted reads null) |

Hook seam for Task 11: `useRubricEvaluation` imports these from the barrel (`@/frontend/graphql/sharedDocuments`), typed `extensions.code` denials flow through `error-link.map.ts` (no per-document error mapping); extracted field types for dialog/UI state: `SubmitRubricEvaluationMutation_submitRubricEvaluation`, `MyRubricPendingSessionsQuery_myRubricPendingSessions_items`.

## Cross-File Dependencies

- Depends on the codegen artifacts regenerated here (`frontend/graphql/generated/gql/graphql.ts`) — any future document edit re-runs `bun codegen` (schema unchanged).
- Task 11's dialog/hook/container wiring consumes the three exports above; `teacherSessionCacheArms` extension and `RubricEvaluationDialog` stories need no further document surface.

## Deferred Items

- None new (ledger stays D1–D4; `deferred-items.md` carries 0 unresolved ❌/⚠️ markers).
