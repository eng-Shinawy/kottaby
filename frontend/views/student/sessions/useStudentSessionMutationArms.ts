import { useApolloClient } from "@apollo/client/react";
import type { useMyTeacherEvaluations } from "@/frontend/views/student/sessions/useMyTeacherEvaluations";
import { useStudentSessionCancelArms } from "@/frontend/views/student/sessions/useStudentSessionCancelArms";
import { useStudentSessionConfirm } from "@/frontend/views/student/sessions/useStudentSessionConfirm";
import type { useStudentSessionDialogSlots } from "@/frontend/views/student/sessions/useStudentSessionDialogSlots";
import { useStudentSessionDisputeArms } from "@/frontend/views/student/sessions/useStudentSessionDisputeArms";
import type { useStudentSessionNotices } from "@/frontend/views/student/sessions/useStudentSessionNotices";
import { useStudentSessionRateArms } from "@/frontend/views/student/sessions/useStudentSessionRateArms";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * The dialog outcome-routing arms for the student sessions container:
 * cancel / dispute / rate arms plus the container-owned confirm-completion
 * mutation. Each arm receives the resolved copy handles, the notices
 * setters (row alerts + snackbar), and its dialog's close intent — the
 * wiring the container composes once per mount.
 */
export function useStudentSessionMutationArms({
  sessionsCopy,
  errorsCopy,
  slots,
  notices,
  markSessionRated,
}: {
  readonly sessionsCopy: SessionsLabels;
  readonly errorsCopy: ErrorsLabels;
  readonly slots: ReturnType<typeof useStudentSessionDialogSlots>;
  readonly notices: ReturnType<typeof useStudentSessionNotices>;
  readonly markSessionRated: ReturnType<typeof useMyTeacherEvaluations>["markSessionRated"];
}): {
  readonly cancelArms: ReturnType<typeof useStudentSessionCancelArms>;
  readonly disputeArms: ReturnType<typeof useStudentSessionDisputeArms>;
  readonly rateArms: ReturnType<typeof useStudentSessionRateArms>;
  readonly handleConfirm: ReturnType<typeof useStudentSessionConfirm>["handleConfirm"];
} {
  const client = useApolloClient();
  const { setRowAlerts, setNotice } = notices;

  const cancelArms = useStudentSessionCancelArms({
    sessionsCopy,
    errorsCopy,
    closeCancelDialog: slots.closeCancelDialog,
    setRowAlerts,
    setNotice,
  });

  const disputeArms = useStudentSessionDisputeArms({
    sessionsCopy,
    errorsCopy,
    closeDisputeDialog: slots.closeDisputeDialog,
    setRowAlerts,
    setNotice,
  });

  const rateArms = useStudentSessionRateArms({
    sessionsCopy,
    errorsCopy,
    closeRateDialog: slots.closeRateDialog,
    markSessionRated,
    setRowAlerts,
    setNotice,
  });

  const { handleConfirm } = useStudentSessionConfirm({
    cache: client.cache,
    sessionsCopy,
    errorsCopy,
    claimConfirmSlot: slots.claimConfirmSlot,
    clearConfirmSlot: slots.clearConfirmSlot,
    setRowAlerts,
    setNotice,
  });

  return { cancelArms, disputeArms, rateArms, handleConfirm };
}
