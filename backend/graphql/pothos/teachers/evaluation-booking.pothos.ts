/**
 * Evaluation-booking Pothos types — the applicant-facing read surfaces of
 * the five-session evaluation loop plus the sealed one-field booking input.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - `EvaluationLoopStatus` is backed EXCLUSIVELY by the canonical
 *    `EvaluationLoopStatusReturnType` from `@/backend/types` — the
 *    evaluation-booking service is its only producer. It is a derived
 *    blob (no single table behind it), so it exists as its own object
 *    beside the canonical `Session`/`SessionPage` types — no
 *    session-shaped object is duplicated here; the booking mutation
 *    returns the EXISTING canonical `Session` and the session list
 *    returns the EXISTING canonical `SessionPage` (reused verbatim).
 *  - `EvaluationEvaluatorOption` is backed by the PII-free
 *    `EvaluationEvaluatorOptionType` (users id, full name, online flag,
 *    decimal-as-string rating, subjects — no email/phone/credentials on
 *    the wire), and `EvaluationEvaluatorOptionPage` by its page-echo
 *    return shape (`items`/`totalCount`/`page`/`pageSize`).
 *  - `id` is exposed FIRST on every option member (Apollo cache
 *    normalization requires `id` on every object).
 *  - `BookEvaluationSessionInput` is the applicant-controlled whitelist
 *    (BOPLA): exactly the bookable evaluator's `users.id` — the ONLY
 *    client-owned field. Every stored column (status, type, intent, fee,
 *    confirmation window, participants' timestamps) is derived
 *    server-side and structurally absent from the input. Defined with the
 *    string-named `inputType` form, never `inputRef` (nullability must not
 *    couple to the backend type's exact shape).
 *  - NO enum registration and NO inline business logic — every field is a
 *    structural passthrough; `cycleStartDate` rides the registered
 *    `DateTime` scalar (nullable: `null` encodes "no active cycle").
 *
 * Consumed by the `bookEvaluationSession` mutation resolver module
 * (`backend/graphql/mutation/evaluation-booking.mutation.ts`) and the
 * `evaluation-booking` query resolver module
 * (`backend/graphql/query/teachers/evaluation-booking.query.ts`), whose
 * imports transitively register these types through the `gqlSchema.ts`
 * side-effect chain (the teachers domain keeps that transitive-registration
 * convention; the top Pothos barrel deliberately does not list it).
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type {
  EvaluationEvaluatorOptionPageReturnType,
  EvaluationEvaluatorOptionType,
  EvaluationLoopStatusReturnType,
} from "@/backend/types";

/**
 * The applicant's CURRENT evaluation-cycle progress blob. Producers return
 * `EvaluationLoopStatusReturnType`; the loop-closed case is the fixed
 * zero-shape (`bookedCount: 0, completedCount: 0, remainingCredits: 0,
 * cycleStartDate: null`), never an error.
 */
export const EvaluationLoopStatusPothosObject = gqlSchemaBuilder
  .objectRef<EvaluationLoopStatusReturnType>("EvaluationLoopStatus")
  .implement({
    fields: t => ({
      bookedCount: t.exposeInt("bookedCount", {
        description: "Sessions booked in the current cycle (non-cancelled).",
      }),
      completedCount: t.exposeInt("completedCount", {
        description: "Sessions completed in the current cycle.",
      }),
      remainingCredits: t.exposeInt("remainingCredits", {
        description: "Remaining evaluation credits (0..5).",
      }),
      cycleStartDate: t.expose("cycleStartDate", {
        type: "DateTime",
        nullable: true,
        description: "Start date of the active verification subscription; null when no active cycle.",
      }),
    }),
  });

/**
 * The PII-free evaluator-picker option. Producers return
 * `EvaluationEvaluatorOptionType`; field order: `id` first (Apollo cache
 * normalization), then the display surface.
 */
const EvaluationEvaluatorOptionPothosObject = gqlSchemaBuilder
  .objectRef<EvaluationEvaluatorOptionType>("EvaluationEvaluatorOption")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (the evaluator's users.id, surfaced as
      // GraphQL `ID!`).
      id: t.exposeID("id"),
      fullName: t.exposeString("fullName"),
      isOnline: t.exposeBoolean("isOnline"),
      // Decimal-as-string per the teacher table — honest nullability.
      averageRating: t.exposeString("averageRating", {
        nullable: true,
        description: "Decimal-as-string per the teacher table.",
      }),
      subjects: t.exposeString("subjects", { nullable: true }),
    }),
  });

/**
 * The evaluator-picker page. Producers return
 * `EvaluationEvaluatorOptionPageReturnType`; `page`/`pageSize` echo the
 * effective (service-normalized) window honestly.
 */
export const EvaluationEvaluatorOptionPagePothosObject = gqlSchemaBuilder
  .objectRef<EvaluationEvaluatorOptionPageReturnType>("EvaluationEvaluatorOptionPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [EvaluationEvaluatorOptionPothosObject],
        resolve: parent => parent.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * The applicant-controlled booking whitelist (BOPLA): exactly one field,
 * the bookable evaluator's `users.id`. The session row (its identity,
 * status, type, intent, fee, and confirmation window), the caller identity,
 * and the idempotency key are all derived server-side — the resolver binds
 * the caller from the verified context and the key from the
 * propagation-only gateway capture.
 */
export const BookEvaluationSessionPothosInput = gqlSchemaBuilder.inputType("BookEvaluationSessionInput", {
  fields: t => ({
    evaluatorId: t.id({
      required: true,
      description: "The bookable evaluator's users.id — the ONLY client-owned field.",
    }),
  }),
});
