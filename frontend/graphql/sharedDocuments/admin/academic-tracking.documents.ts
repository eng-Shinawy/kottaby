/**
 * Admin academic-tracking GraphQL documents — the cross-student academic
 * dashboard read-back and the per-student academic drill-down.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - Documents use `gql` + `TypedDocumentNode` (codegen types only).
 *  - `id` is selected FIRST in every entity selection so Apollo normalizes
 *    the cache entries (`AdminAcademicStudentRow` rows,
 *    `AdminAcademicStudentDetailEcho`, `AdminAcademicHomeworkEntry` rows,
 *    `AdminAcademicReportEntry` rows); the id-less wrapper and value types
 *    (`AdminAcademicDashboardPage`, `AdminAcademicStats`,
 *    `AdminAcademicPosition`, `AdminAcademicGradeSummary`,
 *    `AdminAcademicAttentionFlag`, `AdminStudentAcademicDetail`,
 *    `AdminAcademicHomeworkPage`, `AdminAcademicHomeworkTrack`,
 *    `AdminAcademicReportPage`) are embedded value types
 *    (`keyFields: false` in `frontend/providers/apollo/apolloCache.ts`)
 *    and never need an `id`.
 *  - Consumed in views via `useQuery` from `@apollo/client/react` — NO
 *    `useLazyQuery`.
 *  - Variables are typed, never string-interpolated.
 *  - Both surfaces are read-only: the wire carries zero mutation
 *    affordances, and the caller identity is derived server-side (the
 *    documents declare no actor arguments).
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminAcademicDashboardQuery,
  AdminAcademicDashboardQueryVariables,
  AdminStudentAcademicDetailQuery,
  AdminStudentAcademicDetailQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Paginated, searchable all-students academic dashboard for admins — the
 * latest Jadid/Madi positions, per-track grade summaries, the honest
 * progress-row count, the newest graded-activity stamp, and the attention
 * flag per student, over the honest `total`/`page`/`pageSize`/`pageCount`
 * envelope plus the aggregate advancement statistics block. `id` selected
 * FIRST per the Apollo cache-normalization rule.
 */
export const adminAcademicDashboardQueryDocument: TypedDocumentNode<
  AdminAcademicDashboardQuery,
  AdminAcademicDashboardQueryVariables
> = gql`
  query AdminAcademicDashboard($page: Int, $pageSize: Int, $search: String) {
    adminAcademicDashboard(page: $page, pageSize: $pageSize, search: $search) {
      items {
        id
        fullName
        email
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
        jadidGradeSummary {
          gradedCount
          averageGrade
        }
        madiGradeSummary {
          gradedCount
          averageGrade
        }
        progressRowCount
        lastGradedHomeworkAt
        needsAttention {
          reasons
        }
      }
      total
      page
      pageSize
      pageCount
      stats {
        trackedStudentCount
        studentsWithGradedHomeworkCount
        averageJadidGrade
        averageMadiGrade
        needingAttentionCount
      }
    }
  }
`;

/**
 * Per-student academic drill-down for admins — the student echo (header +
 * soft-delete governance banner input), the paginated newest-first homework
 * and session-report histories (both tracks with grades, ayah ranges,
 * surah/juz references, teacher names, and the session-start stamp with the
 * row-creation fallback), the honest progress-row count, and the
 * attention flag. The echo carries `isDeleted` ONLY here (never on
 * dashboard rows): a soft-deleted student's history stays viewable for
 * audit and the UI banners it. `id` selected FIRST on every entity
 * selection per the Apollo cache-normalization rule.
 */
export const adminStudentAcademicDetailQueryDocument: TypedDocumentNode<
  AdminStudentAcademicDetailQuery,
  AdminStudentAcademicDetailQueryVariables
> = gql`
  query AdminStudentAcademicDetail($studentId: Int!, $page: Int, $pageSize: Int) {
    adminStudentAcademicDetail(studentId: $studentId, page: $page, pageSize: $pageSize) {
      student {
        id
        fullName
        email
        isDeleted
      }
      homeworkPage {
        items {
          id
          sessionId
          sessionStartedAt
          teacherName
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
        total
        page
        pageSize
        pageCount
      }
      reportPage {
        items {
          id
          sessionId
          sessionStartedAt
          teacherName
          teacherNotes
          studentRatingByTeacher
          createdAt
        }
        total
        page
        pageSize
        pageCount
      }
      progressRowCount
      needsAttention {
        reasons
      }
    }
  }
`;
