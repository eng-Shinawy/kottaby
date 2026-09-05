/**
 * Admin governance mutations — `adminSetUserSuspended` / `adminSetUserBlocked`.
 *
 * Contract (REQ-060 SDL):
 *  - `adminSetUserSuspended(id: Int!, suspended: Boolean!, periodDays: Int): AdminUserDetail!`
 *  - `adminSetUserBlocked(id: Int!, blocked: Boolean!): AdminUserDetail!`
 *
 * authScopes (D10 — `$all` conjunction, MANDATORY):
 *  - `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN`
 *    (403) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit.
 *
 * Resolver discipline (thin resolvers):
 *  - ID arg → positive-safe-integer guard (no `as number`).
 *  - `actorId` sourced EXCLUSIVELY from `ctx.user.id` (never from args —
 *    BOLA-safe by construction).
 *  - `periodDays` is an OPTIONAL GraphQL arg (`Int`, not `Int!`); the
 *    resolver null-coalesces absent → `null` before delegating to the
 *    service. The service validates `periodDays ∈ 1..3650` on the
 *    suspend direction and IGNORES it on the unsuspend direction.
 *  - Scalar args only — smuggled / undeclared fields die as
 *    `GRAPHQL_VALIDATION_FAILED` at the Pothos schema layer before the
 *    resolver ever runs.
 *  - Resolvers throw NOTHING directly except the `ctx.user` narrow guard;
 *    service `DomainError` subclasses propagate with `extensions.code`
 *    and boundary masking through the GraphQL finalizer.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — root fields register at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/admin/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdminUserDetailPothosObject } from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { requirePositiveIntId } from "@/backend/graphql/shared";
import { UnauthorizedError } from "@/backend/lib/errors";
import { AdminUserManagementService } from "@/backend/services";

// Side-effect: register the `adminSetUserSuspended` mutation field.
gqlSchemaBuilder.mutationField("adminSetUserSuspended", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
      suspended: t.arg({ type: "Boolean", required: true }),
      periodDays: t.arg({ type: "Int", required: false }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      return AdminUserManagementService.setUserSuspended(
        requirePositiveIntId(args.id, "id"),
        args.suspended,
        args.periodDays ?? null,
        ctx.user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminSetUserBlocked` mutation field.
gqlSchemaBuilder.mutationField("adminSetUserBlocked", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
      blocked: t.arg({ type: "Boolean", required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      return AdminUserManagementService.setUserBlocked(
        requirePositiveIntId(args.id, "id"),
        args.blocked,
        ctx.user.id,
        ctx.locale
      );
    },
  })
);
