"use client";

/**
 * TeacherRubricDialogMount — the conditional mount for the rubric-evaluation
 * dialog (the report-dialog mounting pattern), extracted from the container
 * to keep the container function under the oxlint max-lines-per-function
 * ceiling. The keyed mount leaves the tree entirely when the `sessionId`
 * slot is null, so every open starts from a pristine draft.
 */

import type { ReactNode } from "react";
import type { RubricEvaluationSubmitInput } from "@/frontend/graphql/generated/gql/graphql";
import { RubricEvaluationDialog } from "@/frontend/views/teacher/sessions/RubricEvaluationDialog";
import type { RubricSubmitOutcome } from "@/frontend/views/teacher/sessions/useRubricEvaluation";

export interface TeacherRubricDialogMountProps {
  /** The dialog slot — null while no row's submit-evaluation intent is open. */
  readonly sessionId: string | null;
  readonly onClose: () => void;
  /** Files the rubric verdict through the container's rubric arms. */
  readonly submitEvaluation: (sessionId: string, input: RubricEvaluationSubmitInput) => Promise<RubricSubmitOutcome>;
  /** `true` while the submit mutation is on the wire. */
  readonly submitting: boolean;
}

export function TeacherRubricDialogMount({
  sessionId,
  onClose,
  submitEvaluation,
  submitting,
}: Readonly<TeacherRubricDialogMountProps>): ReactNode {
  if (sessionId === null) return null;
  return (
    <RubricEvaluationDialog
      key={sessionId}
      sessionId={sessionId}
      onClose={onClose}
      onSubmit={submitEvaluation}
      submitting={submitting}
    />
  );
}
