import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MyChildrenUpcomingSessionsQuery,
  MyLinkedChildrenQuery,
  ParentChildHomeworkQuery,
  ParentChildHomeworkQueryVariables,
  ParentChildProgressQuery,
  ParentChildProgressQueryVariables,
  ParentChildReportsQuery,
  ParentChildReportsQueryVariables,
  ParentChildSessionsQuery,
  ParentChildSessionsQueryVariables,
  ParentSessionTargetQuery,
  ParentSessionTargetQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Parent read-only monitoring portal GraphQL documents — the shared
 * `TypedDocumentNode` operations consumed by the portal views in
 * `frontend/views/parent/monitoring/` (children list, child detail
 * header + progress, attendance / reports / homework / evaluations
 * tabs) plus the root container's completion-notification deep-link
 * resolution.
 *
 * Self-scoped surface: every per-student read carries ONLY the
 * `studentId` targeting argument plus optional pagination (`page` /
 * `pageSize`), and the deep-link resolution read carries ONLY the
 * `sessionId` argument — parent identity is ALWAYS derived server-side
 * from the authenticated caller (BOLA: no `parentId` / `actorId` /
 * `userId` / role / auth hint exists anywhere in the documents). The
 * list query is zero-argument — the caller's verified identity IS the
 * read scope.
 *
 * `id` is selected FIRST on every entity-shaped object selection
 * (`ParentLinkedChild`, `ParentAttendanceEntry`, `ParentReportEntry`,
 * `ParentHomeworkEntry`) so Apollo Client normalizes them into cache
 * entries. The three page wrappers (`ParentAttendancePage`,
 * `ParentReportPage`, `ParentHomeworkPage`), the three composite value
 * objects (`ParentHomeworkTrack`, `ParentHomeworkPosition`,
 * `ParentChildProgress`), and the session-target resolution pair
 * (`ParentSessionTarget`) carry no `id` and are registered with
 * `keyFields: false` in `frontend/providers/apollo/apolloCache.ts` —
 * they are embedded value types replaced wholesale on refetch.
 *
 * NO `useLazyQuery` anywhere in the documents layer — consumers use
 * stateful `useQuery` from "@apollo/client/react" and re-key on
 * `studentId` (the `?student=` URL param) so rows never leak across
 * children. Pagination state rides the same `useQuery` variables
 * contract.
 */

/**
 * `myLinkedChildren` query — the caller's (parent's) own linked
 * children, newest-first per the service contract.
 *
 * Zero-argument: the parent id is derived server-side from the verified
 * context. Each row carries the confirmed-child identity (`fullName`)
 * and `createdAt` (the link-establishment timestamp). Drives the portal
 * root container's empty-state (zero rows → handshake CTA) and the
 * child switcher (`?student=` writes). The same `ParentLinkedChild`
 * selection is echoed inside `parentChildProgress` so the detail header
 * stays in one payload with the progress metrics.
 */
export const myLinkedChildrenQueryDocument: TypedDocumentNode<MyLinkedChildrenQuery> = gql`
  query MyLinkedChildren {
    myLinkedChildren {
      id
      fullName
      createdAt
    }
  }
`;

/**
 * `myChildrenUpcomingSessions` query — the parent dashboard's "What's
 * next" glance read: one block per confirmed-linked child, each carrying
 * the child echo (the SAME `ParentLinkedChild` selection as the list, id
 * FIRST so the block group and the children surface share one normalized
 * cache entry), that child's capped scheduled-session window
 * (`upcomingSessions` — the slim `ParentChildUpcomingSession` value rows:
 * `sessionId` / verbatim nullable `fee` / booking `createdAt`), and the
 * HONEST scheduled total (`scheduledTotalCount`) the card's "N more" tail
 * is derived from.
 *
 * Zero-argument: the parent id is derived server-side from the verified
 * context; the children list IS the read scope (BOLA: no parent identity
 * argument exists). A parent with no linked children yields an empty
 * list — the card renders its link-child empty arm; a child with zero
 * scheduled sessions yields an empty window next to the honest `0`.
 * `ParentChildUpcomingBlock` and `ParentChildUpcomingSession` are
 * embedded value types (`keyFields: false` in `apolloCache.ts`) replaced
 * wholesale on refetch.
 */
export const myChildrenUpcomingSessionsQueryDocument: TypedDocumentNode<MyChildrenUpcomingSessionsQuery> = gql`
  query MyChildrenUpcomingSessions {
    myChildrenUpcomingSessions {
      child {
        id
        fullName
        createdAt
      }
      upcomingSessions {
        sessionId
        fee
        createdAt
      }
      scheduledTotalCount
    }
  }
`;

/**
 * `parentChildProgress` query — the detail-page header payload
 * (confirmed-child echo + progress count + latest Jadid/Madi
 * positions) collapsed into one read.
 *
 * The `studentId` is the ONLY variable. `child` re-projects the same
 * `ParentLinkedChild` selection as the list (id FIRST) so the detail
 * header restyles against the same normalized cache entry. The two
 * `latest*Position` fields are nullable: a `null` collapse means "no
 * recorded progress yet" on that track (Jadid or Madi) — never a
 * fabricated zero. `progressRowCount` is a non-null integer count.
 */
export const parentChildProgressQueryDocument: TypedDocumentNode<
  ParentChildProgressQuery,
  ParentChildProgressQueryVariables
> = gql`
  query ParentChildProgress($studentId: Int!) {
    parentChildProgress(studentId: $studentId) {
      child {
        id
        fullName
        createdAt
      }
      progressRowCount
      latestJadidPosition {
        surahJuz
        fromAyah
        toAyah
      }
      latestMadiPosition {
        surahJuz
        fromAyah
        toAyah
      }
    }
  }
`;

/**
 * `parentChildSessions` query — the child's attendance window
 * (derived read from `session` rows), paginated, newest-first per the
 * service contract.
 *
 * The `studentId` is required; `page` / `pageSize` are optional and
 * server-clamped to honest defaults (1 / 20, upper clamp 50). Each
 * `ParentAttendanceEntry` row carries the session lifecycle timestamps
 * (`startedAt` / `endedAt` nullable — `scheduled` rows have neither,
 * `started` rows have only `startedAt`, `completed` rows have both) and
 * the non-null `status` enum for the attendance chip. `totalCount` is
 * the honest total across all pages; `page` / `pageSize` echo the
 * resolved window.
 */
export const parentChildSessionsQueryDocument: TypedDocumentNode<
  ParentChildSessionsQuery,
  ParentChildSessionsQueryVariables
> = gql`
  query ParentChildSessions($studentId: Int!, $page: Int, $pageSize: Int) {
    parentChildSessions(studentId: $studentId, page: $page, pageSize: $pageSize) {
      items {
        id
        status
        startedAt
        endedAt
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * `parentChildReports` query — the child's session report window
 * (`reports ⋈ session` rows), paginated, newest-first per the service
 * contract.
 *
 * The `studentId` is required; `page` / `pageSize` are optional and
 * server-clamped. Each `ParentReportEntry` row carries the joined
 * session's `sessionStatus` + `sessionStartedAt` (so the report chip
 * and date render without a second query), the teacher-authored
 * `teacherNotes` (nullable — never coerced to ""), and the
 * `studentRatingByTeacher` (nullable — `null` renders "not rated yet",
 * NEVER `0`). `totalCount` / `page` / `pageSize` form the honest
 * envelope.
 */
export const parentChildReportsQueryDocument: TypedDocumentNode<
  ParentChildReportsQuery,
  ParentChildReportsQueryVariables
> = gql`
  query ParentChildReports($studentId: Int!, $page: Int, $pageSize: Int) {
    parentChildReports(studentId: $studentId, page: $page, pageSize: $pageSize) {
      items {
        id
        sessionId
        sessionStatus
        sessionStartedAt
        teacherNotes
        studentRatingByTeacher
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * `parentChildHomework` query — the child's homework window
 * (`home_work ⋈ session` rows with the Jadid/Madi track split),
 * paginated, newest-first per the service contract.
 *
 * The `studentId` is required; `page` / `pageSize` are optional and
 * server-clamped. Each `ParentHomeworkEntry` row carries the joined
 * session's `sessionId`, the two nullable track blocks `jadid` /
 * `madi` (each exposing `surahJuz` / `fromAyah` / `toAyah` / `grade` —
 * all nullable, a fully-null block means "none assigned" on that
 * track), and the homework `createdAt`. `totalCount` / `page` /
 * `pageSize` form the honest envelope.
 */
export const parentChildHomeworkQueryDocument: TypedDocumentNode<
  ParentChildHomeworkQuery,
  ParentChildHomeworkQueryVariables
> = gql`
  query ParentChildHomework($studentId: Int!, $page: Int, $pageSize: Int) {
    parentChildHomework(studentId: $studentId, page: $page, pageSize: $pageSize) {
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

/**
 * `parentSessionTarget` query — the completion-notification deep-link
 * resolution read: one session id resolved to the linked child it
 * belongs to, so the portal root can navigate to that child's session
 * report view.
 *
 * The `sessionId` is the ONLY variable — it is the session pointer the
 * notification row carries; no identity/role hint exists (the
 * linked-child grant is verified server-side against the authenticated
 * caller, so foreign and nonexistent session ids deny identically).
 * The result is the closed two-field pair (`sessionId` + `studentId`)
 * with NO `id`: `ParentSessionTarget` is a value object, not an entity
 * — registered with `keyFields: false` in
 * `frontend/providers/apollo/apolloCache.ts` and read back through the
 * root query field. The portal root container consumes it statefully
 * via `useQuery` (NO `useLazyQuery`) while a session pointer is
 * present.
 */
export const parentSessionTargetQueryDocument: TypedDocumentNode<
  ParentSessionTargetQuery,
  ParentSessionTargetQueryVariables
> = gql`
  query ParentSessionTarget($sessionId: Int!) {
    parentSessionTarget(sessionId: $sessionId) {
      sessionId
      studentId
    }
  }
`;
