import { InMemoryCache } from "@apollo/client";

/**
 * Apollo cache with type policies for paginated / filtered list results.
 *
 * `AdminDashboardScheduleResult.rows` must replace (not merge) on write:
 * filter/pagination changes legitimately return different arrays, including empty ones.
 * Without `merge: false`, Apollo warns that cache data may be lost.
 *
 * `OnlineMeetingInfo`, `AdminNoteInfo`, `HealthCheck`, `NotificationListPage`,
 * `HandshakeCodeLookup` and `AdminAuditLogPage` are embedded value types with
 * no `id` field (see `frontend/graphql/generated/schema.graphql`).
 * Marking them `keyFields: false` opts them out of normalization so Apollo
 * does not emit "Cache data may be lost" warnings when these types are written
 * to the cache via different parent objects. They are always read back through
 * their enclosing parent (e.g. a `Session`, an `AdminNote` owner or a future
 * `_health` document), so identifying them by their own fields is unnecessary
 * (`HealthCheck` is the scalar-only probe object exposed by the `_health`
 * gateway query; `NotificationListPage` is the notifications inbox pagination
 * wrapper whose normalizable entities are the `Notification` rows inside
 * `items`; `HandshakeCodeLookup` is the masked parent-discovery payload —
 * `maskedName` + `linkable` only — and must NEVER be keyed by
 * identity-derived values).
 *
 * `AdminAuditLogPage` is the admin audit-trail pagination wrapper (same
 * shape discipline as `NotificationListPage`): the normalizable entities are
 * the `AdminAuditLogEntry` rows inside `items` (each carries `id`), so the
 * wrapper itself never needs an identity.
 */
export function createApolloCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: {
      AdminDashboardScheduleResult: {
        fields: {
          rows: {
            merge: false,
          },
        },
      },
      AdminNoteInfo: {
        keyFields: false,
      },
      // Embedded scalar-only value object (no `id`) — normalize-safe from day
      // one so any future consumer of `_health` cannot trigger cache-data-loss
      // warnings (frontend/graphql/AGENTS.md embedded-type policy).
      HealthCheck: {
        keyFields: false,
      },
      // Embedded pagination-wrapper value object (no `id`) for the
      // notifications inbox — the normalizable entities are the `Notification`
      // rows inside `items`, so the wrapper itself never needs an identity.
      NotificationListPage: {
        keyFields: false,
      },
      // Embedded masked parent-discovery value object (no `id` by design) —
      // cached inline under its parent query field, never normalized into a
      // standalone (identity-derived) cache key.
      HandshakeCodeLookup: {
        keyFields: false,
      },
      // Embedded pagination-wrapper value object (no `id`) for the admin
      // audit trail — the normalizable entities are the `AdminAuditLogEntry`
      // rows inside `items`, so the wrapper itself never needs an identity.
      AdminAuditLogPage: {
        keyFields: false,
      },
      OnlineMeetingInfo: {
        keyFields: false,
      },
    },
  });
}
