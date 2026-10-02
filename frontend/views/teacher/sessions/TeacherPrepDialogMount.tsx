"use client";

/**
 * TeacherPrepDialogMount — the conditional mount for the read-only
 * pre-session preparation dialog, extracted beside the session-report
 * mount (the same max-lines split): it resolves the session row from the
 * cached `myTeacherSessions` data, derives the student id, and mounts the
 * dialog keyed by the session id when the `sessionId` slot is non-null.
 * The row's `studentId` is a GraphQL ID string over the shared numeric
 * student PK — converted once here into the number the progress read's
 * variables demand (the homework read accepts it too); a malformed id
 * string — anything non-numeric, non-finite, or ≤ 0 (student ids are
 * positive integers, so `""` and `"0"` fold away with the garbage) — folds
 * to `null` alongside the missing-row case, degrading to the dialog's
 * no-student state instead of a bogus `Student #NaN` / `Student #0` meta
 * line.
 * The dialog owns every read: this mount carries no query logic of its own.
 */

import type { ReactNode } from "react";
import type { MyTeacherSessionsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { TeacherPrepDialog } from "@/frontend/views/teacher/sessions/TeacherPrepDialog";

export interface TeacherPrepDialogMountProps {
  readonly sessionId: string | null;
  readonly data: MyTeacherSessionsQuery | undefined;
  readonly onClose: () => void;
}

export function TeacherPrepDialogMount({ sessionId, data, onClose }: Readonly<TeacherPrepDialogMountProps>): ReactNode {
  if (sessionId === null) return null;
  const row = data?.myTeacherSessions?.items?.find(s => s.id === sessionId);
  // Hostile-id fold: the id string is accepted only when it parses to a
  // finite POSITIVE number — `Number("")` and `Number("0")` both land on a
  // finite 0 and must degrade to the no-student state like the garbage.
  const parsedStudentId = row?.studentId == null ? Number.NaN : Number(row.studentId);
  const studentId = Number.isFinite(parsedStudentId) && parsedStudentId > 0 ? parsedStudentId : null;
  return <TeacherPrepDialog key={sessionId} open sessionId={sessionId} studentId={studentId} onClose={onClose} />;
}
