/**
 * Evaluation-rubric Pothos types — the evaluator-facing read surface of the
 * rubric submission loop plus the client-controlled submission input.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - `RubricEvaluation` is backed EXCLUSIVELY by the canonical
 *    `RubricEvaluationReturnType` from `@/backend/types` — no local type
 *    definitions here. `EvaluationRubricService` is the only producer of
 *    that closed shape, which structurally omits the free-text `notes`
 *    observations (they never reach any transport shape) and carries the
 *    LIVE post-write applicant status, so the evaluator's surface can
 *    observe finalization on the final submit without any new applicant
 *    read surface.
 *  - `RubricEvaluationSubmitInput` is the evaluator-controlled whitelist
 *    (BOPLA): exactly the score, the qualitative observations, and the
 *    optional weakness area. The evaluated subject, the evaluator
 *    identity, the session linkage, and every stored stamp are derived
 *    server-side — the input structurally cannot carry them. The verdict
 *    is DERIVED server-side from the score (>= 80 passes), never
 *    supplied. Defined with the string-named `inputType` form, never
 *    `inputRef` (the input's nullability must not couple to the backend
 *    type's exact shape).
 *  - `id` is exposed FIRST on the object (Apollo cache normalization
 *    requires `id` on every entity-shaped object).
 *  - NO inline business logic — every field is a structural passthrough;
 *    both enum fields ride the Pothos enums registered ONCE in
 *    `shared/enum.pothos.ts` (the service guard-validates every stored
 *    value before it carries the wire type), and the creation instant
 *    rides the registered `DateTime` scalar.
 *
 * Consumed by the `submitRubricEvaluation` mutation resolver module
 * (`backend/graphql/mutation/evaluation-rubric.mutation.ts`) and the
 * `evaluation-rubric` query resolver module
 * (`backend/graphql/query/teachers/evaluation-rubric.query.ts`), whose
 * imports transitively register these types through the `gqlSchema.ts`
 * side-effect chain (the teachers domain keeps that
 * transitive-registration convention; the top Pothos barrel deliberately
 * does not list it).
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { ApplicantStatusPothosEnum, RubricWeaknessAreaPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { RubricEvaluationReturnType } from "@/backend/types";

/**
 * The evaluator's rubric submission read-model. Producers return
 * `RubricEvaluationReturnType`. Field order: `id` first (Apollo cache
 * normalization), then the session join and both participant ids, the
 * nullable score, the nullable weakness area, the creation instant, and
 * the LIVE applicant status.
 */
export const RubricEvaluationPothosObject = gqlSchemaBuilder
  .objectRef<RubricEvaluationReturnType>("RubricEvaluation")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // The evaluation session join — nullable: standalone applicant
      // evaluations carry no session, so honest nullability on the wire.
      sessionId: t.exposeID("sessionId", { nullable: true }),
      // The evaluated subject (the gated session's student,
      // server-resolved — never client-supplied).
      evaluatedId: t.exposeID("evaluatedId"),
      // The submitting evaluator (the authenticated caller,
      // server-resolved from the verified context).
      evaluatorId: t.exposeID("evaluatorId"),
      // The 0-100 rubric score — nullable on the column, so honest
      // nullability on the wire.
      score: t.exposeInt("score", { nullable: true }),
      // The recorded weakness area — null when the score met the pass
      // threshold (required below it, forbidden at or above it; the
      // iff-rule is the service's authority, the wire type only guards
      // the vocabulary).
      weaknessArea: t.field({
        type: RubricWeaknessAreaPothosEnum,
        nullable: true,
        resolve: parent => parent.weaknessArea,
      }),
      // Creation instant — NOT NULL column, non-nullable `DateTime!`
      // scalar (registered in `shared/scalar.pothos.ts`; serializes
      // `Date` to ISO-8601 UTC).
      createdAt: t.expose("createdAt", { type: "DateTime" }),
      // LIVE applicant status at read time — passed/failed once the cycle
      // finalized, in_evaluation while the quorum is pending. Direct
      // passthrough onto the enum registered in shared/enum.pothos (the
      // service guard-validates the stored value before it carries the
      // wire type).
      applicantStatus: t.field({
        type: ApplicantStatusPothosEnum,
        resolve: parent => parent.applicantStatus,
      }),
    }),
  });

/**
 * The evaluator-controlled submission whitelist (BOPLA): the score, the
 * qualitative observations, and the optional weakness area. The evaluated
 * subject (always the gated session's student), the evaluator identity
 * (always the verified context caller), the session linkage, and the
 * derived verdict are structurally absent — the service owns every rule.
 */
export const RubricEvaluationSubmitPothosInput = gqlSchemaBuilder.inputType("RubricEvaluationSubmitInput", {
  fields: t => ({
    score: t.int({
      required: true,
      description: "Integer 0..100 — the per-evaluation verdict is DERIVED (score >= 80), never supplied.",
    }),
    notes: t.string({
      required: true,
      description: "Qualitative observations (trimmed non-empty, <= 2000 chars).",
    }),
    weaknessArea: t.field({
      type: RubricWeaknessAreaPothosEnum,
      required: false,
      description: "Failure area — required iff score < 80, forbidden otherwise.",
    }),
  }),
});
