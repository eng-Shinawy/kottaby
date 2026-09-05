import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MarkAllNotificationsReadMutation,
  MarkAllNotificationsReadMutationVariables,
  MarkNotificationReadMutation,
  MarkNotificationReadMutationVariables,
  MyNotificationsQuery,
  MyNotificationsQueryVariables,
  MyUnreadNotificationCountQuery,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * `myNotifications` query — one page of the caller's own inbox.
 *
 * Self-scoped: identity is derived server-side from the authenticated
 * caller, so the only variable is the optional `filter` (type / read
 * state / page window). The feed page passes its local filter state
 * (type chips + unread toggle + limit/offset pagination) through this
 * single input; there is no identity field anywhere in the document.
 *
 * The selection mirrors the full `Notification` row (all eight public
 * fields) so the feed renders every column — type chip, title, body,
 * read state, timestamp and the related-entity handles — from one
 * query. `id` is selected FIRST on every `Notification` row inside
 * `items` so Apollo Client normalizes the rows into cache entries
 * (per `sharedDocuments/AGENTS.md` "id Field Requirement"); the
 * `NotificationListPage` wrapper itself is an embedded value type
 * (`keyFields: false` in `apolloCache.ts`) and never needs an `id`.
 */
export const myNotificationsQueryDocument: TypedDocumentNode<MyNotificationsQuery, MyNotificationsQueryVariables> = gql`
  query MyNotifications($filter: MyNotificationsFilterInput) {
    myNotifications(filter: $filter) {
      items {
        id
        type
        title
        body
        isRead
        relatedEntityType
        relatedEntityId
        createdAt
      }
      totalCount
      hasMore
    }
  }
`;

/**
 * `myUnreadNotificationCount` query — the caller's unread count.
 *
 * Zero-argument query: identity is derived server-side ONLY from the
 * authenticated caller, so the operation declares NO variables and
 * carries no injection surface at all. Returns a bare `Int` — the
 * badge read (0 for an all-read or empty inbox). Polled on the
 * conventional notification-count interval; a realtime arrival bumps
 * the cached value without a refetch.
 */
export const myUnreadNotificationCountQueryDocument: TypedDocumentNode<MyUnreadNotificationCountQuery> = gql`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

/**
 * `markNotificationRead` mutation — marks one of the caller's own
 * notifications read (idempotent) and returns the flipped row.
 *
 * The notification `id` travels as a GraphQL `ID` (string on the
 * wire). The selection mirrors the full `Notification` row with `id`
 * FIRST: Apollo writes the returned row back into the same
 * normalized cache entry the feed query produced, so the row
 * restyles to read and the badge recomputes WITHOUT a refetch.
 */
export const markNotificationReadMutationDocument: TypedDocumentNode<
  MarkNotificationReadMutation,
  MarkNotificationReadMutationVariables
> = gql`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id) {
      id
      type
      title
      body
      isRead
      relatedEntityType
      relatedEntityId
      createdAt
    }
  }
`;

/**
 * `markAllNotificationsRead` mutation — marks every unread
 * notification of the caller read (optionally narrowed to one type)
 * and returns the affected-row count as a bare `Int`.
 *
 * No object is returned, so there is nothing to normalize: the
 * consumer refetches / evicts the list queries (the page and the
 * unread count) after the sweep. The optional `type` argument
 * mirrors the active type filter when the caller sweeps a filtered
 * view; omitted, it sweeps the whole inbox.
 */
export const markAllNotificationsReadMutationDocument: TypedDocumentNode<
  MarkAllNotificationsReadMutation,
  MarkAllNotificationsReadMutationVariables
> = gql`
  mutation MarkAllNotificationsRead($type: NotificationType) {
    markAllNotificationsRead(type: $type)
  }
`;
