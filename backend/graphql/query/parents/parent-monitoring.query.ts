/**
 * Parent-monitoring portal queries — the seven parent-only read surfaces.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/parents/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (`backend/graphql/AGENTS.md`); no business logic inline.
 *
 * The seven fields back the parent dashboard's monitoring surfaces:
 *  - `myLinkedChildren` — the caller's confirmed-linked children, oldest
 *    first, soft-deleted children excluded. Zero-argument: identity is
 *    derived EXCLUSIVELY from the verified context (`ctx.user.id`). The
 *    only BOLA surface is "the caller's own list" — there is no
 *    caller-supplied lookup surface of any kind (probes that attempt to
 *    address a foreign id die as GraphQL validation failures before a
 *    resolver ever runs).
 *  - `parentChildProgress(studentId: Int!)` — the gated child header
 *    echo plus the honest progress row count plus the latest
 *    Jadid/Madi positions, in ONE payload (the detail header and the
 *    progress tab are served together — fewer authorization seams).
 *  - `parentChildSessions(studentId: Int!, page: Int, pageSize: Int)` —
 *    derived attendance entries (session rows), paged newest-first.
 *  - `parentChildReports(studentId: Int!, page: Int, pageSize: Int)` —
 *    per-session report rows (teacher notes + rating, joined to the
 *    owning session for status/timestamp context), paged
 *    newest-session-first.
 *  - `parentChildHomework(studentId: Int!, page: Int, pageSize: Int)` —
 *    homework rows with the two parallel Jadid/Madi track blocks, paged
 *    newest-session-first.
 *  - `parentSessionTarget(sessionId: Int!)` — the closed `{ sessionId,
 *    studentId }` pair resolving one completion-notification session
 *    pointer onto the LINKED child who owns it (the deep-link landing
 *    read). The only caller-supplied identity on the field is the
 *    session id from the notification row's pointer; a missing or
 *    foreign session collapses to the same constant denial — existence
 *    non-disclosure for session-id probing.
 *  - `myChildrenUpcomingSessions` — one glance block per linked child
 *    (child echo + scheduled-session glance window + honest scheduled
 *    total), the parent dashboard's "What's next" card read.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth):
 *  - Every field carries the EXPLICIT `$all` conjunction (the proven
 *    pattern at `query/parents/parent-link.query.ts` and
 *    `query/classes/session-lifecycle.query.ts`). A plain scope map
 *    would combine its keys with ANY semantics and leak access — the
 *    conjunction is load-bearing.
 *  - Anonymous callers hit the `authenticated` scope's UnauthorizedError
 *    throw (extensions.code UNAUTHORIZED / 401 — explicit scope throws
 *    pass through `builder.ts`'s `unauthorizedError` mapping VERBATIM).
 *  - Authenticated callers with a wrong role (admin, teacher, student)
 *    fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403, mapped at `builder.ts:111-121`).
 *    The portal is parent-private; admins do NOT receive portal access
 *    (admin analytics have their own surfaces).
 *
 * Identity discipline:
 *  - The parent identity on every resolver is `ctx.user.id` — NEVER a
 *    client-supplied parent id. The only caller-supplied identity on
 *    per-student fields is `args.studentId`, which is gated by
 *    `requireLinkedChild` inside the SAME transaction as the data reads
 *    (the TOCTOU seal — a severance that lands mid-flight cannot extend
 *    a returned payload). The gate produces a CONSTANT denial shape
 *    across every cause (missing / foreign / never-linked / severed /
 *    malformed id — the caller cannot distinguish the cause; oracle
 *    posture).
 *  - The wire inputs forwarded to the service are an EXPLICIT closed
 *    whitelist (`{ page: args.page ?? undefined, pageSize: args.pageSize
 *    ?? undefined }`) — never a spread of `args`. The resolver re-
 *    validates nothing and carries ZERO business logic.
 *
 * Read-only posture:
 *  - This file registers QUERY fields ONLY. Zero mutation fields of any
 *    kind. Parents retain their legitimate link-request mutations
 *    (`requestParentChildLink`, `cancelParentLinkRequest`) — the
 *    portal's read-only discipline is enforced by the absence of a
 *    portal mutation surface here, not by a global write veto.
 *
 * DomainErrors thrown deeper (the service's fresh actor re-check and
 * `requireLinkedChild` gate denials) propagate uncaught to the masking
 * boundary — NO try/catch here by contract (the boundary finalizer owns
 * masking + the single correlated log line). All imports are top-level
 * STATIC imports (Bun ESM rule — dynamic import expressions in resolver
 * trees are prohibited and fail the gateway's static-assertions gate).
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  ParentAttendancePagePothosObject,
  ParentChildProgressPothosObject,
  ParentChildUpcomingBlockPothosObject,
  ParentHomeworkPagePothosObject,
  ParentLinkedChildPothosObject,
  ParentReportPagePothosObject,
  ParentSessionTargetPothosObject,
} from "@/backend/graphql/pothos/parents/parent-monitoring.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { ParentMonitoringService } from "@/backend/services";

// The portal's field-level authorization conjunction — built once and
// referenced by every field so the explicit `$all { authenticated, role }`
// semantics can never drift between registrations. A plain key-map would
// combine its keys with ANY semantics in @pothos/plugin-scope-auth's
// default strategy — the conjunction is load-bearing (401 for anonymous,
// 403 for authenticated wrong-role). `UserRole` is a VALUE import here
// because it is referenced in this runtime scope expression. The object
// is declared without `as const` so Pothos's `AuthScopes` type slot
// accepts the `role` member as `UserRole[]` (a readonly tuple would
// widen to `readonly [UserRole.Parent]` and fail the field-scope
// assignment).
const parentOnlyAuthScopes: { $all: { authenticated: true; role: UserRole[] } } = {
  $all: {
    authenticated: true,
    role: [UserRole.Parent],
  },
};

// Side-effect: register the `myLinkedChildren` query field.
gqlSchemaBuilder.queryField("myLinkedChildren", t =>
  t.field({
    type: [ParentLinkedChildPothosObject],
    description:
      "The caller's confirmed-linked children, oldest first. Soft-deleted children are excluded; a child whose account is severed vanishes from the list on the next read. Zero arguments — identity is derived exclusively from the verified context.",
    authScopes: parentOnlyAuthScopes,
    resolve: async (_root, _args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified
      // user row at resolution time (anonymous callers never get past
      // the scope step). This branch exists purely for TypeScript
      // narrowing — the repo-wide no-non-null-assertion rule forbids
      // dereferencing the nullable context directly. Unreachable in
      // practice; per the resolver-i18n rule the message flows through
      // ctx.t (its en copy is identical to builder.ts's `authenticated`
      // scope literal).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentMonitoringService.listLinkedChildren(ctx.user.id, ctx.locale);
    },
  })
);

// Side-effect: register the `parentChildProgress` query field.
gqlSchemaBuilder.queryField("parentChildProgress", t =>
  t.field({
    type: ParentChildProgressPothosObject,
    args: {
      studentId: t.arg.int({ required: true }),
    },
    description:
      "The gated child header echo plus the honest progress row count and the latest Jadid/Madi curriculum positions, in one payload. The link grant is verified inside the same transaction as the reads; a missing, foreign, never-linked, severed, or malformed student id collapses to the same constant denial.",
    authScopes: parentOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the `myLinkedChildren` note.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentMonitoringService.getChildProgress(ctx.user.id, args.studentId, ctx.locale);
    },
  })
);

// Side-effect: register the `parentChildSessions` query field.
gqlSchemaBuilder.queryField("parentChildSessions", t =>
  t.field({
    type: ParentAttendancePagePothosObject,
    args: {
      studentId: t.arg.int({ required: true }),
      page: t.arg.int(),
      pageSize: t.arg.int(),
    },
    description:
      "The gated child's derived attendance entries (session rows), newest first, paged. Pagination is normalized before the database read and the effective values are echoed in the page payload; an out-of-range page yields empty items next to the true total count.",
    authScopes: parentOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the `myLinkedChildren` note.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // Closed whitelist of forwarded inputs — never a spread of `args`.
      // The service normalizes page bounds pre-DB and echoes the
      // effective values honestly; the resolver re-validates nothing.
      return ParentMonitoringService.listChildSessions(
        ctx.user.id,
        args.studentId,
        { page: args.page ?? undefined, pageSize: args.pageSize ?? undefined },
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `parentChildReports` query field.
gqlSchemaBuilder.queryField("parentChildReports", t =>
  t.field({
    type: ParentReportPagePothosObject,
    args: {
      studentId: t.arg.int({ required: true }),
      page: t.arg.int(),
      pageSize: t.arg.int(),
    },
    description:
      "The gated child's per-session report rows (teacher notes + rating, joined to the owning session for status/timestamp context), newest-session-first, paged. The honest total + page window shape mirrors the attendance list; an out-of-range page yields empty items next to the true total count.",
    authScopes: parentOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the `myLinkedChildren` note.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentMonitoringService.listChildReports(
        ctx.user.id,
        args.studentId,
        { page: args.page ?? undefined, pageSize: args.pageSize ?? undefined },
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `parentChildHomework` query field.
gqlSchemaBuilder.queryField("parentChildHomework", t =>
  t.field({
    type: ParentHomeworkPagePothosObject,
    args: {
      studentId: t.arg.int({ required: true }),
      page: t.arg.int(),
      pageSize: t.arg.int(),
    },
    description:
      "The gated child's homework rows (each carrying the two parallel Jadid/Madi track blocks), newest-session-first, paged. Track block composition preserves per-field nullability — a null grade stays null, a fully-null track block collapses to null, never fabricated zeros.",
    authScopes: parentOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the `myLinkedChildren` note.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentMonitoringService.listChildHomework(
        ctx.user.id,
        args.studentId,
        { page: args.page ?? undefined, pageSize: args.pageSize ?? undefined },
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `myChildrenUpcomingSessions` query field.
gqlSchemaBuilder.queryField("myChildrenUpcomingSessions", t =>
  t.field({
    type: [ParentChildUpcomingBlockPothosObject],
    description:
      "One upcoming-sessions glance block per confirmed-linked child: the child echo plus that child's capped scheduled-session window (newest-booked first) plus the honest scheduled total under the same filter. Resolved in one transaction snapshot; a parent with no linked children yields an empty list.",
    authScopes: parentOnlyAuthScopes,
    resolve: async (_root, _args, ctx) => {
      // TypeScript narrowing only — see the `myLinkedChildren` note.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentMonitoringService.listChildrenUpcomingSessions(ctx.user.id, ctx.locale);
    },
  })
);

// Side-effect: register the `parentSessionTarget` query field.
gqlSchemaBuilder.queryField("parentSessionTarget", t =>
  t.field({
    type: ParentSessionTargetPothosObject,
    args: {
      sessionId: t.arg.int({ required: true }),
    },
    description:
      "The closed id pair resolving one completion-notification session pointer: the session id plus the linked child who owns it. A missing or foreign session is indistinguishable on the wire — both collapse to the same constant denial (existence non-disclosure); a non-positive session id is rejected as a validation failure before any gate or read. The deep-link landing route is constructed from the pair alone.",
    authScopes: parentOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the `myLinkedChildren` note.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentMonitoringService.getSessionTarget(ctx.user.id, args.sessionId, ctx.locale);
    },
  })
);
