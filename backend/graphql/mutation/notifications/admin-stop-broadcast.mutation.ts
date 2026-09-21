/**
 * Admin stop-broadcast mutation — `adminStopBroadcast`.
 *
 * Contract:
 *  - `adminStopBroadcast(broadcastId: Int!): Int!`
 *      The one-way `active → stopped` lifecycle transition with
 *      engine-mediated recipient retraction, returning the RETRACTED
 *      notification-row count (0 when the broadcast had no still-present
 *      rows). A nonexistent id rejects localized (`BROADCAST_NOT_FOUND`);
 *      an already-stopped broadcast rejects localized
 *      (`BROADCAST_ALREADY_STOPPED`) — neither writes anything.
 *
 * Scope semantics (the `$all` conjunction is LOAD-BEARING):
 *  - EXACTLY the inline
 *    `{ $all: { authenticated: true, role: [UserRole.Admin] } }`
 *    conjunction — same shape as `adminOnlyAuthScopes`, but inlined so the
 *    audit census drift lock can read the gate statically. Anonymous →
 *    `UNAUTHORIZED` (401 semantics); authenticated non-admin → `FORBIDDEN`
 *    (403 semantics) — both BEFORE the resolver body runs.
 *  - `requireAdminUser(ctx)` is the TypeScript narrowing belt ONLY (the
 *    no-non-null-assertion rule forbids dereferencing the nullable context
 *    directly); its translated `UnauthorizedError` matches the
 *    `authenticated` scope's own throw, so the belt is invisible whenever
 *    the scope did its job.
 *
 * Thin-resolver discipline:
 *  - The body delegates EXCLUSIVELY to `AdminBroadcastService.stopBroadcast`
 *    — no business logic, no repository imports, no direct engine calls (the
 *    engine-mediated retraction lives in the service), no try/catch
 *    boundary masking (service `DomainError` subclasses propagate with
 *    `extensions.code`).
 *  - Identity is derived EXCLUSIVELY from the verified context: the only
 *    actor source is `ctx.user.id` (never an argument) — the service records
 *    it as the stopper and re-verifies it against a real admin row. The
 *    client-supplied `broadcastId` is honored only AFTER the admin gate
 *    passes, and passes the positive-safe-integer guard before any service
 *    call. `ctx.locale` propagates so localized rejections resolve through
 *    the service's translation seam.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — the root field registers at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/notifications/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { requireAdminUser, requirePositiveIntId } from "@/backend/graphql/shared";
import { AdminBroadcastService } from "@/backend/services/notifications/admin-broadcast.service";

// Side-effect: register the `adminStopBroadcast` mutation field.
gqlSchemaBuilder.mutationField("adminStopBroadcast", t =>
  t.field({
    type: "Int",
    description:
      "Stops an active broadcast (one-way active → stopped transition, engine-mediated recipient retraction) and returns the retracted notification count.",
    args: {
      broadcastId: t.arg({ type: "Int", required: true }),
    },
    // Admin-only — the `$all` conjunction makes the authenticated+role pair
    // an AND (ANY semantics is the plain-map default and is the documented
    // wrong answer for an admin surface).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const broadcastId = requirePositiveIntId(args.broadcastId, "broadcastId");
      return AdminBroadcastService.stopBroadcast(broadcastId, user.id, ctx.locale);
    },
  })
);
