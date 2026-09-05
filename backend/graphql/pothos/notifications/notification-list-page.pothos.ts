/**
 * NotificationListPagePothosObject — the pagination wrapper for inbox reads.
 *
 * Wrapper-type exception (`backend/graphql/AGENTS.md` Single Canonical Object
 * Type Pattern — "Wrapper types for collections or complex responses"):
 *  - Backed EXCLUSIVELY by the canonical {@link NotificationListPageReturnType}
 *    from `@/backend/types` — no local type definitions here.
 *  - `items` — the page's rows exposed through the single canonical
 *    {@link NotificationPothosObject}; every row carries `id`, so Apollo
 *    cache normalization works on the list contents.
 *  - `totalCount` — total number of matching rows (pagination math).
 *  - `hasMore` — whether a further page exists beyond this window.
 *
 * NO `id` field BY DESIGN: like `HealthCheck`, this is an embedded value
 * object, not an entity — the pairing consumer policy is `keyFields: false`
 * in the Apollo cache. The rows inside `items` are the normalizable
 * entities.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { NotificationPothosObject } from "@/backend/graphql/pothos/notifications/notification.pothos";
import type { NotificationListPageReturnType } from "@/backend/types";

/** The canonical `NotificationListPage` pagination wrapper object. */
export const NotificationListPagePothosObject = gqlSchemaBuilder
  .objectRef<NotificationListPageReturnType>("NotificationListPage")
  .implement({
    fields: t => ({
      items: t.expose("items", { type: [NotificationPothosObject] }),
      totalCount: t.exposeInt("totalCount"),
      hasMore: t.exposeBoolean("hasMore"),
    }),
  });
