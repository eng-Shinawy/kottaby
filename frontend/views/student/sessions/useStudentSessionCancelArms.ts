import { useCallback } from "react";
import {
  dropRowAlert,
  type StudentSessionNoticeWiring,
} from "@/frontend/views/student/sessions/useStudentSessionNotices";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** Copy handles + shared setters + the dialog close the arms ride on. */
export interface StudentSessionCancelArmsDeps extends StudentSessionNoticeWiring {
  /** `Sessions` namespace labels (compile-time i18n handles). */
  readonly sessionsCopy: SessionsLabels;
  /** `Errors` namespace labels (compile-time i18n handles). */
  readonly errorsCopy: ErrorsLabels;
  /** Closes the cancel dialog slot (every terminal cancel outcome). */
  readonly closeCancelDialog: () => void;
}

/** The cancel-dialog outcome arms consumed by `CancelSessionConfirmDialog`. */
export interface StudentSessionCancelArms {
  /** success → `sessions.holdReleasedNotice` snackbar + stale row alert dropped */
  readonly handleCancelled: (sessionId: string) => void;
  /** `SESSION_NOT_FOUND` → `errors.sessionNotFound` snackbar (eviction owned by the dialog) */
  readonly handleSessionMissing: (sessionId: string) => void;
  /** `SESSION_INVALID_TRANSITION` → row-scoped inline alert */
  readonly handleInvalidTransition: (sessionId: string) => void;
  /** `DUPLICATE_REQUEST` replay → informational snackbar (never an error — docs/IDEMPOTENCY.md §3) */
  readonly handleDuplicateReplay: () => void;
  /** anything else → error snackbar with the dialog-resolved copy; the dialog stays open for a retry */
  readonly handleFailure: (message: string) => void;
}

/**
 * Cancel-dialog outcome arms (the container wiring table): every terminal
 * arm drops the row's stale inline alert, surfaces the snackbar copy and
 * closes the dialog slot; `handleFailure` deliberately leaves the dialog
 * open for a retry (its own documented contract).
 */
export function useStudentSessionCancelArms(deps: Readonly<StudentSessionCancelArmsDeps>): StudentSessionCancelArms {
  const { sessionsCopy: t, errorsCopy: te, closeCancelDialog, setRowAlerts, setNotice } = deps;

  const handleCancelled = useCallback(
    (sessionId: string): void => {
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: t.holdReleasedNotice, severity: "success" });
      closeCancelDialog();
    },
    [t, closeCancelDialog, setRowAlerts, setNotice]
  );

  const handleSessionMissing = useCallback(
    (sessionId: string): void => {
      // Cache eviction + list filtering are owned by the dialog's
      // SESSION_NOT_FOUND arm — the row has already left the list here.
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: te.sessionNotFound, severity: "error" });
      closeCancelDialog();
    },
    [te, closeCancelDialog, setRowAlerts, setNotice]
  );

  const handleInvalidTransition = useCallback(
    (sessionId: string): void => {
      setRowAlerts(prev => ({ ...prev, [sessionId]: te.sessionInvalidTransition }));
      closeCancelDialog();
    },
    [te, closeCancelDialog, setRowAlerts]
  );

  const handleDuplicateReplay = useCallback((): void => {
    setNotice({ message: t.duplicateBookingInfo, severity: "info" });
    closeCancelDialog();
  }, [t, closeCancelDialog, setNotice]);

  const handleFailure = useCallback(
    (message: string): void => {
      setNotice({ message, severity: "error" });
      // The dialog stays open for a retry (its own documented contract).
    },
    [setNotice]
  );

  return { handleCancelled, handleSessionMissing, handleInvalidTransition, handleDuplicateReplay, handleFailure };
}
