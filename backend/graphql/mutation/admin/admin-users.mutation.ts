/**
 * Admin user mutations — `adminCreateUser`, `adminUpdateUser`,
 * `adminSetUserPassword`, `adminSetUserDeleted`.
 *
 * Contract (SDL + the credential surface):
 *  - `adminCreateUser(input: AdminCreateUserInput!): AdminUserDetail!`
 *  - `adminUpdateUser(id: Int!, input: AdminUpdateUserInput!): AdminUserDetail!`
 *  - `adminSetUserPassword(id: Int!, input: AdminSetUserPasswordInput!): AdminUserDetail!`
 *  - `adminSetUserDeleted(id: Int!, deleted: Boolean!): AdminUserDetail!`
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
 *  - Service call with `(…, ctx.user.id, ctx.locale)`.
 *  - Resolvers throw NOTHING directly; service `DomainError` subclasses
 *    propagate with `extensions.code` and boundary masking.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — root fields register at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/admin/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import {
  AdminCreateUserInput,
  AdminSetUserPasswordInput,
  AdminUpdateUserInput,
  AdminUserDetailPothosObject,
} from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { requirePositiveIntId } from "@/backend/graphql/shared";
import { UnauthorizedError } from "@/backend/lib/errors";
import { AdminUserManagementService } from "@/backend/services";

/**
 * Shared preamble for ID-scoped admin user mutations: enforces the
 * authenticated actor and validates the positive-safe-integer `id` arg.
 * Returns the validated target id alongside the actor's user id.
 */
function resolveAdminUserMutationTarget(
  user: { readonly id: number } | null,
  rawId: number
): { id: number; actorId: number } {
  if (!user) {
    throw new UnauthorizedError("Authentication required.");
  }
  return { id: requirePositiveIntId(rawId, "id"), actorId: user.id };
}

// Side-effect: register the `adminCreateUser` mutation field.
gqlSchemaBuilder.mutationField("adminCreateUser", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      input: t.arg({ type: AdminCreateUserInput, required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      const actorId = ctx.user.id;
      const { input } = args;
      return AdminUserManagementService.createUser(
        {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          password: input.password,
          gender: input.gender ?? undefined,
          country: input.country,
          role: input.role,
        },
        actorId,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminUpdateUser` mutation field.
gqlSchemaBuilder.mutationField("adminUpdateUser", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
      input: t.arg({ type: AdminUpdateUserInput, required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const { id, actorId } = resolveAdminUserMutationTarget(ctx.user, args.id);
      const { input } = args;
      return AdminUserManagementService.updateUser(
        id,
        {
          fullName: input.fullName ?? undefined,
          phone: input.phone ?? undefined,
          country: input.country ?? undefined,
          gender: input.gender ?? undefined,
          dateOfBirth: input.dateOfBirth ?? undefined,
        },
        actorId,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminSetUserPassword` mutation field.
gqlSchemaBuilder.mutationField("adminSetUserPassword", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
      input: t.arg({ type: AdminSetUserPasswordInput, required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const { id, actorId } = resolveAdminUserMutationTarget(ctx.user, args.id);
      const { input } = args;
      return AdminUserManagementService.setUserPassword(
        id,
        {
          password: input.password,
          mustChangePassword: input.mustChangePassword,
        },
        actorId,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminSetUserDeleted` mutation field.
gqlSchemaBuilder.mutationField("adminSetUserDeleted", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
      deleted: t.arg({ type: "Boolean", required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const { id, actorId } = resolveAdminUserMutationTarget(ctx.user, args.id);
      return AdminUserManagementService.setUserDeleted(id, args.deleted, actorId, ctx.locale);
    },
  })
);
