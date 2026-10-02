import { gql, type TypedDocumentNode } from "@apollo/client";
import type { StudentProgressQuery, StudentProgressQueryVariables } from "@/frontend/graphql/generated/gql/graphql";

/**
 * `studentProgress(studentId: Int!)` — the per-student curriculum-progress
 * read model a teacher consults when preparing for an upcoming session:
 * the honest `hasProgress` flag (the ONLY "first session" signal — never
 * inferred from the lesson fields), the current lesson identity and its
 * 1-based position, the completed-lessons counter with its floor-computed
 * percentage, the plan title, and the final-lesson flag.
 *
 * Selection contract: the EXACT 11 `StudentProgress` payload fields —
 * nothing beyond the server contract, nothing omitted (a dropped nullable
 * leg would force a client fallback that could fabricate curriculum
 * state; the lesson legs are null exactly when `hasProgress` is false).
 *
 * `StudentProgress` is computed per request and carries NO `id`, so the
 * payload never normalizes: the type registers `keyFields: false` in the
 * Apollo cache `typePolicies` (see
 * `frontend/providers/apollo/apolloCache.ts`) and the object is read back
 * inline under the `studentProgress` root field.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals as
 * TYPES, never mapping layers. Hooks (`useQuery`) are consumed from
 * `@apollo/client/react` in views; `useLazyQuery` is banned.
 */
export const studentProgressQueryDocument: TypedDocumentNode<StudentProgressQuery, StudentProgressQueryVariables> = gql`
  query StudentProgress($studentId: Int!) {
    studentProgress(studentId: $studentId) {
      hasProgress
      studentId
      planId
      planTitle
      totalLessons
      currentLessonId
      currentLessonTitle
      currentLessonPosition
      lessonsCompleted
      completionPercent
      isOnFinalLesson
    }
  }
`;
