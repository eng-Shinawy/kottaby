/**
 * CreateSessionInput — Pothos input type for the student-only
 * `createSession` mutation.
 *
 * Field whitelist mirrors `SessionSubmitInput` (BOPLA-safe — plan §3.1
 * REQ-060 SDL parity):
 *  - `teacherId: ID!` — the ONLY client-owned targeting field. The mutation
 *    resolver maps it onto the service's numeric boundary (shape-only
 *    parse); `SessionLifecycleService.createSession` re-validates it as a
 *    positive safe integer and resolves the booking target's certification
 *    under lock.
 *  - `intent: SessionIntent!` — the FULL registered enum (`SessionIntent`
 *    member values only; Pothos rejects anything else at the GraphQL
 *    layer). The out-of-vocabulary-for-booking member (`evaluation`) is
 *    deliberately accepted by the SDL and rejected by the SERVICE's
 *    runtime guard (`VALIDATION` + `invalidSessionIntent`, pre-DB, REQ-050)
 *    — evaluation sessions are governed by the evaluation-session
 *    contract, not this booking surface.
 *
 * No student id, no status, no session type, no fee, no hold marker, no
 * held lane, no deadlines, no confirmation stamps, no timestamps — every
 * server-controlled column is structurally absent (the student identity is
 * resolved server-side from `ctx.user.id`; `heldBalanceLane` never reaches
 * any SDL surface).
 *
 * Lives in `backend/graphql/pothos/classes/` per `backend/graphql/mutation/
 * AGENTS.md` ("input types live in the pothos layer — mutation files only
 * register root fields"). Consumed by
 * `backend/graphql/mutation/classes/session-lifecycle.mutation.ts` through
 * the side-effect import chain.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionIntentPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";

/** Input type for the `createSession` mutation. */
export const CreateSessionInput = gqlSchemaBuilder.inputType("CreateSessionInput", {
  fields: t => ({
    // The booking target — a teachable (certified) teacher's user id.
    // Surface shape is `ID!` per plan §3.1; the numeric parse + positive
    // safe-integer validation happen at the resolver/service boundary.
    teacherId: t.id({ required: true }),
    // Booking intent — the registered `SessionIntent` enum (REQ-060 SDL
    // parity). `evaluation` reaches the service's runtime guard → VALIDATION.
    intent: t.field({ type: SessionIntentPothosEnum, required: true }),
  }),
});
