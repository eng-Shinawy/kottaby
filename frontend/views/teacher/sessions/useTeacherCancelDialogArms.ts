/**
 * useTeacherCancelDialogArms — the cancel-dialog state + outcome arms,
 * extracted verbatim from `TeacherSessionsContainer` (the max-lines split).
 *
 * Owns the single cancel-dialog slot (re-keyed per session id) and the five
 * outcome callbacks the reused `CancelSessionConfirmDialog` invokes:
 * success → drop the row alert + success snackbar + close; missing → close
 * (eviction owned by the dialog's SESSION_NOT_FOUND arm); invalid
 * transition → row-scoped inline alert + close; duplicate replay →
 * informational snackbar + close; failure → error snackbar, dialog STAYS
 * open for a retry (its own documented contract).
 */

import { useCallback, useState } from "react";
import { type ContainerNotice, dropRowAlert } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

export interface TeacherCancelDialogArms {
  readonly cancelDialogSessionId: string | null;
  readonly openCancelDialog: (sessionId: string) => void;
  readonly closeCancelDialog: () => void;
  readonly handleCancelled: (sessionId: string) => void;
  readonly handleSessionMissing: (sessionId: string) => void;
  readonly handleInvalidTransition: (sessionId: string) => void;
  readonly handleDuplicateReplay: () => void;
  readonly handleFailure: (message: string) => void;
}

/** Internal setters the outcome arms share. */
interface NoticeWiring {
  readonly setRowAlerts: (
    updater: (prev: Readonly<Record<string, string>>) => Readonly<Record<string, string>>
  ) => void;
  readonly setNotice: (notice: ContainerNotice) => void;
}

/** The cancel-dialog slot + outcome arms — see the module docblock. */
export function useTeacherCancelDialogArms(wiring: NoticeWiring): TeacherCancelDialogArms {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const [cancelDialogSessionId, setCancelDialogSessionId] = useState<string | null>(null);
  const { setRowAlerts, setNotice } = wiring;

  const openCancelDialog = useCallback((sessionId: string): void => {
    setCancelDialogSessionId(sessionId);
  }, []);

  const closeCancelDialog = useCallback((): void => {
    setCancelDialogSessionId(null);
  }, []);

  const handleCancelled = useCallback(
    (sessionId: string): void => {
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: t.sessionCancelledNotice, severity: "success" });
      setCancelDialogSessionId(null);
    },
    [t, setRowAlerts, setNotice]
  );

  const handleSessionMissing = useCallback(
    (sessionId: string): void => {
      // Cache eviction + list filtering are owned by the dialog's
      // SESSION_NOT_FOUND arm — the row has already left the list here.
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: te.sessionNotFound, severity: "error" });
      setCancelDialogSessionId(null);
    },
    [te, setRowAlerts, setNotice]
  );

  const handleInvalidTransition = useCallback(
    (sessionId: string): void => {
      setRowAlerts(prev => ({ ...prev, [sessionId]: te.sessionInvalidTransition }));
      setCancelDialogSessionId(null);
    },
    [te, setRowAlerts]
  );

  const handleDuplicateReplay = useCallback((): void => {
    setNotice({ message: t.duplicateBookingInfo, severity: "info" });
    setCancelDialogSessionId(null);
  }, [t, setNotice]);

  const handleFailure = useCallback(
    (message: string): void => {
      setNotice({ message, severity: "error" });
      // The dialog stays open for a retry (its own documented contract).
    },
    [setNotice]
  );

  return {
    cancelDialogSessionId,
    openCancelDialog,
    closeCancelDialog,
    handleCancelled,
    handleSessionMissing,
    handleInvalidTransition,
    handleDuplicateReplay,
    handleFailure,
  };
}
