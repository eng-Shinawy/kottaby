"use client";

import type { ReactNode } from "react";
import { ParticipantDisputeCaseDialog } from "@/frontend/views/shared/disputes/ParticipantDisputeCaseDialog";

/**
 * TeacherDisputeCaseDialog — the session's OWN teacher's case read: the
 * teacher sessions surface's "Case details" on any row that carries
 * dispute history. A thin surface binding over the shared
 * `ParticipantDisputeCaseDialog` core (the mirror of the student dialog):
 * the teacher surface binds the `teacherDisputeCase` query, the
 * STUDENT-perspective attribution labels (`teacherCase*` — the counterparty
 * label, the report title, the rating attribution) and the
 * `teacher-dispute-case-*` testid prefix — the bundle, the honesty
 * contract (honest nulls, never fabricated placeholders) and the state
 * matrix are the shared core's. The admin-only audit trail is deliberately
 * NOT part of this bundle (the trail read asserts an admin actor
 * server-side).
 */

interface TeacherDisputeCaseDialogProps {
  /** Id of the session whose case is on view (the case query's closed variable). */
  readonly sessionId: string;
  readonly open: boolean;
  /** Dismiss intent — the close action and the dismissal gate both route here. */
  readonly onClose: () => void;
}

/** The teacher case dialog: one query, session facts + decision + artifacts, honest nulls. */
export function TeacherDisputeCaseDialog({
  sessionId,
  open,
  onClose,
}: Readonly<TeacherDisputeCaseDialogProps>): ReactNode {
  return <ParticipantDisputeCaseDialog surface="teacher" sessionId={sessionId} open={open} onClose={onClose} />;
}
