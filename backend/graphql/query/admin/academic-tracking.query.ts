/**
 * Admin academic tracking queries — `adminAcademicDashboard` (the paged
 * all-students academic directory: per-student latest Jadid/Madi positions,
 * grade summaries, progress counts, per-row attention flags, plus one
 * aggregate stats block) + `adminStudentAcademicDetail` (one student's
 * composite academic record: homework page + reports page + progress row
 * count + attention flag, with the student echo carrying the soft-delete
 * governance marker).
 *
 * authScopes (`adminOnlyAuthScopes` — the `$all` conjunction, MANDATORY):
 *  - `authScopes: adminOnlyAuthScopes` from the shared prelude
 *    (`backend/graphql/shared/admin-prelude.ts`) — the explicit
 *    `{ $all: { authenticated: true, role: [UserRole.Admin] } }`.
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin →
 *    `FORBIDDEN` (403) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated, role }` key map is WRONG: Pothos combines
 *    scope keys with ANY semantics unless `$all` makes the conjunction
 *    explicit.
 *
 * Resolver discipline (thin resolvers):
 *  - `requireAdminUser(ctx)` belt for TypeScript narrowing only (the
 *    repo-wide no-non-null-assertion rule forbids dereferencing the
 *    nullable context directly); the translated `UnauthorizedError`
 *    matches the `authenticated` scope's own throw so the belt is
 *    invisible when the scope did its job.
 *  - The resolver passes ONLY `ctx.user.id` (never a client-supplied
 *    actor id) + the typed args + `ctx.locale` to the service — the
 *    service re-gates (defense-in-depth), validates the page/pageSize
 *    bounds and the `studentId` shape pre-read, and owns the
 *    governed-admin denials (deleted/blocked/suspended) plus the
 *    drill-down's localized unknown-student denial.
 *  - NO try/catch, NO business logic, NO clamping — service `DomainError`
 *    subclasses propagate uncaught with `extensions.code` and boundary
 *    masking (`finalizeGraphqlErrors`).
 *
 * READ-ONLY guarantee: neither resolver writes ANYTHING — no mutation, no
 * audit row, no cache write; executing them leaves the database
 * byte-identical.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/admin/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */
import {
  AdminAcademicDashboardPagePothosObject,
  AdminStudentAcademicDetailPothosObject,
} from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { adminOnlyAuthScopes, requireAdminUser } from "@/backend/graphql/shared";
import { AdminAcademicTrackingService } from "@/backend/services";

// Side-effect: register the `adminAcademicDashboard` paged directory query field.
gqlSchemaBuilder.queryField("adminAcademicDashboard", t =>
  t.field({
    type: AdminAcademicDashboardPagePothosObject,
    args: {
      // SDL defaults (`page: Int = 1`, `pageSize: Int = 25`); the service
      // re-normalizes the effective bounds pre-DB (positive integer /
      // 1..100) and echoes them honestly — the resolver forwards, never
      // clamps. The `??` restores the declared defaults when a client
      // sends an EXPLICIT `null` (GraphQL field defaults do not apply to
      // explicit nulls).
      page: t.arg.int({ required: false, defaultValue: 1 }),
      pageSize: t.arg.int({ required: false, defaultValue: 25 }),
      // Optional case-insensitive name/email filter — forwarded verbatim
      // (null when absent); the service pre-escapes LIKE wildcards, so
      // client-supplied `%`/`_` can never widen the match.
      search: t.arg({ type: "String", required: false }),
    },
    description:
      "Admin-only paged academic directory over every active student: latest Jadid/Madi positions, grade summaries, progress row counts, per-row needs-attention flags, and one platform-wide stats block. Out-of-range pages return empty items next to the honest total; governed admins are denied at the service tier.",
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // The `$all` scope conjunction guarantees an admin context at
      // resolution time; `requireAdminUser` is the TS-narrowing belt whose
      // translated UnauthorizedError matches the `authenticated` scope's
      // own throw (unreachable in practice — see file docs).
      const user = await requireAdminUser(ctx);
      // Field-by-field filter whitelist — the filter transport shape is
      // EXACTLY the optional `search` member; no arg spreads.
      return AdminAcademicTrackingService.getAcademicDashboard(
        user.id,
        { search: args.search ?? null },
        args.page ?? 1,
        args.pageSize ?? 25,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminStudentAcademicDetail` drill-down query field.
gqlSchemaBuilder.queryField("adminStudentAcademicDetail", t =>
  t.field({
    type: AdminStudentAcademicDetailPothosObject,
    args: {
      // The surface's ONLY data-scoping argument — mirrors the
      // parent-monitoring `t.arg.int({ required: true })` precedent. The
      // service validates the positive-integer shape pre-read; a missing
      // or non-student id denies with ONE bounded localized not-found
      // log + error (never an existence oracle to non-admins, who never
      // get past the role scope).
      studentId: t.arg.int({ required: true }),
      // Same SDL defaults + explicit-null restoration as the dashboard.
      page: t.arg.int({ required: false, defaultValue: 1 }),
      pageSize: t.arg.int({ required: false, defaultValue: 25 }),
    },
    description:
      "Admin-only composite academic record for one student: the student echo (with the soft-delete governance marker), the newest-first homework page, the newest-first reports page, the progress row count, and the needs-attention flag. Soft-deleted students remain viewable for audit; unknown ids deny with a localized not-found error.",
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the dashboard note above.
      const user = await requireAdminUser(ctx);
      return AdminAcademicTrackingService.getStudentAcademicDetail(
        user.id,
        args.studentId,
        args.page ?? 1,
        args.pageSize ?? 25,
        ctx.locale
      );
    },
  })
);
