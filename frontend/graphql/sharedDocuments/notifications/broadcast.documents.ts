import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminBroadcastNotificationMutation,
  AdminBroadcastNotificationMutationVariables,
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
