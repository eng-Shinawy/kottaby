/**
 * Evaluation-rubric query resolvers — the evaluator-facing read surface of
 * the rubric submission loop:
 *
 *  - `myRubricPendingSessions(page: Int, pageSize: Int): SessionPage!` —
 *    the calling certified evaluator's completed `teacher_evaluation`
 *    sessions that still await a rubric submission, paged. Reuses the
 *    canonical `SessionPage` object verbatim — no new session-shaped
 *    wrapper exists for this read. The rows are the caller's OWN by
 *    construction (the owner equality on the session's teacher leg), and
 *    the certification gate is the oracle-safe filter: a Teacher-role
 *    caller without the certified-evaluator row gets the EMPTY page
 *    (never an error — an error would reveal certification state).
 *  - `myRubricEvaluation(sessionId: ID!): RubricEvaluation` — the calling
 *    evaluator's OWN rubric submission for one session. The (session,
 *    evaluator) pair is the only scope: an unknown pair and a foreign
 *    pair (another evaluator's session) share the ONE byte-identical
 *    SESSION_NOT_FOUND denial — no oracle. A hit returns the read-model
 *    with the LIVE applicant status; the free-text observations are
 *    structurally absent from the wire shape.
 *
 * authScopes 401/403 split (the explicit `$all` conjunction — a plain
 * key-map combines its keys with ANY semantics in this engine): anonymous
 * callers hit the `authenticated` scope's UnauthorizedError throw
 * (UNAUTHORIZED / 401), authenticated non-teachers fail the `role` leg
 * into the canonical localized ForbiddenError (FORBIDDEN / 403) — the
 * service is never reached.
 *
 * Resolver bodies are THIN DELEGATION:
 *  - Identity comes EXCLUSIVELY from the verified context (`ctx.user.id`)
 *    — no caller-supplied identity surface of any kind (BOLA), and NO
 *    argument accepts an evaluated/applicant id (the pending page is
 *    caller-keyed; the submission read is pair-keyed by the caller).
 *  - Boundary validation (page/pageSize bounds) is FORWARDED to the
 *    service — it normalizes the effective window pre-DB and echoes it
 *    honestly; the resolver re-validates nothing and carries ZERO
 *    business logic. The `??` legs restore the conventional defaults when
 *    a client omits the args or sends an EXPLICIT `null` (GraphQL field
 *    defaults do not apply to explicit nulls).
 *  - `args.sessionId` maps through the shared SHAPE-ONLY decimal coercion
 *    (`coerceDecimalSessionId`); the resulting NaN dies in the service's
 *    pre-DB shape guard (the denial shape stays the service's).
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

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionPagePothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { RubricEvaluationPothosObject } from "@/backend/graphql/pothos/teachers/evaluation-rubric.pothos";
import { coerceDecimalSessionId, requireVerifiedUser } from "@/backend/graphql/shared";
import { EvaluationRubricService } from "@/backend/services/teachers/evaluation-rubric.service";

// Side-effect: register the `myRubricPendingSessions` query field.
gqlSchemaBuilder.queryField("myRubricPendingSessions", t =>
  t.field({
    type: SessionPagePothosObject,
    description:
      "The calling certified evaluator's completed evaluation sessions with NO rubric submission yet (paged).",
    args: {
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
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
      // step); `requireVerifiedUser` is the TS-narrowing belt for the
      // no-non-null-assertion rule and is unreachable in practice.
      const user = await requireVerifiedUser(ctx);
      // Caller-scoped read: identity is the verified context user, the
      // read's only filter. The service normalizes the effective window
      // pre-DB (defaults page=1, pageSize=25, max 100) and echoes it
      // honestly — the resolver forwards, never clamps.
      return EvaluationRubricService.myRubricPendingSessions(user.id, args.page ?? 1, args.pageSize ?? 25, ctx.locale);
    },
  })
);

// Side-effect: register the `myRubricEvaluation` query field.
gqlSchemaBuilder.queryField("myRubricEvaluation", t =>
  t.field({
    // Nullable payload — a denial surfaces as the typed SESSION_NOT_FOUND
    // error next to a null data member (unknown and foreign pairs are
    // byte-identical; no oracle).
    type: RubricEvaluationPothosObject,
    nullable: true,
    description:
      "The calling evaluator's own rubric submission for one session (unknown/foreign -> SESSION_NOT_FOUND).",
    args: {
      sessionId: t.arg.id({ required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireVerifiedUser(ctx);
      // `ID` arrives as a string on the wire; the shared coercion guard
      // admits only a positive decimal-integer id — a lazy parse would
      // silently address a DIFFERENT session than the one named on the
      // wire, so a non-decimal id arrives at the service as NaN and dies
      // in its pre-DB VALIDATION shape guard (the denial shape stays the
      // service's).
      const sessionId = coerceDecimalSessionId(args.sessionId);
      // Pair-keyed read: the (session, evaluator) scope is completed by
      // the verified caller — no client-supplied evaluator id exists.
      return EvaluationRubricService.myRubricEvaluation(user.id, sessionId, ctx.locale);
    },
  })
);
