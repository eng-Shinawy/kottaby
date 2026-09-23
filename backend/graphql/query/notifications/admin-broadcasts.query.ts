/**
 * Admin broadcast history queries — `adminBroadcasts` (paginated history) +
 * `adminBroadcastDetail`.
 *
 * Contract:
 *  - `adminBroadcasts(filters: AdminBroadcastFiltersInput, page: Int, pageSize: Int): AdminBroadcastPage!`
 *      One page of the broadcast history, newest-first: the windowed header
 *      rows (joined sender/stopper display names included), the honest total
 *      matching count, and the echoed page window. An out-of-range page
 *      yields an empty `items` array with the honest `totalCount` — never an
 *      error. `page` defaults to 1; `pageSize` defaults to 25 and rejects
 *      localized outside `1..100` at the service boundary.
 *  - `adminBroadcastDetail(broadcastId: Int!): AdminBroadcastDetail!`
 *      The detail payload for one broadcast: the header entry plus the live
 *      delivery/read aggregates derived from the broadcast's still-present
 *      notification rows.
 *
 * Scope semantics (the `$all` conjunction is LOAD-BEARING):
 *  - BOTH fields carry EXACTLY `adminOnlyAuthScopes` — the
 *    `{ $all: { authenticated: true, role: [UserRole.Admin] } }` conjunction.
 *    Anonymous → `UNAUTHORIZED` (401 semantics); authenticated non-admin →
 *    `FORBIDDEN` (403 semantics) — both BEFORE the resolver body runs.
 *  - `requireAdminUser(ctx)` is the TypeScript narrowing belt ONLY (the
 *    no-non-null-assertion rule forbids dereferencing the nullable context
 *    directly); its translated `UnauthorizedError` matches the
 *    `authenticated` scope's own throw, so the belt is invisible whenever
 *    the scope did its job.
 *
 * Thin-resolver discipline:
 *  - Bodies delegate EXCLUSIVELY to `AdminBroadcastService.listBroadcasts` /
 *    `broadcastDetail` — no business logic, no repository imports, no direct
 *    engine calls, no try/catch boundary masking (service `DomainError`
 *    subclasses propagate with `extensions.code`).
 *  - Filter mapping is FIELD-BY-FIELD into the canonical
 *    `AdminBroadcastListFilters` shape — never a `{ ...input }` spread, so
 *    no transport-smuggled field can cross the boundary.
 *  - Identity is derived EXCLUSIVELY from the verified context: the only
 *    actor source is `ctx.user.id` (never an argument). The client-supplied
 *    `broadcastId` is honored only AFTER the admin gate passes.
 *  - `broadcastId` passes the positive-safe-integer guard before any
 *    service call; `ctx.locale` propagates so localized rejections resolve
 *    through the service's translation seam.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - This file has NO named exports — the root fields register at import
 *    time via `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/notifications/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  AdminBroadcastDetailPothosObject,
  AdminBroadcastFiltersInput,
  AdminBroadcastPagePothosObject,
} from "@/backend/graphql/pothos/notifications/admin-broadcast-history.pothos";
import { adminOnlyAuthScopes, requireAdminUser, requirePositiveIntId } from "@/backend/graphql/shared";
import { AdminBroadcastService } from "@/backend/services/notifications/admin-broadcast.service";

// Side-effect: register the `adminBroadcasts` history query field.
gqlSchemaBuilder.queryField("adminBroadcasts", t =>
  t.field({
    type: AdminBroadcastPagePothosObject,
    description:
      "One page of the admin broadcast history, newest-first — items, totalCount, page, pageSize. Optional conjunctive filters (titleSearch, status, audienceType); page defaults to 1, pageSize defaults to 25 (values outside 1..100 are rejected).",
    args: {
      filters: t.arg({ type: AdminBroadcastFiltersInput, required: false }),
      page: t.arg({ type: "Int", required: false }),
      pageSize: t.arg({ type: "Int", required: false }),
    },
    // Admin-only — the `$all` conjunction makes the authenticated+role pair
    // an AND (ANY semantics is the plain-map default and is the documented
    // wrong answer for an admin surface).
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      // Field-by-field mapping (never a spread) into the canonical filter
      // shape; the service owns bounds validation (page ≥ 1, pageSize
      // rejected outside 1..100, default 25) and the out-of-range-page contract.
      return AdminBroadcastService.listBroadcasts(
        {
          titleSearch: args.filters?.titleSearch ?? null,
          status: args.filters?.status ?? null,
          audienceType: args.filters?.audienceType ?? null,
        },
        args.page ?? 1,
        args.pageSize ?? undefined,
        user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminBroadcastDetail` query field.
gqlSchemaBuilder.queryField("adminBroadcastDetail", t =>
  t.field({
    type: AdminBroadcastDetailPothosObject,
    description:
      "The detail payload for one broadcast — the header entry plus the live delivered/read counts derived from the broadcast's still-present notification rows.",
    args: {
      broadcastId: t.arg({ type: "Int", required: true }),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const broadcastId = requirePositiveIntId(args.broadcastId, "broadcastId");
      return AdminBroadcastService.broadcastDetail(broadcastId, user.id, ctx.locale);
    },
  })
);
