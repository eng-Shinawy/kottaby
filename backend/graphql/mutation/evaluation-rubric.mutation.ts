/**
 * `submitRubricEvaluation` mutation — the certified evaluator's write-once
 * rubric submission for one of their OWN completed evaluation sessions.
 *
 * Contract:
 *  - `submitRubricEvaluation(sessionId: ID!, input: RubricEvaluationSubmitInput!): RubricEvaluation!`
 *    — the wire carries EXACTLY the client-controlled rubric fields
 *    (score, notes, optional weakness area). The caller identity is
 *    server-bound from `ctx.user.id` (BOLA-proof: no requester or
 *    evaluated-subject id on the wire — the evaluated applicant is
 *    ALWAYS the gated session's student, resolved inside the service),
 *    the verdict is DERIVED from the score, and every stored column is
 *    assembled into the service's sealed insert payload (BOPLA: the
 *    input structurally cannot carry participant ids, session linkage,
 *    or lifecycle stamps).
 *  - `args.sessionId` arrives as a GraphQL `ID` (string) and is mapped
 *    with the shared SHAPE-ONLY decimal coercion (`coerceDecimalSessionId`)
 *    — a lazy parse ("1e0", "0x1", " 1") would silently address a
 *    DIFFERENT session than the one named on the wire; the resulting NaN
 *    dies in the service's pre-DB shape guard (the canonical localized
 *    VALIDATION denial — the service boundary owns the denial shape).
 *  - There is deliberately NO idempotency-key machinery on this flow: the
 *    (session, evaluator) unique index is the replay arbiter, and any
 *    racing duplicate collapses onto the typed
 *    EVALUATION_ALREADY_SUBMITTED conflict inside the service
 *    transaction. `ctx.idempotencyKey` is never read here.
 *  - DomainErrors (anonymous UNAUTHORIZED, the service-level validation
 *    band RUBRIC_SCORE_INVALID / RUBRIC_NOTES_REQUIRED /
 *    RUBRIC_WEAKNESS_REQUIRED / RUBRIC_WEAKNESS_NOT_ALLOWED, the
 *    oracle-free SESSION_NOT_FOUND, RUBRIC_SESSION_NOT_COMPLETED,
 *    TEACHER_NOT_CERTIFIED, APPLICANT_NOT_IN_EVALUATION,
 *    EVALUATION_ALREADY_SUBMITTED, APPLICANT_ALREADY_FINALIZED)
 *    propagate uncaught to the masking boundary — no try/catch here;
 *    localized messaging happens inside the service via `ctx.locale`
 *    propagation.
 *
 * authScopes 401/403 split (mirrors `student-evaluation.mutation.ts`,
 * verified against @pothos/plugin-scope-auth): a plain
 * `{ authenticated: true, role: [...] }` map is WRONG in this engine —
 * Pothos combines the keys of ONE scope map with ANY semantics
 * (`defaultStrategy: "any"`), so ANY authenticated caller would pass.
 * The conjunction is therefore made EXPLICIT with `$all`: anonymous
 * callers hit the `authenticated` scope's UnauthorizedError throw
 * (extensions.code UNAUTHORIZED / 401 — explicit throws pass through
 * builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 * non-teachers fail the `role` scope into the canonical localized
 * ForbiddenError (FORBIDDEN / 403) — the service is never reached.
 * The certification predicate (an `is_approved` AND `is_evaluator`
 * teacher row, re-verified fresh inside the submission transaction) is
 * a SERVICE gate on top of the role scope, never a scope substitute.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation;
 *    no business logic inline. Top-level static imports only.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  RubricEvaluationPothosObject,
  RubricEvaluationSubmitPothosInput,
} from "@/backend/graphql/pothos/teachers/evaluation-rubric.pothos";
import { coerceDecimalSessionId } from "@/backend/graphql/shared";
import { UnauthorizedError } from "@/backend/lib/errors";
import { EvaluationRubricService } from "@/backend/services/teachers/evaluation-rubric.service";

// Side-effect: register the `submitRubricEvaluation` mutation field.
gqlSchemaBuilder.mutationField("submitRubricEvaluation", t =>
  t.field({
    // The rubric submission read-model (notes deliberately absent — the
    // free-text observations never reach any transport shape).
    type: RubricEvaluationPothosObject,
    description:
      "Submit the calling evaluator's rubric for one of their completed teacher_evaluation sessions. Write-once per (session, evaluator). Teacher-only.",
    args: {
      sessionId: t.arg.id({ required: true }),
      input: t.arg({ type: RubricEvaluationSubmitPothosInput, required: true }),
    },
    // Explicit `$all` conjunction per the 401/403 split documented above:
    // anonymous callers hit UNAUTHORIZED (401), authenticated non-teachers
    // fail the `role` leg into the canonical localized FORBIDDEN (403).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message resolves through the
      // request locale per the resolver localization contract (never a
      // hardcoded string) and is unreachable in practice.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // `ID` arrives as a string on the wire; the shared coercion guard
      // admits only a positive decimal-integer id — anything else arrives
      // at the service as NaN and dies in its pre-DB VALIDATION shape
      // guard (the denial shape stays the service's).
      const sessionId = coerceDecimalSessionId(args.sessionId);
      // BOPLA field-by-field hand-off — the rubric fields are the ONLY
      // client-owned values and map member by member into the service
      // input (NO spread); the evaluator identity stays server-bound, the
      // evaluated subject is resolved from the gated session inside the
      // service, and the verdict is derived from the score. The weakness
      // member normalizes an omitted value to null (the service's iff-rule
      // owns both directions). No idempotency key: the write-once unique
      // index is the replay arbiter.
      return EvaluationRubricService.submitRubricEvaluation(
        ctx.user.id,
        sessionId,
        {
          score: args.input.score,
          notes: args.input.notes,
          weaknessArea: args.input.weaknessArea ?? null,
        },
        ctx.locale
      );
    },
  })
);
