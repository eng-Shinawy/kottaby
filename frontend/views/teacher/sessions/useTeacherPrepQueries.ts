"use client";

/**
 * useTeacherPrepQueries — the parallel `useQuery` bundle for the teacher
 * preparation dialog. Two reads re-keyed by the student id:
 *  - `studentProgress` — the curriculum-position read model.
 *  - `studentHomeworkHistory` — the cross-teacher history page, always
 *    requested as an explicit deterministic window (`page: 1`, `pageSize: 5`;
 *    the server clamps and echoes the effective values).
 * NO `useLazyQuery` — stateful queries with `skip`, exactly like the sibling
 * report bundle: nothing runs while the dialog is closed or the row carries
 * no student id. Both reads run `network-only`: every dialog open is a fresh
 * keyed mount that fetches current server state, because the dialog exists
 * to show the student's current lesson position — a progress advance that
 * settles elsewhere must surface on the next open, which cache-first would
 * silently swallow for a same-student reopen. The two round-trips on open
 * are the accepted composition cost, and the fetched rows still land in the
 * normalized cache, so hot-reload and DevTools inspection keep serving a
 * fully populated store. Each consumer
 * section folds its own failure state from its own query object; the folded
 * `loading` covers the busy semantics of the dialog content as a whole.
 */

import { useQuery } from "@apollo/client/react";
import { studentHomeworkHistoryQueryDocument } from "@/frontend/graphql/sharedDocuments/scheduling/session-report.documents";
import { studentProgressQueryDocument } from "@/frontend/graphql/sharedDocuments/scheduling/student-progress.documents";

export interface TeacherPrepQueriesProps {
  readonly open: boolean;
  readonly studentId: number | null;
}

/**
 * Returns the two queries the dialog composes, plus the folded `loading`
 * across both reads. Both queries skip while the dialog is closed (no
 * network round-trip on a closed mount).
 */
export function useTeacherPrepQueries({ open, studentId }: Readonly<TeacherPrepQueriesProps>) {
  // The placeholder id rides only while the queries are skipped — the skip
  // gate opens solely with a real student id, so it never reaches the wire.
  const activeStudentId = studentId ?? 0;
  const skip = !open || !studentId;
  const progressQuery = useQuery(studentProgressQueryDocument, {
    variables: { studentId: activeStudentId },
    skip,
    fetchPolicy: "network-only",
  });
  const homeworkQuery = useQuery(studentHomeworkHistoryQueryDocument, {
    variables: { studentId: activeStudentId, page: 1, pageSize: 5 },
    skip,
    fetchPolicy: "network-only",
  });
  return {
    progressQuery,
    homeworkQuery,
    loading: progressQuery.loading || homeworkQuery.loading,
  };
}
