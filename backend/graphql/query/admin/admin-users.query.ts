/**
 * Admin user queries — `adminUsers` (paginated directory) + `adminUserDetail`.
 *
 * Contract (REQ-060 SDL):
 *  - `adminUsers(filters: AdminUserFiltersInput, page: Int, pageSize: Int): AdminUserPage!`
 *  - `adminUserDetail(id: Int!): AdminUserDetail!`
 *
 * authScopes (D10 — `$all` conjunction, MANDATORY):
 *  - `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN`
 *    (403) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit. See `docs/teachers/applicant-lifecycle.md` §3
 *    for the verified pattern.
 *
 * Resolver discipline (thin resolvers):
 *  - ID arg → positive-safe-integer guard (no `as number`).
 *  - The `adminUsers` directory field shares the admin directory
 *    pagination plumbing (optional `page`/`pageSize` args, the
 *    positive-safe-integer guard) via
 *    `query/admin/shared/adminDirectoryPagination.helpers.ts` and its
 *    `ctx.user` belt reuses `requireAdminUser` from
 *    `backend/graphql/shared/admin-prelude.ts` (TS narrowing only — the
 *    translated `UnauthorizedError` matches the `authenticated` scope's
 *    own throw, so the belt is invisible when the scope did its job).
 *  - Service call with `(…, ctx.user.id, ctx.locale)` for mutations; reads
 *    omit `actorId` (the GraphQL authScope already enforces admin-only).
 *  - Resolvers throw NOTHING directly; service `DomainError` subclasses
 *    propagate with `extensions.code` and boundary masking.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/admin/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */
import {
  AdminApplicantCooldownStatsPothosObject,
  AdminUserActivityEntryPothosObject,
  AdminUserCountryBreakdownPothosObject,
  AdminUserDetailPothosObject,
  AdminUserFiltersInput,
  AdminUserPagePothosObject,
  AdminUserStatsPothosObject,
} from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  adminDirectoryPaginationArgs,
  resolveAdminDirectoryPageBounds,
} from "@/backend/graphql/query/admin/shared/adminDirectoryPagination.helpers";
import { adminOnlyAuthScopes, requireAdminUser, requirePositiveIntId } from "@/backend/graphql/shared";
import { UnauthorizedError } from "@/backend/lib/errors";
import { AdminUserManagementService } from "@/backend/services";

// Side-effect: register the `adminUsers` directory query field.
gqlSchemaBuilder.queryField("adminUsers", t =>
  t.field({
    type: AdminUserPagePothosObject,
    args: {
      filters: t.arg({ type: AdminUserFiltersInput, required: false }),
      ...adminDirectoryPaginationArgs(t),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const { page, pageSize } = resolveAdminDirectoryPageBounds(args.page, args.pageSize);
      return AdminUserManagementService.listDirectory(
        {
          role: args.filters?.role ?? null,
          governance: args.filters?.governance ?? null,
          country: args.filters?.country ?? null,
          search: args.filters?.search ?? null,
          applicantStatus: args.filters?.applicantStatus ?? null,
          cooldownState: args.filters?.cooldownState ?? null,
          cooldownExpiringSoon: args.filters?.cooldownExpiringSoon ?? null,
        },
        page,
        pageSize,
        ctx.locale,
        user.id
      );
    },
  })
);

// Side-effect: register the `adminUserStats` overview query field.
gqlSchemaBuilder.queryField("adminUserStats", t =>
  t.field({
    type: AdminUserStatsPothosObject,
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, _args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return AdminUserManagementService.getStats(ctx.locale, ctx.user.id);
    },
  })
);

// Side-effect: register the `adminApplicantCooldownStats` lifecycle query
// field — the admin dashboard panel's data source. Same BFLA posture as
// `adminUserStats` (admin-only auth scope + the service's defense-in-depth
// actor re-check). Deliberately its OWN field (not a widening of
// `adminUserStats`): the lifecycle counters are a different concept with
// their own wire type, and the existing stats consumers stay byte-stable.
gqlSchemaBuilder.queryField("adminApplicantCooldownStats", t =>
  t.field({
    type: AdminApplicantCooldownStatsPothosObject,
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, _args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return AdminUserManagementService.getCooldownLifecycleStats(ctx.locale, ctx.user.id);
    },
  })
);

// Side-effect: register the `adminUserCountryBreakdown` distribution query
// field — the admin directory's "users by country" facet data source.
// Same BFLA posture as its sibling aggregate reads (admin-only auth scope
// + the service's defense-in-depth actor re-check). The optional `limit`
// clamps server-side (1..12, default 6 — clamp-first, never errors) so the
// facet window is a server contract, not a client courtesy.
gqlSchemaBuilder.queryField("adminUserCountryBreakdown", t =>
  t.field({
    type: AdminUserCountryBreakdownPothosObject,
    args: {
      limit: t.arg({ type: "Int", required: false }),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return AdminUserManagementService.getCountryBreakdown(ctx.locale, ctx.user.id, args.limit ?? null);
    },
  })
);

// Side-effect: register the `adminUserDetail` query field.
gqlSchemaBuilder.queryField("adminUserDetail", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      const id = requirePositiveIntId(args.id, "id");
      return AdminUserManagementService.getUserDetail(id, ctx.locale, ctx.user.id);
    },
  })
);

// Side-effect: register the `adminUserActivity` per-user timeline query field.
// Scoped `audit_logs` read-back (actions recorded ABOUT one user — account
// rows plus the user's teacher-applicant lifecycle rows, discriminated by
// the entry's `entityType`, newest-first, limit clamped 1..50 server-side
// with a default of 10).
gqlSchemaBuilder.queryField("adminUserActivity", t =>
  t.field({
    type: [AdminUserActivityEntryPothosObject],
    args: {
      id: t.arg({ type: "Int", required: true }),
      limit: t.arg({ type: "Int", required: false }),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      const id = requirePositiveIntId(args.id, "id");
      return AdminUserManagementService.getUserActivity(id, ctx.locale, ctx.user.id, args.limit ?? null);
    },
  })
);
