# Task 7 Outcome — GraphQL Surfaces (Pothos types + mutation + queries + codegen + transport tests)

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Branch:** `feat/evaluation_rubric_scoring`

---

## Summary

Implemented the full GraphQL veneer over `EvaluationRubricService` (Task 6 surface): a Pothos input + object pair backed exclusively by `@/backend/types`, the `RubricWeaknessArea` Pothos enum registration, one flat root mutation, two flat root queries scoped to Teachers, side-effect barrel registrations, regenerated codegen artifacts, and a transport-test suite pinning the auth/scope/error-code contract end-to-end against a real server.

## Files Created

| File | Content |
|---|---|
| `backend/graphql/pothos/teachers/evaluation-rubric.pothos.ts` | `RubricEvaluationSubmitPothosInput` (score 0..100 int, notes, weaknessArea) + `RubricEvaluationPothosObject` (`id` first; fields: id, sessionId, evaluatorId, evaluatedId, score nullable, weaknessArea nullable, createdAt, applicantStatus) — types imported from `@/backend/types` only, no local types |
| `backend/graphql/mutation/evaluation-rubric.mutation.ts` | Flat root, no named exports, `gqlSchemaBuilder.mutationField("submitRubricEvaluation")`, scope `$all: { authenticated: true, role: [UserRole.Teacher] }`, resolver i18n `await ctx.t("errorsTranslations")`, delegates `ctx.user.id` + `ctx.locale` only, no `ctx.idempotencyKey` |
| `backend/graphql/query/teachers/evaluation-rubric.query.ts` | `myRubricPendingSessions(page, pageSize): SessionPage!` (canonical `SessionPage` reuse) + `myRubricEvaluation(sessionId): RubricEvaluation` — same Teacher `$all` scope |
| `frontend/graphql/test/teachers/evaluation-rubric.test.ts` | Transport suite: 15 tests / 215 expect() — anonymous UNAUTHORIZED; student/parent FORBIDDEN at role scope; happy PASS + FAIL trajectories; every typed code via `errors[].extensions.code` with localized messages; pending-read drains + own-submission read; cross-evaluator pending-read behavior |

## Files Modified

| File | Change |
|---|---|
| `backend/graphql/pothos/shared/enum.pothos.ts` | `RubricWeaknessAreaPothosEnum` registered via `gqlSchemaBuilder.enumType(RubricWeaknessArea, …)` (SessionType pattern, value import) |
| `backend/graphql/mutation/index.ts` | Side-effect import row |
| `backend/graphql/query/teachers/index.ts` | Side-effect import row |
| `frontend/graphql/generated/schema.graphql` (+ codegen artifacts) | Regenerated via `bun run generate:gqlSchema` + `bun codegen` |
| `backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/sdl-static-assertions.test.ts` | Static surface assertions extended for the new operations/enum |
| `test/helpers/fixture-rows.ts`, `test/helpers/index.ts` | Rubric fixture-row helpers for transport tests |

## SDL (regenerated artifacts, verbatim)

```graphql
mutation submitRubricEvaluation(input: RubricEvaluationSubmitInput!, sessionId: ID!): RubricEvaluation!
query myRubricEvaluation(sessionId: ID!): RubricEvaluation
query myRubricPendingSessions(page: Int, pageSize: Int): SessionPage!

enum RubricWeaknessArea {
  Hifz
  Tajweed
}

type RubricEvaluation {
  applicantStatus: ApplicantStatus!
  createdAt: DateTime!
  evaluatedId: ID!
  evaluatorId: ID!
  id: ID!
  score: Int
  sessionId: ID
  weaknessArea: RubricWeaknessArea
}
```

Enum members are PascalCase per the corrected plan §5.1 (plan-review-R1 fix). `notes` appears ONLY in the mutation input — it is absent from every selection surface (BOLA/BOPLA).

## Verification Evidence

- `bun tsgo 2>&1 | grep "error TS" | wc -l` → **0**
- `bun run test/scripts/run-test.ts frontend/graphql/test/teachers/evaluation-rubric.test.ts` → **15 passed / 0 failed** (215 expect calls, ~14s) — verified twice (one infra flake: stale listener on port 3066 caused EADDRINUSE; resolved via `test:kill` + port cleanup, clean re-run green)
- `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit **0** for: pothos object/input file, mutation, query, `enum.pothos.ts`, transport test file (after fixing 3 `promise/always-return` + reduce-seed typing issues in the test file)
- `bun run generate:gqlSchema` + `bun codegen` → artifacts committed to tree, no drift

## Behavior Pinned by the Transport Suite

- Anonymous → `UNAUTHORIZED`; student/parent → `FORBIDDEN` (role scope enforced before any service call)
- Happy path: 5×85 → PASS finalization (applicantStatus flip visible on the 5th return); sequential drain keeps `InEvaluation` until quorum
- Typed denials surface as `errors[].extensions.code`: `RUBRIC_SCORE_INVALID`, `RUBRIC_NOTES_REQUIRED`, `RUBRIC_WEAKNESS_REQUIRED`, `RUBRIC_WEAKNESS_NOT_ALLOWED`, `RUBRIC_WEAKNESS_INVALID`, `RUBRIC_SESSION_NOT_COMPLETED`, `EVALUATION_ALREADY_SUBMITTED`, `APPLICANT_ALREADY_FINALIZED`, `SESSION_NOT_FOUND`
- `myRubricPendingSessions` anti-join: a session vanishes from the caller's pending page once that caller submits
- `myRubricEvaluation` returns the caller's own submission; foreign sessions are not addressable

## Surface Handed to Task 10 (frontend documents)

- Mutation: `submitRubricEvaluation(input: RubricEvaluationSubmitInput!, sessionId: ID!): RubricEvaluation!`
- Queries: `myRubricPendingSessions(page: Int, pageSize: Int): SessionPage!`, `myRubricEvaluation(sessionId: ID!): RubricEvaluation`
- Object shape for `id`-first selections: `RubricEvaluation { id sessionId evaluatorId evaluatedId score weaknessArea createdAt applicantStatus }`

## Cross-File Dependencies

- Task 10 must name documents exactly `submitRubricEvaluationMutationDocument`, `myRubricPendingSessionsQueryDocument`, `myRubricEvaluationQueryDocument` with `id` first (Apollo normalization).
- Codegen artifacts are current; Task 10 consumes generated types only.

## Deferred Items

- None new (ledger stays D1–D4).
