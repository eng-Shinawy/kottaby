"use client";

import type { ReactNode } from "react";
import { ParticipantDisputeCaseDialog } from "@/frontend/views/shared/disputes/ParticipantDisputeCaseDialog";

/**
 * StudentDisputeCaseDialog — the session's OWN student's (the filing
 * participant's) case read: the student sessions surface's "Case details"
 * on any row that carries dispute history. A thin surface binding over the
 * shared `ParticipantDisputeCaseDialog` core (the exact mirror of the
 * teacher dialog): the student surface binds the `studentDisputeCase`
 * query, the TEACHER-perspective attribution labels (`studentCase*` — the
 * counterparty label, the report title, the rating attribution) and the
 * `student-dispute-case-*` testid prefix — the bundle, the honesty
 * contract (honest nulls, never fabricated placeholders) and the state
 * matrix are the shared core's.
 */

interface StudentDisputeCaseDialogProps {
  /** Id of the session whose case is on view (the case query's closed variable). */
  readonly sessionId: string;
  readonly open: boolean;
  /** Dismiss intent — the close action and the dismissal gate both route here. */
  readonly onClose: () => void;
}

/** The student case dialog: one query, session facts + decision + artifacts, honest nulls. */
export function StudentDisputeCaseDialog({
  sessionId,
  open,
  onClose,
}: Readonly<StudentDisputeCaseDialogProps>): ReactNode {
  return <ParticipantDisputeCaseDialog surface="student" sessionId={sessionId} open={open} onClose={onClose} />;
}
