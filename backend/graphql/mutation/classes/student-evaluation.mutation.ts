/**
 * Student evaluation mutation — the student-only `submitTeacherEvaluation`:
 * the write-once student→teacher rating of one completed session's teacher.
 *
 * Contract:
 *  - `submitTeacherEvaluation(sessionId: ID!, input: SubmitTeacherEvaluationInput!): Evaluation!`
 *      Student-only (`$all` scope conjunction). The acting student is
 *      resolved SERVER-side from `ctx.user.id` — never client-supplied
 *      (BOLA); the rated teacher is derived from the session row inside the
 *      service. Every business rule (the positive-safe-integer session id
 *      re-assertion, the whole-star 1..5 rating guard, the dual-confirmation
 *      completion gate, the one-rating-per-session write-once conflict, the
 *      `rating × 20` score conversion) lives in `StudentEvaluationService`.
 *
 * authScopes 401/403 split (mirrors `session-report.mutation.ts`, verified
 * against @pothos/plugin-scope-auth@4.1.7):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`), so ANY authenticated caller would pass.
 *  - The conjunction is therefore made EXPLICIT with `$all`: anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 — explicit throws pass through
 *    builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 *    non-students fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403).
 *
 * Resolvers are THIN DELEGATION ONLY (`backend/graphql/mutation/AGENTS.md`
 * + `backend/graphql/AGENTS.md`): no business logic, no repository calls,
 * no try/catch — DomainErrors from `StudentEvaluationService` propagate
 * uncaught to the masking boundary with their `extensions.code` untouched
 * (`SESSION_NOT_FOUND`, `EVALUATION_SESSION_NOT_COMPLETED`,
 * `EVALUATION_ALREADY_SUBMITTED`, `VALIDATION`); all localized messaging
 * happens inside the service via `ctx.locale` propagation — this file
 * carries NO resolver-local error copy and NO business branching.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — it registers the root field at
 *    import time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/classes/index.ts` →
 *    `mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  EvaluationPothosObject,
  SubmitTeacherEvaluationPothosInput,
} from "@/backend/graphql/pothos/teachers/evaluation.pothos";
import { coerceDecimalSessionId } from "@/backend/graphql/shared";
import { UnauthorizedError } from "@/backend/lib/errors";
import { StudentEvaluationService } from "@/backend/services/teachers";

// Side-effect: register the `submitTeacherEvaluation` mutation field.
gqlSchemaBuilder.mutationField("submitTeacherEvaluation", t =>
  t.field({
    type: EvaluationPothosObject,
    args: {
      sessionId: t.arg.id({ required: true }),
      input: t.arg({ type: SubmitTeacherEvaluationPothosInput, required: true }),
    },
    description:
      "Submit the calling student's rating of one session's teacher: a whole-star 1..5 rating stored on the 0-100 score scale, exactly once per session. An unfinished handshake surfaces EVALUATION_SESSION_NOT_COMPLETED, a re-submission EVALUATION_ALREADY_SUBMITTED, and an unknown or foreign session is indistinguishable from SESSION_NOT_FOUND. Student-only.",
    // Explicit `$all` conjunction per the 401/403 split documented above:
    // anonymous callers hit UNAUTHORIZED (401), authenticated non-students
    // fail the `role` leg into the canonical localized FORBIDDEN (403).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message resolves through the
      // request locale per the resolver localization contract and is
      // unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      // `ID` arrives as a string on the wire; the shared coercion guard
      // admits only a positive decimal-integer id — a lazy parse ("1e0",
      // "0x1", " 1") would silently address a DIFFERENT session than the
      // one named on the wire, so a non-decimal id arrives at the service
      // as NaN and dies in its pre-DB VALIDATION shape guard (the
      // localized-message channel stays the service's, per the recitation
      // mutation precedent).
      const sessionId = coerceDecimalSessionId(args.sessionId);
      // BOPLA field-by-field hand-off — the rating is the ONLY client-owned
      // value and maps member by member into the service input (NO spread);
      // the rater identity stays server-bound and every stored column is
      // derived by the service. The service owns every validation rule;
      // nothing is re-checked here.
      return StudentEvaluationService.submitTeacherEvaluation(
        ctx.user.id,
        sessionId,
        { rating: args.input.rating },
        ctx.locale
      );
    },
  })
);
