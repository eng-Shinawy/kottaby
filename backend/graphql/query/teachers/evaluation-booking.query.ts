/**
 * Evaluation-booking query resolvers — the applicant's read surface for the
 * five-session evaluation loop:
 *
 *  - `myEvaluationLoopStatus: EvaluationLoopStatus` — nullable; the
 *    caller's CURRENT-cycle progress blob. The service returns the fixed
 *    zero-shape (`0 / 0 / 0 / null`) for callers with no applicants row or
 *    no active cycle (no oracle, no read leak — certified teachers and
 *    non-applicants receive the same zero-shape).
 *  - `availableEvaluators(page: Int, pageSize: Int):
 *    EvaluationEvaluatorOptionPage!` — the certified+evaluator teachers
 *    not yet used in the caller's current cycle, PII-free, paged. The
 *    service gate keeps the read booking-surface-only: a caller without an
 *    active cycle gets the localized VERIFICATION_NOT_ACTIVE conflict and
 *    NO evaluator identity is ever revealed to them.
 *  - `myEvaluationSessions(filter: SessionListFilterInput, page: Int,
 *    pageSize: Int): SessionPage!` — the caller's own teacher-evaluation
 *    sessions, paged (the canonical `SessionPage` reused verbatim). The
 *    predicate is caller-keyed by construction: a non-applicant's page is
 *    empty, never an error.
 *
 * authScopes: `authenticated` only on all three fields. Every eligibility
 * predicate (applicant state, active cycle) is SERVICE-side — declaring a
 * role scope here would split one gate across two layers and lock out
 * legitimate caller roles that carry no dedicated role check
 * (scope-composition rule in `backend/graphql/AGENTS.md`).
 *
 * Resolver bodies are THIN DELEGATION:
 *  - Identity comes EXCLUSIVELY from the verified context (`ctx.user.id`)
 *    — no caller-supplied identity surface of any kind (BOLA).
 *  - Boundary validation (filter vocabulary, page/pageSize bounds) is
 *    FORWARDED to the service — it normalizes the effective window pre-DB
 *    and echoes it honestly; the resolver re-validates nothing and carries
 *    ZERO business logic. The `??` legs restore the conventional defaults
 *    when a client omits the args or sends an EXPLICIT `null` (GraphQL
 *    field defaults do not apply to explicit nulls).
 *  - The absent filter arg becomes the empty filter (the `status` member
 *    drops out at the service guard — filters never error).
 *  - Locale propagates to every service call (localized denials).
 *  - Zero repository calls; top-level static imports ONLY (no
 *    `await import(`).
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired via side-effect barrels:
 *    `query/teachers/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */

import type { Context } from "@/backend/graphql/gqlContextFactory";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionPagePothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { SessionListFilterPothosInput } from "@/backend/graphql/pothos/classes/session-filter-input.pothos";
import {
  EvaluationEvaluatorOptionPagePothosObject,
  EvaluationLoopStatusPothosObject,
} from "@/backend/graphql/pothos/teachers/evaluation-booking.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { EvaluationBookingService } from "@/backend/services/teachers/evaluation-booking.service";
import type { SessionListFilterInput } from "@/backend/types";

/**
 * Context narrowing guard shared by all three fields — the `authenticated`
 * scope guarantees a verified user row at resolution time (anonymous
 * callers never get past the scope step). This exists purely for
 * TypeScript narrowing: the repo-wide no-non-null-assertion rule forbids
 * dereferencing the nullable context directly; the thrown message resolves
 * through the request locale per the resolver localization contract
 * (never a hardcoded string) and is unreachable in practice.
 */
async function requireCtxUser(ctx: Context): Promise<NonNullable<Context["user"]>> {
  if (!ctx.user) {
    const tErrors = await ctx.t("errorsTranslations");
    throw new UnauthorizedError(tErrors.unauthorized);
  }
  return ctx.user;
}

// Side-effect: register the `myEvaluationLoopStatus` query field.
gqlSchemaBuilder.queryField("myEvaluationLoopStatus", t =>
  t.field({
    // Nullable payload — `null` is legal on the wire; the service chooses
    // the fixed zero-shape for the loop-closed case instead (UI-simple).
    type: EvaluationLoopStatusPothosObject,
    nullable: true,
    description: "Applicant's current evaluation loop status; zero-shape when no active cycle.",
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, _args, ctx) => {
      // Caller-scoped read: identity is the verified context user, the
      // read's only filter. Cold read path (no caller-owned transaction on
      // the production GraphQL surface).
      const user = await requireCtxUser(ctx);
      return EvaluationBookingService.myEvaluationLoopStatus(user.id, ctx.locale);
    },
  })
);

// Side-effect: register the `availableEvaluators` query field.
gqlSchemaBuilder.queryField("availableEvaluators", t =>
  t.field({
    type: EvaluationEvaluatorOptionPagePothosObject,
    description: "Unused certified evaluators (not yet used in the current cycle).",
    args: {
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // The service normalizes the effective window pre-DB (defaults
      // page=1, pageSize=25, max 100) and echoes it honestly — the
      // resolver forwards, never clamps.
      const user = await requireCtxUser(ctx);
      return EvaluationBookingService.availableEvaluators(user.id, args.page ?? 1, args.pageSize ?? 25, ctx.locale);
    },
  })
);

// Side-effect: register the `myEvaluationSessions` query field.
gqlSchemaBuilder.queryField("myEvaluationSessions", t =>
  t.field({
    type: SessionPagePothosObject,
    description: "Current applicant's evaluation session list (paged).",
    args: {
      filter: t.arg({ type: SessionListFilterPothosInput, required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // The absent filter becomes the empty filter (the `status` member
      // drops out at the service guard); page bounds normalize at the
      // service, which echoes the effective window honestly.
      const user = await requireCtxUser(ctx);
      const filter: SessionListFilterInput = args.filter ?? {};
      return EvaluationBookingService.myEvaluationSessions(
        user.id,
        filter,
        args.page ?? 1,
        args.pageSize ?? 25,
        ctx.locale
      );
    },
  })
);
