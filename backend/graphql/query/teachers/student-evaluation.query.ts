/**
 * `myTeacherEvaluations` query — the caller's own student→teacher ratings.
 *
 * Contract:
 *  - ZERO arguments — identity is derived EXCLUSIVELY from the verified
 *    context (`ctx.user.id`). There is no caller-supplied filter of any
 *    kind: BOLA probes have no surface to address (the evaluator id is the
 *    read's only filter, and it is server-bound), so the result is exactly
 *    the caller's own rating history, newest first.
 *  - `[Evaluation!]!` — non-nullable list of non-nullable rows; an empty
 *    history is an empty list, never null. Non-paginated by design: a
 *    student's rating history is naturally bounded by the sessions they
 *    have completed.
 *  - DomainErrors thrown deeper (`VALIDATION` for malformed input shapes —
 *    unreachable here with zero arguments) propagate uncaught to the
 *    masking boundary (no try/catch by contract).
 *
 * authScopes 401/403 split (mirrors `applicant.query.ts`, verified against
 * the pinned @pothos/plugin-scope-auth@4.1.7):
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
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/teachers/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (backend/graphql/AGENTS.md); no business logic inline.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { EvaluationPothosObject } from "@/backend/graphql/pothos/teachers/evaluation.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { StudentEvaluationService } from "@/backend/services/teachers";

// Side-effect: register the `myTeacherEvaluations` query field.
gqlSchemaBuilder.queryField("myTeacherEvaluations", t =>
  t.field({
    type: [EvaluationPothosObject],
    // Explicit `$all` conjunction per the 401/403 split documented above.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, _args, ctx) => {
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
      // Caller-scoped read: the evaluator id is the verified context user,
      // the read's only filter — no argument exists through which the
      // result could be widened toward another rater. Cold read path (no
      // caller-owned transaction on the production GraphQL surface).
      return StudentEvaluationService.listMyTeacherEvaluations(ctx.user.id);
    },
  })
);
