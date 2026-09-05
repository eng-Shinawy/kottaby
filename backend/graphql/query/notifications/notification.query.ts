/**
 * Notification inbox queries — `myNotifications` + `myUnreadNotificationCount`.
 *
 * Contract:
 *  - `myNotifications(filter: MyNotificationsFilterInput): NotificationListPage!`
 *      One page of the caller's own inbox: the windowed rows, the total
 *      matching count, and whether a further page exists. Identity is derived
 *      EXCLUSIVELY from the verified context (`ctx.user.id`) — the filter
 *      input carries no identity field of any kind, so BOLA probes that
 *      attempt to address a foreign inbox die as GraphQL validation failures
 *      before a resolver ever runs.
 *  - `myUnreadNotificationCount: Int!`
 *      The caller's unread count — the badge read, backed by the
 *      `(user_id, is_read)` composite index.
 *
 * Scope semantics (every authenticated role owns an inbox — no role,
 * permission, or superAdmin scope participates):
 *  - BOTH fields carry EXACTLY `authScopes: { authenticated: true }`. Anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 semantics — explicit throws pass
 *    through builder.ts's unauthorizedError mapping VERBATIM).
 *
 * Thin-resolver discipline:
 *  - Bodies delegate to `NotificationEngine.listMyNotifications` /
 *    `getMyUnreadCount` with `ctx.user.id` + `ctx.locale` — no business logic,
 *    no repository imports, no DataLoader (inbox reads are flat single-table
 *    windows; there is no per-parent N+1 to batch).
 *  - The nullable filter fields are forwarded with the engine's documented
 *    page-window defaults filled in (`limit` 20 / `offset` 0 when absent) —
 *    behaviorally identical to forwarding the nullable Ints as-is, because
 *    the engine applies the same defaults at runtime; bounds validation
 *    belongs to the service boundary either way.
 *  - `ctx.locale` propagates on every call so localized errors resolve
 *    through the service's translation seam.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - This file has NO named exports — the root fields register at import time
 *    via `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/notifications/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { MyNotificationsFilterInput } from "@/backend/graphql/pothos/notifications/notification-filter-input.pothos";
import { NotificationListPagePothosObject } from "@/backend/graphql/pothos/notifications/notification-list-page.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import {
  NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT,
  NotificationEngine,
} from "@/backend/services/notifications/notification-engine.service";

// Side-effect: register the `myNotifications` query field.
gqlSchemaBuilder.queryField("myNotifications", t =>
  t.field({
    type: NotificationListPagePothosObject,
    description:
      "One page of the caller's own inbox — items (newest first), totalCount, hasMore. Optional conjunctive filters (type, isRead) and page window (limit 1..50 default 20, offset default 0).",
    args: {
      filter: t.arg({ type: MyNotificationsFilterInput, required: false }),
    },
    // Requires an authenticated context (UNAUTHORIZED otherwise) — every
    // authenticated role owns an inbox, so no role/permission scope applies.
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // The `authenticated` scope guarantees a verified user row at
      // resolution time (anonymous callers never get past the scope step).
      // This branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly. Unreachable in practice; per the resolver-i18n
      // rule the message flows through ctx.t (its en copy is identical to
      // builder.ts's `authenticated` scope literal).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      const filter = args.filter;
      return NotificationEngine.listMyNotifications(
        ctx.user.id,
        {
          type: filter?.type ?? null,
          isRead: filter?.isRead ?? null,
          limit: filter?.limit ?? NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT,
          offset: filter?.offset ?? 0,
        },
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `myUnreadNotificationCount` query field.
gqlSchemaBuilder.queryField("myUnreadNotificationCount", t =>
  t.field({
    type: "Int",
    description: "The caller's unread notification count — the badge read (0 for an all-read or empty inbox).",
    // Requires an authenticated context (UNAUTHORIZED otherwise) — every
    // authenticated role owns an inbox, so no role/permission scope applies.
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, _args, ctx) => {
      // TypeScript narrowing only — see the `myNotifications` note above.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return NotificationEngine.getMyUnreadCount(ctx.user.id, ctx.locale);
    },
  })
);
