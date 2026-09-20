/**
 * `bookEvaluationSession` mutation — the teacher applicant's booking of ONE
 * evaluation session inside the current verification cycle.
 *
 * Contract:
 *  - `bookEvaluationSession(input: BookEvaluationSessionInput!): Session!`
 *    — the wire carries EXACTLY one client-owned field: the bookable
 *    evaluator's `users.id` (`input.evaluatorId`). The caller identity is
 *    server-bound from `ctx.user.id` (BOLA-proof: no requester id on the
 *    wire), and every stored session column (status, type, intent, fee,
 *    confirmation window, lifecycle timestamps) is derived server-side
 *    (BOPLA: the input structurally cannot carry them).
 *  - `args.input.evaluatorId` arrives as a GraphQL `ID` (string) and is
 *    mapped with a SHAPE-ONLY `Number(...)` parse — the value is
 *    re-validated by the service's pre-DB guard (`isPositiveSafeInteger`),
 *    which is the single authority for id-shape denials (VALIDATION).
 *  - The idempotency key is consumed EXACTLY as captured at the gateway
 *    (`ctx.idempotencyKey`, propagation-only): an absent header arrives as
 *    `null` and the resolver normalizes it to the empty string, which the
 *    service's own pre-DB guard rejects with the localized VALIDATION
 *    error — the denial channel is identical either way. The key is never
 *    re-derived, never trimmed, and never consultable by any authorization
 *    decision.
 *  - DomainErrors (anonymous UNAUTHORIZED, the service-level applicant
 *    gate APPLICANT_NOT_FOUND / APPLICANT_NOT_IN_EVALUATION, cycle
 *    VERIFICATION_NOT_ACTIVE, capacity EVALUATION_LOOP_COMPLETE /
 *    NO_EVALUATION_CREDITS_REMAINING, distinctness EVALUATOR_ALREADY_USED,
 *    evaluator TEACHER_NOT_FOUND / TEACHER_NOT_CERTIFIED, replay
 *    DUPLICATE_REQUEST / SESSION_NOT_FOUND) propagate uncaught to the
 *    masking boundary — no try/catch here.
 *
 * authScopes: `authenticated` only. The applicant eligibility predicate
 * (an `applicants` row in `in_evaluation`, an active verification
 * subscription, per-cycle capacity, and evaluator distinctness) lives at
 * the SERVICE level inside the booking transaction — declaring a role
 * scope here would split one gate across two layers and lock out the
 * surface for legitimate applicant roles that carry no dedicated role
 * check (scope-composition rule in `backend/graphql/AGENTS.md`).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation;
 *    no business logic inline. Top-level static imports only.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { BookEvaluationSessionPothosInput } from "@/backend/graphql/pothos/teachers/evaluation-booking.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { EvaluationBookingService } from "@/backend/services/teachers/evaluation-booking.service";

// Side-effect: register the `bookEvaluationSession` mutation field.
gqlSchemaBuilder.mutationField("bookEvaluationSession", t =>
  t.field({
    // The canonical `Session` object is reused verbatim — no new
    // session-shaped type exists for booking.
    type: SessionPothosObject,
    description: "Book one evaluation session as an applicant. BOLA-proof: identity from session.",
    args: {
      input: t.arg({ type: BookEvaluationSessionPothosInput, required: true }),
    },
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see
      // `mutation/verification-plan-purchase.mutation.ts`. The
      // `authenticated` scope rejects this state first; the fallback still
      // carries the canonical LOCALIZED unauthorized copy (the resolver
      // localization contract — never a hardcoded string).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // Identity from the session, evaluator from the sealed input, key
      // from the propagation-only gateway capture, locale for localized
      // denials. The `?? ""` leg only materializes the missing-key
      // VALIDATION denial — the service's pre-DB guard is the sole
      // authority.
      return EvaluationBookingService.bookEvaluation(
        ctx.user.id,
        { evaluatorId: Number(args.input.evaluatorId) },
        ctx.idempotencyKey ?? "",
        ctx.locale
      );
    },
  })
);
