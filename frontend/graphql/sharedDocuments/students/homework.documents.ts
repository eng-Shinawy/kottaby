import { gql, type TypedDocumentNode } from "@apollo/client";
import type { MyHomeworkQuery, MyHomeworkQueryVariables } from "@/frontend/graphql/generated/gql/graphql";

/**
 * `myHomework` query — the authenticated student's own homework history.
 *
 * Zero caller-supplied identity: the student id is derived server-side from
 * the access token (the same zero-input pattern as `myHandshakeCode` /
 * `myStudentSessions`), so the operation declares ONLY the pagination
 * window variables. The selection set mirrors the parent portal's homework
 * document byte-for-byte (same canonical `ParentHomeworkPage` wire shape):
 * each item carries the joined session's `sessionId`, the two nullable
 * track blocks `jadid` / `madi` (each `surahJuz` / `fromAyah` / `toAyah` /
 * `grade` — all nullable, a fully-null block means "none assigned" on that
 * track), and the homework `createdAt`; `totalCount` / `page` / `pageSize`
 * form the honest envelope.
 */
export const myHomeworkQueryDocument: TypedDocumentNode<MyHomeworkQuery, MyHomeworkQueryVariables> = gql`
  query MyHomework($page: Int, $pageSize: Int) {
    myHomework(page: $page, pageSize: $pageSize) {
      items {
        id
        sessionId
        jadid {
          surahJuz
          fromAyah
          toAyah
          grade
        }
        madi {
          surahJuz
          fromAyah
          toAyah
          grade
        }
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;
