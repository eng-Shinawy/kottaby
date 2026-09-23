"use client";

/**
 * The teacher sessions surface's overlay cluster — the cancel/dispute
 * dialogs, the dispute case dialog, the report + rubric mounts, and the
 * snackbar chrome (split out of `TeacherSessionsContainer.tsx` for the
 * lint caps). Pure plumbing: every intent and piece of state stays owned
 * by the container; this composes the mounts in one place.
 */

import type { ReactNode } from "react";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import type { MyTeacherSessionsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { StudentSessionsDialogs } from "@/frontend/views/student/sessions/StudentSessionsDialogs";
import { OPEN_SESSION_DISPUTE_MUTATION } from "@/frontend/views/student/sessions/sessionDisputeMutations";
import { TeacherDisputeCaseDialog } from "@/frontend/views/teacher/disputes/TeacherDisputeCaseDialog";
import { TeacherRubricDialogMount } from "@/frontend/views/teacher/sessions/TeacherRubricDialogMount";
import { TeacherSessionReportDialogMount } from "@/frontend/views/teacher/sessions/TeacherSessionReportDialogMount";
import { type ContainerNotice, SNACKBAR_AUTOHIDE_MS } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import type { useTeacherCancelDialogArms } from "@/frontend/views/teacher/sessions/useTeacherCancelDialogArms";
import type { useTeacherDisputeDialogArms } from "@/frontend/views/teacher/sessions/useTeacherDisputeDialogArms";
import type { useTeacherLifecycleMutations } from "@/frontend/views/teacher/sessions/useTeacherLifecycleMutations";

interface TeacherSessionsOverlaysProps {
  readonly cancelArms: ReturnType<typeof useTeacherCancelDialogArms>;
  readonly disputeArms: ReturnType<typeof useTeacherDisputeDialogArms>;
  readonly caseDialogSessionId: string | null;
  readonly closeCaseDialog: () => void;
  readonly reportDialogSessionId: string | null;
  readonly closeReportDialog: () => void;
  readonly rubricDialogSessionId: string | null;
  readonly closeRubricDialog: () => void;
  readonly data: MyTeacherSessionsQuery | undefined;
  readonly setNotice: React.Dispatch<React.SetStateAction<ContainerNotice | null>>;
  readonly setRowAlerts: React.Dispatch<React.SetStateAction<Readonly<Record<string, string>>>>;
  readonly submitEvaluation: ReturnType<typeof useTeacherLifecycleMutations>["rubric"]["submitEvaluation"];
  readonly submitting: boolean;
  readonly notice: ContainerNotice | null;
  readonly dismissNotice: () => void;
}

/** The dialog + snackbar chrome rendered in EVERY body branch. */
export function TeacherSessionsOverlays({
  cancelArms,
  disputeArms,
  caseDialogSessionId,
  closeCaseDialog,
  reportDialogSessionId,
  closeReportDialog,
  rubricDialogSessionId,
  closeRubricDialog,
  data,
  setNotice,
  setRowAlerts,
  submitEvaluation,
  submitting,
  notice,
  dismissNotice,
}: Readonly<TeacherSessionsOverlaysProps>): ReactNode {
  return (
    <>
      <StudentSessionsDialogs
        cancelDialogSessionId={cancelArms.cancelDialogSessionId}
        disputeDialogSessionId={disputeArms.disputeDialogSessionId}
        onCloseCancelDialog={cancelArms.closeCancelDialog}
        onCloseDisputeDialog={disputeArms.closeDisputeDialog}
        onCancelled={cancelArms.handleCancelled}
        onSessionMissing={cancelArms.handleSessionMissing}
        onInvalidTransition={cancelArms.handleInvalidTransition}
        onDuplicateReplay={cancelArms.handleDuplicateReplay}
        onCancelFailure={cancelArms.handleFailure}
        disputeMutation={OPEN_SESSION_DISPUTE_MUTATION}
        onDisputed={disputeArms.handleDisputed}
        onDisputeSessionMissing={disputeArms.handleDisputeSessionMissing}
        onDisputeInvalidTransition={disputeArms.handleDisputeInvalidTransition}
        onDisputeFailure={disputeArms.handleDisputeFailure}
      />
      {caseDialogSessionId !== null ? (
        <TeacherDisputeCaseDialog sessionId={caseDialogSessionId} open onClose={closeCaseDialog} />
      ) : null}
      <TeacherSessionReportDialogMount
        sessionId={reportDialogSessionId}
        data={data}
        onClose={closeReportDialog}
        setNotice={setNotice}
        setRowAlerts={setRowAlerts}
      />
      <TeacherRubricDialogMount
        sessionId={rubricDialogSessionId}
        onClose={closeRubricDialog}
        submitEvaluation={submitEvaluation}
        submitting={submitting}
      />
      <NoticeSnackbar notice={notice} autoHideDuration={SNACKBAR_AUTOHIDE_MS} onClose={dismissNotice} />
    </>
  );
}
