/**
 * Session arbitration queries — `adminDisputeCase` (the admin's
 * case-review read over one disputed session, the evidence bundle behind
 * the arbitration decision), `teacherDisputeCase` (the session's own
 * teacher's participant-side transparency bundle) and `studentDisputeCase`
 * (the session's own student's — the filing party's — exact mirror).
 *
 * Contract:
 *  - `adminDisputeCase(id: ID!): AdminDisputeCase!` — the full session row
 *    (dispute reason, stamps, fee, hold marker), the session report, the
 *    homework record, the recitation record, and the session-scoped audit
 *    trail, in ONE response. Artifacts that were never produced surface as
 *    honest `null`s (`report`/`homework`/`recitation`) or an empty trail —
 *    never fabricated placeholders. An unknown or malformed id surfaces as
 *    the localized not-found denial (the admin surface distinguishes
 *    state, never participants). The read is strictly side-effect free.
 *
 * authScopes (`$all` conjunction, MANDATORY — shared admin prelude):
 *  - `authScopes: adminOnlyAuthScopes` (the canonical
 *    `$all { authenticated: true, role: [UserRole.Admin] }` conjunction).
 *    Anonymous → `UNAUTHORIZED` (401); authenticated non-admin →
 *    `FORBIDDEN` (403) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit.
 *  - Defense in depth: the service re-asserts the governance-clean ADMIN
 *    role from the user row (`assertAdminGovernanceClean`) before reading.
 *
 * Resolver discipline (thin resolvers):
 *  - Identity comes EXCLUSIVELY from the verified context
 *    (`requireAdminUser(ctx)` → `user.id`; never client input).
 *  - NO try/catch, NO business logic — service `DomainError` subclasses
 *    propagate with `extensions.code` and boundary masking; all localized
 *    messaging happens inside the service via `ctx.locale` propagation.
 *  - Zero repository calls; top-level static imports ONLY.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/classes/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  AdminDisputeAnalyticsPothosObject,
  AdminDisputeCasePothosObject,
  StudentDisputeCasePothosObject,
  TeacherDisputeCasePothosObject,
} from "@/backend/graphql/pothos/classes/session-arbitration.pothos";
import { adminOnlyAuthScopes, requireAdminUser } from "@/backend/graphql/shared";
import { coerceDecimalSessionId, requireVerifiedUser } from "@/backend/graphql/shared/resolver-guards";
import { SessionArbitrationService } from "@/backend/services";

// Side-effect: register the `adminDisputeCase` query field.
gqlSchemaBuilder.queryField("adminDisputeCase", t =>
  t.field({
    type: AdminDisputeCasePothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
    },
    description:
      "Read the full dispute case for one session (admin-only): the session row, its report, homework, and recitation records (honest nulls when absent), and the session-scoped audit trail. Unknown or malformed ids are localized not-found denials.",
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // The `$all` scope conjunction guarantees an admin context at
      // resolution time; `requireAdminUser` is the TS-narrowing belt whose
      // translated throw matches the `authenticated` scope's own throw (see
      // file docs + backend/graphql/shared/admin-prelude.ts).
      const user = await requireAdminUser(ctx);
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric (shape-only `Number` parse — every shape decision is the
      // SERVICE's id guard). The service owns the read's shape entirely:
      // the admin belt re-assertion, the concurrent artifact reads, and
      // the honest nulls.
      return SessionArbitrationService.getAdminDisputeCase(user.id, Number(args.id), ctx.locale);
    },
  })
);

// Side-effect: register the `teacherDisputeCase` query field — the
// session's OWN teacher's participant-side case bundle (the dispute
// evidence, never the admin-only audit trail).
gqlSchemaBuilder.queryField("teacherDisputeCase", t =>
  t.field({
    type: TeacherDisputeCasePothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
    },
    description:
      "Read the dispute case for one session as its own teacher (teacher-only): the session row plus the participant-owned artifacts (report, homework, recitation — honest nulls when absent) and the student display name. Non-participants and unknown or malformed ids are indistinguishable localized not-found denials.",
    authScopes: {
      // Explicit `$all` conjunction (plain key-map = ANY semantics — the
      // known-wrong pattern): the scope pins the Teacher ROLE; the service
      // predicate narrows it to THE teacher of THIS session.
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all` conjunction guarantees a verified teacher context at
      // resolution time; `requireVerifiedUser` is the TS-narrowing belt
      // whose translated throw matches the `authenticated` scope's own
      // throw (see backend/graphql/shared/resolver-guards.ts).
      const user = await requireVerifiedUser(ctx);
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric (the shared decimal-shape-only parse — the denial shape
      // belongs to the service boundary, which collapses malformed ids
      // into the same oracle-safe not-found as a non-participant hit).
      return SessionArbitrationService.getTeacherDisputeCase(user.id, coerceDecimalSessionId(args.id), ctx.locale);
    },
  })
);

// Side-effect: register the `studentDisputeCase` query field — the
// session's OWN student's (the filing participant's) participant-side case
// bundle, the exact mirror of the teacher read.
gqlSchemaBuilder.queryField("studentDisputeCase", t =>
  t.field({
    type: StudentDisputeCasePothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
    },
    description:
      "Read the dispute case for one session as its own student (student-only): the session row plus the participant-owned artifacts (report, homework, recitation — honest nulls when absent) and the teacher display name. Non-participants and unknown or malformed ids are indistinguishable localized not-found denials.",
    authScopes: {
      // Explicit `$all` conjunction (plain key-map = ANY semantics — the
      // known-wrong pattern): the scope pins the Student ROLE; the service
      // predicate narrows it to THE student of THIS session.
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all` conjunction guarantees a verified student context at
      // resolution time; `requireVerifiedUser` is the TS-narrowing belt
      // whose translated throw matches the `authenticated` scope's own
      // throw (see backend/graphql/shared/resolver-guards.ts).
      const user = await requireVerifiedUser(ctx);
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric (the shared decimal-shape-only parse — the denial shape
      // belongs to the service boundary, which collapses malformed ids
      // into the same oracle-safe not-found as a non-participant hit).
      return SessionArbitrationService.getStudentDisputeCase(user.id, coerceDecimalSessionId(args.id), ctx.locale);
    },
  })
);

// Side-effect: register the `adminDisputeAnalytics` query field — the
// aggregate dispute snapshot behind the admin queue's analytics card.
gqlSchemaBuilder.queryField("adminDisputeAnalytics", t =>
  t.field({
    type: AdminDisputeAnalyticsPothosObject,
    description:
      "Read the aggregate dispute analytics snapshot (admin-only): the open dispute count (the arbitration queue's own membership), the resolved total, and the per-outcome breakdown across both escrow generations. Honest counts — zero is the legitimate empty state. Strictly side-effect free.",
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, _args, ctx) => {
      // The `$all` scope conjunction guarantees an admin context at
      // resolution time; `requireAdminUser` is the TS-narrowing belt (see
      // the case read above for the full prelude rationale).
      const user = await requireAdminUser(ctx);
      // Zero arguments by design: the snapshot is the unfiltered all-time
      // aggregate, so the wire surface carries nothing to misuse.
      return SessionArbitrationService.getDisputeAnalytics(user.id, ctx.locale);
    },
  })
);
