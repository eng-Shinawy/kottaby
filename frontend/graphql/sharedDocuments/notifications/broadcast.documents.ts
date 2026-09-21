import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminBroadcastDetailQuery,
  AdminBroadcastDetailQueryVariables,
  AdminBroadcastNotificationMutation,
  AdminBroadcastNotificationMutationVariables,
  AdminBroadcastsQuery,
  AdminBroadcastsQueryVariables,
  AdminStopBroadcastMutation,
  AdminStopBroadcastMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * `adminBroadcastNotification` mutation — one admin-authored announcement
 * broadcast server-side to the selected audience; the ONLY payload is the
 * persisted recipient count.
 *
 * The recipient count rides back as a bare `Int` — the persisted count the
 * engine wrote (never a client-supplied or projected number) — so the root
 * field selects NO sub-selection and there is nothing for Apollo to
 * normalize.
 *
 * The audience selector AND the actor identity resolve server-side from the
 * authenticated admin, so the single `input` variable is the WHOLE variable
 * surface: zero identity arguments, and the input DTO carries no transport
 * concerns. The compose-session idempotency key NEVER travels in this
 * document — it rides the `X-Idempotency-Key` HTTP header via the mutation's
 * Apollo context (`context: { headers: ... }`), which the authLink
 * (`frontend/providers/apollo/utils/link-factories.ts`) additively merges
 * into the outgoing request headers.
 */
export const adminBroadcastNotificationMutationDocument: TypedDocumentNode<
  AdminBroadcastNotificationMutation,
  AdminBroadcastNotificationMutationVariables
> = gql`
  mutation AdminBroadcastNotification($input: AdminBroadcastNotificationInput!) {
    adminBroadcastNotification(input: $input)
  }
`;

/**
 * Shared row fragment for the history list and the detail read — the FULL
 * persisted lifecycle snapshot of one sent broadcast, `id` FIRST so Apollo
 * normalizes the row (the audience selector and both actor identities are
 * resolved server-side, never client-supplied).
 */
const ADMIN_BROADCAST_ENTRY_FIELDS = gql`
  fragment AdminBroadcastEntryFields on AdminBroadcastEntry {
    id
    title
    body
    status
    audienceType
    audienceRole
    audienceCountry
    audiencePlanId
    recipientCount
    sentAt
    sentById
    sentByName
    stoppedAt
    stoppedById
    stoppedByName
  }
`;

/**
 * Paginated, filterable admin broadcast-history read-back. Rows reuse the
 * shared entry fragment; the wrapper echoes the resolved
 * `page`/`pageSize`/`totalCount` (honest envelope, never client echoes).
 * The nullable `filters` carries only the three sanctioned conjuncts
 * (`titleSearch`, `status`, `audienceType`) — zero identity variables: the
 * actor resolves server-side from the authenticated admin.
 */
export const adminBroadcastsQueryDocument: TypedDocumentNode<AdminBroadcastsQuery, AdminBroadcastsQueryVariables> = gql`
  ${ADMIN_BROADCAST_ENTRY_FIELDS}
  query AdminBroadcasts($filters: AdminBroadcastFiltersInput, $page: Int, $pageSize: Int) {
    adminBroadcasts(filters: $filters, page: $page, pageSize: $pageSize) {
      items {
        ...AdminBroadcastEntryFields
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * Single-broadcast lifecycle detail read — the SAME normalized entry shape
 * as the history list (shared fragment, so a stop-triggered refetch lands in
 * the identical cache shape) plus the two live delivery/read counters the
 * engine recomputes on demand. `broadcastId` is the only variable: the
 * caller identity lives in the session, never in the document.
 */
export const adminBroadcastDetailQueryDocument: TypedDocumentNode<
  AdminBroadcastDetailQuery,
  AdminBroadcastDetailQueryVariables
> = gql`
  ${ADMIN_BROADCAST_ENTRY_FIELDS}
  query AdminBroadcastDetail($broadcastId: Int!) {
    adminBroadcastDetail(broadcastId: $broadcastId) {
      entry {
        ...AdminBroadcastEntryFields
      }
      liveDeliveredCount
      liveReadCount
    }
  }
`;

/**
 * `adminStopBroadcast` mutation — retract a still-active broadcast. The only
 * payload is the bare `Int` retracted-notification count (NO sub-selection,
 * nothing for Apollo to normalize); `broadcastId` is the single scalar
 * argument, wired as a variable. Actor identity and the already-stopped
 * rejection resolve server-side from the authenticated admin.
 */
export const adminStopBroadcastMutationDocument: TypedDocumentNode<
  AdminStopBroadcastMutation,
  AdminStopBroadcastMutationVariables
> = gql`
  mutation AdminStopBroadcast($broadcastId: Int!) {
    adminStopBroadcast(broadcastId: $broadcastId)
  }
`;
