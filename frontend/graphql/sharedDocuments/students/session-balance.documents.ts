import { gql, type TypedDocumentNode } from "@apollo/client";
import type { MySessionBalanceQuery, MySessionBalanceQueryVariables } from "@/frontend/graphql/generated/gql/graphql";

/**
 * Student session-credit balance shared GraphQL documents — the caller's
 * own prepaid lane read behind the dashboard's student balance stat card
 * and the request-session dialog's credits strip.
 *
 * One operation over the student-balance SDL surface:
 * - `mySessionBalance` — the authenticated student's prepaid
 *   session-credit lanes (trial + hifz + tajweed + reviews), a plain row
 *   projection with no debit logic (the booking pipeline's debit ladder
 *   is the write side; this read never spends anything).
 *
 * Caller identity is NEVER wire-visible: the query declares ZERO
 * variables — the student is derived server-side from the access token
 * (`ctx.user.id`), so a BOLA probe has no identity surface to address.
 * The Student-role gate denies anonymous callers with UNAUTHORIZED and
 * every other role with FORBIDDEN (mirroring `myHandshakeCode`).
 *
 * The `StudentSessionBalance` payload is an EMBEDDED VALUE TYPE: it
 * exposes exactly the four lane counts and deliberately carries NO `id`
 * field — nothing in the payload identifies the underlying row. It is
 * registered `keyFields: false` in
 * `frontend/providers/apollo/apolloCache.ts` (embedded-type
 * normalization policy in `frontend/graphql/AGENTS.md`): the value is
 * cached inline under the root field and replaced wholesale on every
 * refetch.
 *
 * Lane nullability is HONEST on the wire: `balanceTrial` is the NOT NULL
 * trial lane, while the three purchased lanes
 * (`balanceHifz`/`balanceTajweed`/`balanceReviews`) surface their
 * nullable columns verbatim — a null lane record carries no credits and
 * presentation coalesces it to 0 for display, never the schema lying.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. The hook (`useQuery`) is consumed from
 * `@apollo/client/react` in views; `useLazyQuery` is banned.
 */

/**
 * `mySessionBalance` — the Student-gated prepaid-credit read
 * (`StudentSessionBalance!`). Zero arguments (the identity is
 * exclusively the token's `ctx.user.id` — BOLA-clean); the selection is
 * exactly the four lane counts (read-side hygiene — no field beyond
 * them is requested).
 */
export const mySessionBalanceQueryDocument: TypedDocumentNode<MySessionBalanceQuery, MySessionBalanceQueryVariables> =
  gql`
  query MySessionBalance {
    mySessionBalance {
      balanceHifz
      balanceReviews
      balanceTajweed
      balanceTrial
    }
  }
`;
