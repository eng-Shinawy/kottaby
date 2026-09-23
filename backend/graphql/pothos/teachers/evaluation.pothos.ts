/**
 * EvaluationPothosObject — the single canonical GraphQL object type for an
 * evaluation row, plus the star-rating input for the student→teacher
 * session-rating submission.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical `EvaluationReturnType` from
 *    `@/backend/types` — no local type definitions here. The service
 *    (`StudentEvaluationService`) is the only producer of that closed shape,
 *    which strips the soft-delete internals (`isDeleted`/`deletedAt`), the
 *    free-text `notes`, and the server-managed `updatedAt` stamp — none of
 *    those columns are exposed here (BOPLA: the wire shape can never leak
 *    them, because the backing type does not carry them).
 *  - `Evaluation` exposes `id` FIRST (Apollo cache normalization), then the
 *    rated subject and rater ids, the nullable session join, the nullable
 *    0-100 score, and the creation instant. Nullability mirrors the columns:
 *    applicant evaluations and session deletions leave `sessionId` NULL, the
 *    score column is nullable, `createdAt` is NOT NULL.
 *  - `SubmitTeacherEvaluationInput` is the student-controlled whitelist:
 *    exactly the whole-star `rating` (the service converts it to the stored
 *    score and derives every other column server-side — no session id, no
 *    evaluator id, no score on the input). Defined with the string-named
 *    `inputType` form, never `inputRef` (the input's nullability must not
 *    couple to the backend type's exact shape).
 *  - NO enum registration and NO inline business logic — every field is a
 *    structural passthrough.
 *
 * Consumed by the `submitTeacherEvaluation` mutation and the
 * `myTeacherEvaluations` query resolver modules, whose imports transitively
 * register both types through the `gqlSchema.ts` side-effect chain (the
 * teachers domain keeps that transitive-registration convention; the top
 * Pothos barrel deliberately does not list it).
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { EvaluationReturnType } from "@/backend/types";

/**
 * The canonical `Evaluation` GraphQL object. Producers return
 * `EvaluationReturnType`. Field order: `id` first (Apollo cache
 * normalization), the two participant ids, the optional session join, the
 * optional score, then the creation stamp.
 */
export const EvaluationPothosObject = gqlSchemaBuilder.objectRef<EvaluationReturnType>("Evaluation").implement({
  fields: t => ({
    // ID FIRST — Apollo cache normalization requires `id` on every
    // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
    id: t.exposeID("id"),
    // The rated subject (the session's teacher, server-derived) — `Int!`.
    evaluatedId: t.exposeInt("evaluatedId"),
    // The rater (the calling student, server-derived from the verified
    // context) — `Int!`.
    evaluatorId: t.exposeInt("evaluatorId"),
    // The rated session join — nullable: standalone applicant evaluations
    // carry no session, and a deleted session nulls the link (SET NULL)
    // while the rating row survives.
    sessionId: t.exposeInt("sessionId", { nullable: true }),
    // The 0-100 score (whole stars × 20, derived server-side) — nullable
    // on the column, so honest nullability on the wire.
    score: t.exposeInt("score", { nullable: true }),
    // Creation instant — NOT NULL column, non-nullable `DateTime!` scalar
    // (registered in `shared/scalar.pothos.ts`; serializes `Date` to
    // ISO-8601 UTC).
    createdAt: t.expose("createdAt", { type: "DateTime" }),
  }),
});

/**
 * The student-controlled submission whitelist (BOPLA): exactly one field,
 * the whole-star `rating` (1..5, service-guarded). Row identity, both
 * participant ids, the score conversion, and every timestamp are
 * structurally absent — the session id arrives as the mutation argument and
 * every stored column is derived server-side.
 */
export const SubmitTeacherEvaluationPothosInput = gqlSchemaBuilder.inputType("SubmitTeacherEvaluationInput", {
  fields: t => ({
    rating: t.int({ required: true }),
  }),
});
