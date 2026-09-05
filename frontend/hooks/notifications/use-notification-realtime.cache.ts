import type { ApolloCache } from "@apollo/client";
import type { ModifierDetails, StoreObject } from "@apollo/client/cache";
import type { NotificationType } from "@/frontend/graphql/generated/gql/graphql";
import { GRAPHQL_TYPE_NAME_TO_PAYLOAD_TYPE, isRecord } from "@/frontend/hooks/notifications";

/**
 * Apollo-cache merge for realtime notification arrivals: writes the
 * normalized `Notification:{id}` entity and prepends it to every matching
 * page-1 `myNotifications` variant — with NO refetch. See the hook module
 * for the full REQ lifecycle contract.
 */

/** Full normalized `Notification` cache row for a fresh (unread) arrival.
 * `StoreObject` intersection: `toReference(row, true)` accepts store-shaped
 * records (index-signature compatible). */
export type RealtimeNotificationCacheRow = StoreObject & {
  readonly __typename: "Notification";
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string | null;
  readonly isRead: false;
  readonly relatedEntityType: string | null;
  readonly relatedEntityId: number | null;
  readonly createdAt: string;
};

interface NotificationListPageView {
  readonly items: readonly unknown[];
  readonly totalCount: number;
  readonly hasMore: boolean;
}

/** Narrows a stored `myNotifications` variant value to its page shape. */
function asNotificationListPage(value: unknown): NotificationListPageView | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const totalCount = value.totalCount;
  const hasMore = value.hasMore;
  if (typeof totalCount !== "number" || typeof hasMore !== "boolean") {
    return null;
  }
  return { items: value.items, totalCount, hasMore };
}

/**
 * Whether a fresh unread arrival belongs in the cached list variant named by
 * `storeFieldName` (e.g. `myNotifications({"filter":{"isRead":false}})`).
 *
 * Page-1 windows only: deeper offsets converge through their own refetch
 * (the realtime merge never re-windows pagination). Read-only views never
 * gain an unread row; type-filtered views only gain matching types.
 */
function notificationMatchesListVariant(storeFieldName: string, payloadType: string): boolean {
  const argsStart = storeFieldName.indexOf("(");
  if (argsStart < 0) {
    return true;
  }
  let variables: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storeFieldName.slice(argsStart + 1, storeFieldName.lastIndexOf(")")));
    if (isRecord(parsed)) {
      variables = parsed;
    }
  } catch {
    return true;
  }
  const filter = isRecord(variables.filter) ? variables.filter : null;
  if (filter === null) {
    return true;
  }
  if (typeof filter.offset === "number" && filter.offset > 0) {
    return false;
  }
  if (filter.isRead === true) {
    return false;
  }
  if (typeof filter.type === "string") {
    return GRAPHQL_TYPE_NAME_TO_PAYLOAD_TYPE[filter.type] === payloadType;
  }
  return true;
}

/**
 * Merges one realtime arrival into the Apollo cache WITHOUT any refetch:
 * writes the normalized `Notification:{id}` entity and prepends it to every
 * matching page-1 `myNotifications` variant (dedupe: a variant that already
 * holds the id is left untouched and flags `held`).
 *
 * Returns whether the cache already held the row — REQ-025 makes a held
 * arrival a complete no-op (no count bump, no toast).
 */
export function mergeRealtimeNotificationIntoCache(
  cache: ApolloCache,
  row: RealtimeNotificationCacheRow,
  payloadType: string
): boolean {
  let held = false;
  cache.modify({
    id: "ROOT_QUERY",
    fields: {
      myNotifications: (existing: unknown, details: ModifierDetails) => {
        const page = asNotificationListPage(existing);
        if (page === null) {
          // Unrecognized shape — return the ORIGINAL value (returning
          // undefined here would DELETE the stored variant).
          return existing;
        }
        // Dedupe by LOGICAL id (readField resolves References — normalized
        // list members are always References in this app's cache) — a member
        // carrying the same id means the cache already holds this arrival.
        if (page.items.some(item => details.isReference(item) && details.readField("id", item) === row.id)) {
          held = true;
          return existing;
        }
        if (!notificationMatchesListVariant(details.storeFieldName, payloadType)) {
          return existing;
        }
        const written = details.toReference(row, true);
        return written === undefined
          ? existing
          : { ...page, items: [written, ...page.items], totalCount: page.totalCount + 1 };
      },
    },
  });
  return held;
}
