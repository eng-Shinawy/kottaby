/**
 * Admin directory query-field pagination plumbing — the shared helpers
 * behind the four admin directory root fields (`adminStudents`,
 * `adminTeacherApplicants`, `adminTeachers`, `adminUsers` and their
 * export-all siblings).
 *
 * Extracted (jscpd clone elimination, per `backend/graphql/AGENTS.md`
 * §Pothos Field Factories) from the four `query/admin/*.query.ts` files,
 * which each cloned the identical pagination plumbing:
 *
 *  - `adminDirectoryPaginationArgs` — the `page: Int` + `pageSize: Int`
 *    OPTIONAL root-field args (spread into the field's `args` map after
 *    the domain `filters` arg, preserving the wire order
 *    `filters → page → pageSize`). Concrete-typed over the canonical
 *    builder, so Pothos's arg type machinery stays fully resolved.
 *  - `resolveAdminDirectoryPageBounds` — the positive-safe-integer guard
 *    for the pagination arguments: `page` must be ≥ 1, `pageSize` must be
 *    in `1..100`, both default when absent; rejects with `ValidationError`
 *    (a `DomainError` subclass, so it propagates with `extensions.code`
 *    and boundary masking) BEFORE any service call. The export-all
 *    siblings take NO pagination arguments — the 1000-row bound lives in
 *    the service, not in caller-supplied args.
 *
 * The `ctx.user` narrowing belt is NOT re-declared here — the admin
 * root-field resolvers reuse `requireAdminUser` from
 * `backend/graphql/shared/admin-prelude.ts` (the centralized prelude the
 * other admin root fields already use).
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - This is a shared HELPER module (the `supportedListArgs` convention),
 *    NOT a `.query.ts` file — it registers nothing at import time and is
 *    never barrel-imported; the consuming `*.query.ts` files stay
 *    side-effect modules with no named exports.
 */
import type { QueryFieldBuilder } from "@pothos/core";
import type { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { ValidationError } from "@/backend/lib/errors";

/**
 * The `SchemaTypes` of the canonical `gqlSchemaBuilder` — derived from the
 * instance so helper signatures track the builder's context/defaults/
 * scalars without duplicating the builder's type parameter.
 */
type GqlSchemaTypes = typeof gqlSchemaBuilder extends PothosSchemaTypes.SchemaBuilder<infer Types> ? Types : never;

/**
 * The optional `page: Int` + `pageSize: Int` root-field args shared by the
 * paginated admin directory queries (spread after the domain `filters` arg
 * so the wire order stays `filters → page → pageSize`).
 */
export function adminDirectoryPaginationArgs(t: QueryFieldBuilder<GqlSchemaTypes, GqlSchemaTypes["Root"]>) {
  return {
    page: t.arg({ type: "Int", required: false }),
    pageSize: t.arg({ type: "Int", required: false }),
  };
}

/**
 * Positive-safe-integer guard for pagination arguments. `page` must be ≥ 1;
 * `pageSize` must be in `1..100`. Both default when absent.
 */
export function resolveAdminDirectoryPageBounds(
  page: number | undefined | null,
  pageSize: number | undefined | null
): {
  page: number;
  pageSize: number;
} {
  const resolvedPage = page ?? 1;
  const resolvedPageSize = pageSize ?? 25;
  if (!Number.isInteger(resolvedPage) || resolvedPage < 1) {
    throw new ValidationError("page must be a positive integer");
  }
  if (!Number.isInteger(resolvedPageSize) || resolvedPageSize < 1 || resolvedPageSize > 100) {
    throw new ValidationError("pageSize must be an integer in 1..100");
  }
  return { page: resolvedPage, pageSize: resolvedPageSize };
}
