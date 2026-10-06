import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  BrowseAvailableTeachersQuery,
  BrowseAvailableTeachersQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Teacher-matching shared GraphQL documents — the student-facing
 * teacher-directory browse wire surface (the "Available Teachers" read).
 *
 * One operation over the matching SDL surface:
 * - `browseAvailableTeachers(recitation, intent, search, minRating, sort,
 *   page, pageSize)` — the paged, filtered browse of eligible teachers
 *   carrying the six per-browse choices (the hard Qira'ah filter, the
 *   subject intent, the optional name search + minimum-rating floor, the
 *   post-tier ordering choice, and the page bounds).
 *
 * Caller identity is NEVER wire-visible: the query declares only the six
 * per-browse CHOICES — the browsing student is derived server-side from
 * the authenticated caller (`ctx.user.id`), so a BOLA probe has no
 * identity surface to address. The three optional pairings
 * (`search`/`minRating` name-and-rating narrowing, `sort` the ordering
 * choice with the SDL default `RATING_DESC`, and `page`/`pageSize` with
 * SDL defaults 1/25) are all nullable on the wire; the container always
 * sends `page`/`pageSize` explicitly so the pagination echo is
 * deterministic, and forwards `search` as `null` when empty.
 *
 * `id` is selected FIRST inside `items` so Apollo Client normalizes each
 * `TeacherMatchingItem` row into the cache; the surrounding
 * `TeacherMatchingPage` envelope is an id-less value object consumed per
 * fetch (its `keyFields: false` policy lives in
 * `frontend/providers/apollo/apolloCache.ts`).
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. The hook (`useQuery`) is consumed from
 * `@apollo/client/react` in views; `useLazyQuery` is banned.
 */

/**
 * `browseAvailableTeachers` — the student-gated directory browse
 * (`TeacherMatchingPage!`). Denials keep typed `extensions.code`
 * surfaces (anonymous → UNAUTHORIZED, authenticated non-student →
 * FORBIDDEN, a caller without a `students` row → STUDENT_NOT_FOUND);
 * zero matches is a valid, honest empty page — never an error. The
 * selection is exactly the PII-minimal public card projection plus the
 * pagination envelope the results header + pager render from.
 */
export const browseAvailableTeachersQueryDocument: TypedDocumentNode<
  BrowseAvailableTeachersQuery,
  BrowseAvailableTeachersQueryVariables
> = gql`
  query BrowseAvailableTeachers(
    $intent: SessionIntent!
    $minRating: Float
    $page: Int
    $pageSize: Int
    $recitation: RecitationReading!
    $search: String
    $sort: TeacherMatchingSort
  ) {
    browseAvailableTeachers(
      intent: $intent
      minRating: $minRating
      page: $page
      pageSize: $pageSize
      recitation: $recitation
      search: $search
      sort: $sort
    ) {
      items {
        id
        fullName
        country
        countryCode
        subjects
        recitations
        languages
        averageRating
        isOnline
      }
      total
      page
      pageSize
      pageCount
    }
  }
`;
