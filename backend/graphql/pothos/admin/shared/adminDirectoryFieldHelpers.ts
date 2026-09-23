/**
 * Admin directory Pothos field factory — shared field-definition helper for
 * the admin directory row objects (jscpd clone elimination, per
 * `backend/graphql/AGENTS.md` §Pothos Field Factories):
 *
 *  - `adminDirectoryAccountFields` — the resolved governance flags
 *    (`isDeleted` / `suspended` / `isBlocked` — null-coalesced to `false`
 *    at the mapper layer, so plain non-nullable Boolean fields) plus the
 *    `DateTime`-typed `createdAt` exposure. This is the "safe `users`
 *    columns" tail shared verbatim by `AdminTeacherItem` and
 *    `AdminApplicantItem` (both mirror the `AdminUserListItem` projection).
 *
 * The builder is typed against the union of both canonical shapes (per the
 * `adminUserStatsFields` convention in `backend/graphql/pothos/shared/
 * userFieldHelpers.ts`), so both call sites pass their own field builders
 * without a generic indirection — and the helper only resolves shape
 * members that exist identically on both canonical types.
 *
 * This is a shared HELPER module, NOT a `*.pothos.ts` definition file: it
 * declares no GraphQL types itself and is consumed directly by the domain
 * Pothos files (never barrel-imported).
 */
import type { ObjectFieldBuilder } from "@pothos/core";
import type { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { AdminApplicantItemReturnType, AdminTeacherItemReturnType } from "@/backend/types";

/**
 * The `SchemaTypes` of the canonical `gqlSchemaBuilder` — derived from the
 * instance so helper signatures track the builder's context/defaults/
 * scalars without duplicating the builder's type parameter.
 */
type GqlSchemaTypes = typeof gqlSchemaBuilder extends PothosSchemaTypes.SchemaBuilder<infer Types> ? Types : never;

/**
 * The governance-flag + timestamp object fields shared verbatim by the
 * admin directory row objects (`AdminTeacherItem`, `AdminApplicantItem`).
 */
export function adminDirectoryAccountFields(
  t: ObjectFieldBuilder<GqlSchemaTypes, AdminApplicantItemReturnType | AdminTeacherItemReturnType>
) {
  return {
    isDeleted: t.field({ type: "Boolean", resolve: parent => parent.isDeleted }),
    suspended: t.field({ type: "Boolean", resolve: parent => parent.suspended }),
    isBlocked: t.field({ type: "Boolean", resolve: parent => parent.isBlocked }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
  };
}
