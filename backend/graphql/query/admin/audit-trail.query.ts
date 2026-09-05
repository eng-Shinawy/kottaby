/**
 * Audit-trail query — `adminAuditLogs`, the global read surface over the
 * append-only `audit_logs` table (newest-first paginated trail).
 *
 * Contract:
 *  - `adminAuditLogs(filters: AdminAuditLogFiltersInput, page: Int, pageSize: Int): AdminAuditLogPage!`
 *  - Optional ANDed filters (actor / entity / action kind / time window);
 *    page bounds + filter validation are owned by the service boundary, the
 *    resolver merely forwards what arrived (honest envelope echo — the
 *    resolved pagination values come back verbatim).
 *
 * authScopes (`$all` conjunction, MANDATORY):
 *  - `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN`
 *    (403) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit.
 *
 * Resolver discipline (thin resolvers):
 *  - `ctx.user` belt for TypeScript narrowing only (the repo-wide
 *    no-non-null-assertion rule forbids dereferencing the nullable context
 *    directly); the translated `UnauthorizedError` matches the
 *    `authenticated` scope's own throw so the belt is invisible when the
 *    scope did its job.
 *  - Filter args are copied FIELD-BY-FIELD into the service's closed
 *    submit-input whitelist — NO `{ ...input }` spread. The input type is
 *    the schema's BOPLA boundary: smuggled fields die at GraphQL validation
 *    before a resolver runs, and only the six whitelisted members cross.
 *  - Delegates to `AuditTrailService.listAuditTrail` with
 *    `(…, ctx.user.id, ctx.locale)`; NO try/catch, NO business logic —
 *    service `DomainError` subclasses propagate with `extensions.code` and
 *    boundary masking.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/admin/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdminAuditLogFiltersInput, AdminAuditLogPagePothosObject } from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { AuditTrailService } from "@/backend/services";

// Side-effect: register the `adminAuditLogs` global trail query field.
gqlSchemaBuilder.queryField("adminAuditLogs", t =>
  t.field({
    type: AdminAuditLogPagePothosObject,
    args: {
      filters: t.arg({ type: AdminAuditLogFiltersInput, required: false }),
      page: t.arg({ type: "Int", required: false }),
      pageSize: t.arg({ type: "Int", required: false }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all` scope conjunction guarantees an admin context at
      // resolution time; this branch exists purely for TypeScript narrowing
      // (see file docs).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // Closed-input whitelist copy — exactly the six service-recognized
      // filter members, never a spread of the wire input.
      return AuditTrailService.listAuditTrail(
        {
          actorId: args.filters?.actorId ?? null,
          actionType: args.filters?.actionType ?? null,
          entityType: args.filters?.entityType ?? null,
          entityId: args.filters?.entityId ?? null,
          from: args.filters?.from ?? null,
          to: args.filters?.to ?? null,
        },
        args.page ?? null,
        args.pageSize ?? null,
        ctx.locale,
        ctx.user.id
      );
    },
  })
);
