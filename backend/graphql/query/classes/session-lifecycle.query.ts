/**
 * Session lifecycle query resolvers — the participant read surface
 * plus the admin arbitration listing:
 *
 *  - `sessionById(id: ID!): Session` — nullable; the row is returned ONLY to
 *    its student or its teacher. A nonexistent id and a non-participant
 *    caller resolve to the IDENTICAL `null` (oracle-safe — the two cases are
 *    indistinguishable on the wire); `null` is passed through untouched.
 *  - `myStudentSessions(filter, page = 1, pageSize = 25): SessionPage!` —
 *    the acting student's own sessions, newest first, paged.
 *  - `myTeacherSessions(filter, page = 1, pageSize = 25): SessionPage!` —
 *    the acting teacher's own sessions (identical shape over the
 *    owning-teacher predicate).
 *  - `adminDisputedSessions(filter, limit = 25, offset = 0): SessionPage!` —
 *    the admin arbitration work queue: every `disputed` row, newest first,
 *    with the same limit clamps as the participant lists (1..50, default
 *    25). Admin-only; the read takes no caller identity (the role gate is
 *    the scope's job) and never raises localized errors.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7
 * — the explicit `$all` conjunction lesson):
 *  - `sessionById` is authenticated-but-role-agnostic: the participant
 *    predicate is SERVICE-side (a non-participant gets `null`, never an
 *    error — existence is never disclosed cross-participant).
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (the builder's `defaultStrategy`), so ANY authenticated caller would
 *    pass through the first satisfied scope and wrong-role callers would be
 *    granted access. The conjunction is therefore made EXPLICIT with `$all`:
 *    anonymous callers hit the `authenticated` scope's UnauthorizedError
 *    throw (extensions.code UNAUTHORIZED / 401 — explicit throws pass
 *    through builder.ts's unauthorizedError mapping VERBATIM), while
 *    authenticated non-students / non-teachers fail the `role` scope into
 *    the canonical localized ForbiddenError (FORBIDDEN / 403).
 *
 * Resolver bodies are THIN DELEGATION:
 *  - Identity comes EXCLUSIVELY from the verified context (`ctx.user.id`);
 *    the lists take no caller-supplied identity surface of any kind (BOLA).
 *  - Boundary validation (filter vocabulary, page/pageSize bounds) is
 *    FORWARDED to `SessionLifecycleService` — the service normalizes page
 *    bounds pre-DB and echoes the effective values honestly; the resolver
 *    re-validates nothing and carries ZERO business logic.
 *  - Zero repository calls; top-level static imports ONLY (no `await
 *    import(`).
 *  - The reads take NO locale: they never raise localized errors (service
 *    contract); the only resolver-local throw is the
 *    TypeScript-narrowing guard below, whose message mirrors builder.ts's
 *    own `authenticated` scope verbatim.
 *
 * The two role-gated lists share ONE module-scope registration factory
 * (`registerParticipantSessionsField`) per the Pothos field-factory
 * duplication-elimination pattern (`backend/graphql/AGENTS.md` — same
 * shape, different role + service lister); the scope conjunction and the
 * delegation body stay in exactly ONE place, parameterized by the `UserRole`
 * VALUE and the service method. `sessionById` is registered standalone —
 * its nullable payload, `id` argument, and role-agnostic scope are its own.
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/classes/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - `UserRole` is a VALUE import (scope decision input, never a type-only
 *    reference); `SessionListFilterInput` is the canonical backend type the
 *    Pothos input mirrors.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionPagePothosObject, SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { SessionListFilterPothosInput } from "@/backend/graphql/pothos/classes/session-filter-input.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services";
import type { SessionListFilterInput, SessionPageReturnType } from "@/backend/types";

/**
 * The participant-list delegation shape: the acting owner's context id plus
 * the forwarded filter/pagination window. Mirrors
 * `SessionLifecycleService.listMyStudentSessions` /
 * `listMyTeacherSessions` exactly (the trailing optional `tx` stays a
 * service-tier test seam and is deliberately NOT re-exposed here).
 */
type ParticipantSessionsLister = (
  ownerId: number,
  filter: SessionListFilterInput,
  page: number,
  pageSize: number
) => Promise<SessionPageReturnType>;

/**
 * Registers ONE role-gated participant session-list query field — the
 * shared shape behind `myStudentSessions` and `myTeacherSessions`.
 *
 * The authScopes conjunction is built HERE and only here, so the explicit
 * `$all { authenticated, role }` semantics can never drift apart between
 * the two registrations (a plain key-map would be ANY semantics — a
 * known-wrong pattern). Delegation is the resolver's ONLY behavior:
 * identity is ctx-derived, the absent filter arg becomes the empty filter
 * (both members drop out at the service guard — filters never error), and
 * the `??` restores the declared SDL defaults when a client sends an
 * EXPLICIT `null` (GraphQL field defaults do not apply to explicit nulls);
 * every boundary decision (vocabulary, page bounds) is the service's.
 *
 * @param fieldName  The root field name (`myStudentSessions` |
 *     `myTeacherSessions`).
 * @param role  The single role admitted through the scope gate.
 * @param lister  The `SessionLifecycleService` list method this field
 *     delegates to (owner-side predicate selection happens there).
 */
function registerParticipantSessionsField(
  fieldName: "myStudentSessions" | "myTeacherSessions",
  role: UserRole,
  lister: ParticipantSessionsLister
): void {
  gqlSchemaBuilder.queryField(fieldName, t =>
    t.field({
      type: SessionPagePothosObject,
      args: {
        filter: t.arg({ type: SessionListFilterPothosInput, required: false }),
        // SDL defaults (`page: Int = 1`, `pageSize: Int = 25`);
        // the service re-normalizes the effective bounds pre-DB and echoes
        // them honestly — the resolver forwards, never clamps.
        page: t.arg.int({ required: false, defaultValue: 1 }),
        pageSize: t.arg.int({ required: false, defaultValue: 25 }),
      },
      // Explicit `$all` conjunction per the 401/403 split documented in the
      // file header (plain key-map = ANY semantics — known-wrong pattern).
      authScopes: {
        $all: {
          authenticated: true,
          role: [role],
        },
      },
      resolve: async (_root, args, ctx) => {
        // The `$all { authenticated: true }` leg guarantees a verified user
        // row at resolution time (anonymous callers never get past the
        // scope step). This branch exists purely for TypeScript narrowing —
        // the repo-wide no-non-null-assertion rule forbids dereferencing
        // the nullable context directly; the thrown message mirrors
        // builder.ts's own `authenticated` scope verbatim and is
        // unreachable in practice.
        if (!ctx.user) {
          throw new UnauthorizedError("Authentication required.");
        }
        const filter: SessionListFilterInput = args.filter ?? {};
        return lister(ctx.user.id, filter, args.page ?? 1, args.pageSize ?? 25);
      },
    })
  );
}

// Side-effect: register the `sessionById` query field.
gqlSchemaBuilder.queryField("sessionById", t =>
  t.field({
    type: SessionPothosObject,
    // Nullable payload — `null` answers BOTH "nonexistent id" and
    // "non-participant caller" with ONE indistinguishable null (oracle-safe).
    // The service guarantees the constant shape.
    nullable: true,
    args: {
      id: t.arg.id({ required: true }),
    },
    // Authenticated but role-agnostic: both participants (student AND
    // teacher) must reach the field; the participant predicate lives
    // service-side. Anonymous callers get the `authenticated`
    // scope's UNAUTHORIZED (401) before the resolver ever runs.
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // The `authenticated` scope guarantees a verified user row at
      // resolution time (anonymous callers never get past the scope step).
      // This branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly; the thrown message mirrors builder.ts's own
      // `authenticated` scope verbatim and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric. The conversion is a pure scalar coercion — every shape
      // decision is the SERVICE's: the positive-safe-integer id guard
      // answers a malformed id with the oracle-safe `null` pre-DB,
      // and the parameterized lookup answers existence and participation.
      return SessionLifecycleService.getSessionById(ctx.user.id, Number(args.id));
    },
  })
);

// Side-effect: register the `myStudentSessions` query field — the student
// role over the owning-student predicate.
registerParticipantSessionsField("myStudentSessions", UserRole.Student, (ownerId, filter, page, pageSize) =>
  SessionLifecycleService.listMyStudentSessions(ownerId, filter, page, pageSize)
);

// Side-effect: register the `myTeacherSessions` query field — the teacher
// role over the owning-teacher predicate.
registerParticipantSessionsField("myTeacherSessions", UserRole.Teacher, (ownerId, filter, page, pageSize) =>
  SessionLifecycleService.listMyTeacherSessions(ownerId, filter, page, pageSize)
);

// Side-effect: register the `adminDisputedSessions` query field — the admin
// arbitration listing over the pinned `disputed` scope.
gqlSchemaBuilder.queryField("adminDisputedSessions", t =>
  t.field({
    type: SessionPagePothosObject,
    args: {
      filter: t.arg({ type: SessionListFilterPothosInput, required: false }),
      // SDL defaults per the shared clamps (`limit: Int = 25`,
      // `offset: Int = 0`); the service re-normalizes the effective window
      // pre-DB and echoes it honestly — the resolver forwards, never
      // clamps.
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    // Explicit `$all` conjunction per the 401/403 split documented in the
    // file header (plain key-map = ANY semantics — known-wrong pattern):
    // anonymous callers hit UNAUTHORIZED (401), authenticated non-admins
    // fail the `role` leg into the canonical localized FORBIDDEN (403).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all { authenticated: true }` leg guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — see
      // the participant factory above for the full rationale.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // The absent filter arg becomes the empty filter (both members drop
      // out at the service guard — filters never error); the absent
      // limit/offset restore the declared SDL defaults for an EXPLICIT
      // `null`, and the service owns every clamp. The read takes NO caller
      // identity: the pinned `disputed` scope needs none.
      const filter: SessionListFilterInput = args.filter ?? {};
      return SessionLifecycleService.listAdminDisputedSessions(filter, args.limit ?? 25, args.offset ?? 0);
    },
  })
);
