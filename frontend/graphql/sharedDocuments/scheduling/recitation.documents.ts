import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  SessionRecitationQuery,
  SessionRecitationQueryVariables,
  SetSessionRecitationMutation,
  SetSessionRecitationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Session-recitation shared GraphQL documents — the write-once
 * per-session recitation record surfaced to session participants.
 *
 * Two operations over the session-recitation SDL surface: the nullable
 * participant read (`sessionRecitation`) and the owning teacher's
 * write-once mutation (`setSessionRecitation`). Both payloads select `id`
 * first so Apollo Client normalizes the returned `SessionRecitation` row
 * into the cache — `SessionRecitation` is an id-bearing entity, so default
 * normalization applies and the frozen `apolloCache.ts` type-policy
 * inventory stays untouched.
 *
 * Caller identity is NEVER wire-visible: the query's whole variable
 * surface is `sessionId` and the mutation's is `sessionId` + `input` —
 * ownership and actor governance are resolved server-side from the
 * authenticated caller, and the closed `SessionRecitationInput` whitelist
 * carries only `name` + `description`.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. Hooks (`useQuery`, `useMutation`) are
 * consumed from `@apollo/client/react` in views; `useLazyQuery` is banned.
 */

/**
 * `sessionRecitation(sessionId: ID!)` — nullable single-record read for
 * session participants. Returns `null` when the session carries no
 * recitation record yet, and collapses foreign/nonexistent sessions to the
 * same `null` (one no-oracle answer), so consumers must handle the empty
 * case. `description` is the sole nullable field of the row.
 */
export const sessionRecitationQueryDocument: TypedDocumentNode<
  SessionRecitationQuery,
  SessionRecitationQueryVariables
> = gql`
  query SessionRecitation($sessionId: ID!) {
    sessionRecitation(sessionId: $sessionId) {
      id
      sessionId
      name
      description
      createdAt
      updatedAt
    }
  }
`;

/**
 * `setSessionRecitation(sessionId: ID!, input: SessionRecitationInput!)` —
 * the owning teacher's write-once record creation. Returns the created
 * `SessionRecitation!` for cache normalization; a client retry of a
 * completed write deterministically surfaces the typed conflict
 * (`RECITATION_ALREADY_EXISTS`) under the unique-constraint arbiter —
 * no idempotency key is part of the contract.
 */
export const setSessionRecitationMutationDocument: TypedDocumentNode<
  SetSessionRecitationMutation,
  SetSessionRecitationMutationVariables
> = gql`
  mutation SetSessionRecitation($sessionId: ID!, $input: SessionRecitationInput!) {
    setSessionRecitation(sessionId: $sessionId, input: $input) {
      id
      sessionId
      name
      description
      createdAt
      updatedAt
    }
  }
`;
