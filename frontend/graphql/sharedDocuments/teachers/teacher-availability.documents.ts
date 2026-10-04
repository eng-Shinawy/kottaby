import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MyTeacherAvailabilityQuery,
  SetTeacherAvailabilityMutation,
  SetTeacherAvailabilityMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Teacher-availability shared GraphQL documents — the certified-teacher
 * availability toggle wire surface (the read + the write).
 *
 * Two operations over the availability SDL surface:
 * - `myTeacherAvailability` — the caller's own availability snapshot.
 * - `setTeacherAvailability(isOnline: Boolean!)` — the toggle write.
 *
 * Caller identity is NEVER wire-visible: the query declares no variables at
 * all (identity is derived server-side from the authenticated caller), and
 * the mutation's only argument is the boolean toggle — the actor is
 * resolved server-side from the access token. A BOLA probe has no
 * identity surface to address; BOPLA keeps the write surface closed to a
 * single boolean (no spread, no row passthrough).
 *
 * Every object selection includes `id` first so Apollo Client normalizes
 * the returned `TeacherAvailabilityState` row into the cache (per
 * `sharedDocuments/AGENTS.md` "id Field Requirement"). The three selected
 * fields — `id`, `isOnline`, `isApproved` — are exactly the public
 * availability projection (no extra field, no nullable leaf on this
 * object type).
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. Hooks (`useQuery`, `useMutation`) are
 * consumed from `@apollo/client/react` in views; `useLazyQuery` is
 * banned.
 */

/**
 * `myTeacherAvailability` — the calling teacher's own availability
 * snapshot (`TeacherAvailabilityState!`). Zero-argument query: identity
 * is derived server-side ONLY from the access token's user, so the
 * operation declares NO variables and carries no injection surface at
 * all. Selection is exactly the three public availability fields
 * (`id` first for Apollo cache normalization, then the online flag and
 * the certification gate the UI uses for the disabled affordance).
 */
export const myTeacherAvailabilityQueryDocument: TypedDocumentNode<MyTeacherAvailabilityQuery> = gql`
  query MyTeacherAvailability {
    myTeacherAvailability {
      id
      isOnline
      isApproved
    }
  }
`;

/**
 * `setTeacherAvailability(isOnline: Boolean!)` — toggles the calling
 * teacher's online availability. The wire rejects with typed
 * `extensions.code` surfaces for every denial (anonymous, non-teacher
 * role, uncertified teacher, an active in-flight session lock, unknown
 * row). Returns the updated `TeacherAvailabilityState!` (re-read of
 * the post-toggle snapshot) for cache normalization.
 *
 * The single `$isOnline: Boolean!` variable is the WHOLE write surface:
 * no client-supplied id, no row passthrough, no spread — the actor is
 * server-derived from the access token. Selecting `id` first keeps the
 * returned row normalized into the same cache entry the read populates
 * so a successful toggle is visible to every consumer of the same row.
 */
export const setTeacherAvailabilityMutationDocument: TypedDocumentNode<
  SetTeacherAvailabilityMutation,
  SetTeacherAvailabilityMutationVariables
> = gql`
  mutation SetTeacherAvailability($isOnline: Boolean!) {
    setTeacherAvailability(isOnline: $isOnline) {
      id
      isOnline
      isApproved
    }
  }
`;
