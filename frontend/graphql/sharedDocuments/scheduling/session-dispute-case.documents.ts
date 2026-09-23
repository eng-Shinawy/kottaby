import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminDisputeAnalyticsQuery,
  AdminDisputeAnalyticsQueryVariables,
  AdminDisputeCaseQuery,
  AdminDisputeCaseQueryVariables,
  StudentDisputeCaseQuery,
  StudentDisputeCaseQueryVariables,
  TeacherDisputeCaseQuery,
  TeacherDisputeCaseQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Session DISPUTE case-READ documents — the arbitration family's read
 * envelopes, split out of `session-disputes.documents.ts` (the
 * function-size tier): the ADMIN case-review read (`adminDisputeCase`),
 * the ADMIN analytics snapshot (`adminDisputeAnalytics`), the session's
 * OWN teacher's participant-side case read (`teacherDisputeCase`) and the
 * session's OWN student's — the filing party's — exact mirror
 * (`studentDisputeCase`). Every `Session` payload selects `id` first so
 * Apollo Client normalizes returned rows into the cache — consumers
 * converge via the returned `Session!` payloads WITHOUT refetch storms
 * (per the `sharedDocuments/AGENTS.md` "id Field Requirement").
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers.
 */

/**
 * `adminDisputeCase(id: ID!)` — the ADMIN case-review read: the full
 * evidence bundle for one disputed session in a single response — the
 * session detail (the shared dispute-family `Session` selection), the
 * teacher report (with `studentRatingByTeacher`), the homework row, the
 * recitation record and the session-scoped audit-trail entries, plus the
 * server-resolved participant display names. The three
 * evidence artifacts are honest `null`s when absent (no report submitted,
 * no homework/recitation) — never fabricated placeholders. Admin-only
 * scope lives server-side (`$all{authenticated, role:[Admin]}` + the
 * service-level governance re-assertion).
 */
export const adminDisputeCaseQueryDocument: TypedDocumentNode<AdminDisputeCaseQuery, AdminDisputeCaseQueryVariables> =
  gql`
  query AdminDisputeCase($id: ID!) {
    adminDisputeCase(id: $id) {
      session {
        id
        status
        intent
        sessionType
        fee
        feeHeld
        studentId
        teacherId
        startedAt
        endedAt
        confirmationDeadline
        confirmedByStudentAt
        confirmedByTeacherAt
        createdAt
        updatedAt
        cancelReason
        disputeReason
        disputedAt
        resolutionNote
        resolutionOutcome
        resolvedAt
      }
      report {
        id
        sessionId
        teacherNotes
        studentRatingByTeacher
        createdAt
        updatedAt
      }
      homework {
        id
        sessionId
        currentFromAyah
        currentToAyah
        currentGrade
        currentSurahJuz
        revisionFromAyah
        revisionToAyah
        revisionGrade
        revisionSurahJuz
        createdAt
        updatedAt
      }
      recitation {
        id
        sessionId
        name
        description
        createdAt
        updatedAt
      }
      auditTrail {
        id
        actionType
        actorId
        actorName
        createdAt
        details
        entityId
        entityType
      }
      studentName
      teacherName
    }
  }
`;

/**
 * `adminDisputeAnalytics` — the ADMIN aggregate dispute snapshot: the open
 * dispute count (the arbitration queue's own membership predicate), the
 * resolved total, and the per-outcome breakdown across BOTH escrow
 * generations. Zero arguments by design — the snapshot is the unfiltered
 * all-time aggregate; every value is an honest count (zero is the
 * legitimate empty state). Admin-only scope lives server-side
 * (`$all{authenticated, role:[Admin]}` + the service-level governance
 * re-assertion).
 */
export const adminDisputeAnalyticsQueryDocument: TypedDocumentNode<
  AdminDisputeAnalyticsQuery,
  AdminDisputeAnalyticsQueryVariables
> = gql`
  query AdminDisputeAnalytics {
    adminDisputeAnalytics {
      openDisputes
      resolvedDisputes
      cancelCount
      completeCount
      refundCount
      partialRefundCount
      upholdCount
    }
  }
`;

/**
 * `teacherDisputeCase(id: ID!)` — the session's OWN teacher's case read:
 * the participant-side transparency bundle for one disputed session in a
 * single response — the session detail (the shared dispute-family `Session`
 * selection), the participant-owned artifacts (the session report, the
 * homework row, the recitation record) and the server-resolved student
 * display name. The three artifacts are honest `null`s when absent — never
 * fabricated placeholders. The admin-only audit trail is deliberately NOT
 * selectable here (it is not part of the teacher bundle at all). The
 * teacher-participant predicate lives service-side: a teacher who does not
 * own the session and a nonexistent id are indistinguishable localized
 * `SESSION_NOT_FOUND` denials (oracle-safe). Wire scope is
 * `$all{authenticated, role:[Teacher]}` — the service predicate narrows it
 * to THE teacher of THIS session.
 */
export const teacherDisputeCaseQueryDocument: TypedDocumentNode<
  TeacherDisputeCaseQuery,
  TeacherDisputeCaseQueryVariables
> = gql`
  query TeacherDisputeCase($id: ID!) {
    teacherDisputeCase(id: $id) {
      session {
        id
        status
        intent
        sessionType
        fee
        feeHeld
        studentId
        teacherId
        startedAt
        endedAt
        confirmationDeadline
        confirmedByStudentAt
        confirmedByTeacherAt
        createdAt
        updatedAt
        cancelReason
        disputeReason
        disputedAt
        resolutionNote
        resolutionOutcome
        resolvedAt
      }
      report {
        id
        sessionId
        teacherNotes
        studentRatingByTeacher
        createdAt
        updatedAt
      }
      homework {
        id
        sessionId
        currentFromAyah
        currentToAyah
        currentGrade
        currentSurahJuz
        revisionFromAyah
        revisionToAyah
        revisionGrade
        revisionSurahJuz
        createdAt
        updatedAt
      }
      recitation {
        id
        sessionId
        name
        description
        createdAt
        updatedAt
      }
      studentName
    }
  }
`;

/**
 * `studentDisputeCase(id: ID!)` — the session's OWN student's (the filing
 * participant's) case read, the exact mirror of `teacherDisputeCase`: the
 * participant-side transparency bundle for one disputed session in a
 * single response — the session detail (the shared dispute-family `Session`
 * selection), the participant-owned artifacts (the session report, the
 * homework row, the recitation record) and the server-resolved TEACHER
 * display name. The three artifacts are honest `null`s when absent — never
 * fabricated placeholders. The admin-only audit trail is deliberately NOT
 * selectable here (it is not part of the participant bundle at all). The
 * student-participant predicate lives service-side: a student who does not
 * own the session and a nonexistent id are indistinguishable localized
 * `SESSION_NOT_FOUND` denials (oracle-safe). Wire scope is
 * `$all{authenticated, role:[Student]}` — the service predicate narrows it
 * to THE student of THIS session.
 */
export const studentDisputeCaseQueryDocument: TypedDocumentNode<
  StudentDisputeCaseQuery,
  StudentDisputeCaseQueryVariables
> = gql`
  query StudentDisputeCase($id: ID!) {
    studentDisputeCase(id: $id) {
      session {
        id
        status
        intent
        sessionType
        fee
        feeHeld
        studentId
        teacherId
        startedAt
        endedAt
        confirmationDeadline
        confirmedByStudentAt
        confirmedByTeacherAt
        createdAt
        updatedAt
        cancelReason
        disputeReason
        disputedAt
        resolutionNote
        resolutionOutcome
        resolvedAt
      }
      report {
        id
        sessionId
        teacherNotes
        studentRatingByTeacher
        createdAt
        updatedAt
      }
      homework {
        id
        sessionId
        currentFromAyah
        currentToAyah
        currentGrade
        currentSurahJuz
        revisionFromAyah
        revisionToAyah
        revisionGrade
        revisionSurahJuz
        createdAt
        updatedAt
      }
      recitation {
        id
        sessionId
        name
        description
        createdAt
        updatedAt
      }
      teacherName
    }
  }
`;
