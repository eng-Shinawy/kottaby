import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  FindStudentByHandshakeCodeQuery,
  FindStudentByHandshakeCodeQueryVariables,
  MyHandshakeCodeQuery,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * `myHandshakeCode` query — the authenticated student's own handshake code.
 *
 * Zero-argument query: the caller's identity is derived server-side ONLY from
 * the access token, so the operation declares NO variables and carries no
 * caller-supplied identity surface at all.
 *
 * Scalar-only selection: `myHandshakeCode` is a `String!` root field, so there
 * is no object selection set and nothing for the Apollo cache to normalize —
 * the shared documents `id` Field Requirement applies to object selections
 * only.
 */
export const myHandshakeCodeQueryDocument: TypedDocumentNode<MyHandshakeCodeQuery> = gql`
  query MyHandshakeCode {
    myHandshakeCode
  }
`;

/**
 * `findStudentByHandshakeCode` query — parent-side student discovery by the
 * out-of-band handshake code.
 *
 * Declares exactly one variable (`$code: String!`) — the only client-
 * controllable input. Misses (unknown code, or a student excluded from
 * discovery by governance) resolve to `null` on this field, never to an
 * error, so the not-found channel stays indistinguishable from never-existed.
 *
 * The `HandshakeCodeLookup` payload is an EMBEDDED VALUE TYPE: it exposes
 * exactly `maskedName` and `linkable` and deliberately carries NO `id` field,
 * so nothing in the payload can identify the underlying row. It is registered
 * `keyFields: false` in `frontend/providers/apollo/apolloCache.ts` (embedded
 * type normalization policy in `frontend/graphql/AGENTS.md`): the value is
 * cached inline under its parent field and never keyed by any identity-
 * derived value.
 *
 * Selection is exactly the two public fields (read-side hygiene — no field
 * beyond them is requested).
 */
export const findStudentByHandshakeCodeQueryDocument: TypedDocumentNode<
  FindStudentByHandshakeCodeQuery,
  FindStudentByHandshakeCodeQueryVariables
> = gql`
  query FindStudentByHandshakeCode($code: String!) {
    findStudentByHandshakeCode(code: $code) {
      maskedName
      linkable
    }
  }
`;
