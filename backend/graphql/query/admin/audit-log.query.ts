/**
 * Audit-trail query — `adminAuditLogs` (DEV3-020 Phase 1).
 *
 *  - `adminAuditLogs(...): AdminAuditLogConnection!` — the immutable trail
 *    behind the admin viewer: filtered (actor id, action type, entity type,
 *    entity id, created-at range) and paginated (limit/offset, service-
 *    clamped to 1..100). The page carries its own `total` + the `limit`/
 *    `offset` that shaped it, so the client footer never re-derives state.
 *
 *  - The `actionType` filter is caller-supplied as a String and narrowed
 *    against the sanctioned `audit_action_type` set via `find` (the same
 *    narrowing idiom as the verification flow's offline-payment method) —
 *    anything else rejects with the localized invalid-filter validation
 *    copy BEFORE the read opens.
 *
 *  - Read-only by construction: there is deliberately NO mutation field in
 *    this domain. Audit rows are append-only by database trigger; the only
 *    writer is `AuditLogService.recordAdminAction` from inside the audited
 *    action's own transaction.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7
 * and documented in `query/teachers/applicant.query.ts` and
 * `mutation/plan-catalog.mutation.ts`):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`). The conjunction is therefore made
 *    EXPLICIT with `$all`: anonymous callers hit the `authenticated`
 *    scope's UnauthorizedError throw (extensions.code UNAUTHORIZED / 401),
 *    while authenticated non-admins fail the `role` scope into the
 *    canonical localized ForbiddenError (FORBIDDEN / 403).
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/admin/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer (backend/graphql/AGENTS.md);
 *    zero business logic beyond the argument narrowing below, zero
 *    repository imports.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdminAuditLogConnectionPothosObject } from "@/backend/graphql/pothos/audit/audit-log.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { DateTimePothosScalar } from "@/backend/graphql/pothos/shared/datetime.pothos";
import { UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { AuditLogService } from "@/backend/services";
import type { AuditLogSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The verification trail's gate: admins only. */
const ADMIN_ROLE = [UserRole.Admin];

/**
 * The sanctioned `audit_action_type` values (mirrors the pgEnum in
 * `backend/db/schema/enums.ts` — the DB owns the constraint; this set owns
 * the wire-level filter narrowing).
 */
const AUDIT_ACTION_TYPES = ["create", "update", "delete", "override", "adjust", "suspend", "reactivate"] as const;

/**
 * Narrows the caller-supplied action filter to the sanctioned enum set.
 * Anything else cannot match a persisted row's action_type column, so it
 * rejects before the read rather than silently returning an empty page.
 */
function parseActionTypeFilter(actionType: string, locale: string): AuditLogSelectType["actionType"] {
  // `find` narrows the matched element to the typed array's element union —
  // a plain `includes` check would leave `actionType` as `string`.
  const match = AUDIT_ACTION_TYPES.find(candidate => candidate === actionType);
  if (!match) {
    throw new ValidationError(getServerTranslations(locale).errorsTranslations.auditActionTypeInvalid);
  }
  return match;
}

// Side-effect: register the `adminAuditLogs` admin-gated query field.
gqlSchemaBuilder.queryField("adminAuditLogs", t =>
  t.field({
    type: AdminAuditLogConnectionPothosObject,
    nullable: false,
    args: {
      actorId: t.arg.int({ required: false }),
      actionType: t.arg.string({ required: false }),
      entityType: t.arg.string({ required: false }),
      entityId: t.arg.int({ required: false }),
      createdFrom: t.arg({ type: DateTimePothosScalar, required: false }),
      createdTo: t.arg({ type: DateTimePothosScalar, required: false }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    // Explicit `$all` conjunction — admins only (same 401/403 split).
    authScopes: {
      $all: {
        authenticated: true,
        role: ADMIN_ROLE,
      },
    },
    resolve: async (_root, args, ctx) => {
      // TS narrowing only — unreachable behind `$all { authenticated: true }`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return AuditLogService.listAuditTrail({
        actorId: args.actorId ?? undefined,
        actionType:
          args.actionType !== undefined && args.actionType !== null
            ? parseActionTypeFilter(args.actionType, ctx.locale)
            : undefined,
        entityType: args.entityType ?? undefined,
        entityId: args.entityId ?? undefined,
        createdFrom: args.createdFrom ?? undefined,
        createdTo: args.createdTo ?? undefined,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      });
    },
  })
);
