import { useCallback } from "react";
import {
  dropRowAlert,
  type StudentSessionNoticeWiring,
} from "@/frontend/views/student/sessions/useStudentSessionNotices";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** Copy handles + shared setters + the dialog close the arms ride on. */
export interface StudentSessionDisputeArmsDeps extends StudentSessionNoticeWiring {
  /** `Sessions` namespace labels (compile-time i18n handles). */
  readonly sessionsCopy: SessionsLabels;
  /** `Errors` namespace labels (compile-time i18n handles). */
  readonly errorsCopy: ErrorsLabels;
  /** Closing the dispute dialog also releases the row's dispute slot. */
  readonly closeDisputeDialog: () => void;
}

/** The dispute-dialog outcome arms consumed by `SessionDisputeConfirmDialog`. */
export interface StudentSessionDisputeArms {
  /** success → `sessions.disputeOpenedNotice` snackbar; the row flips to DISPUTED via the dialog's cache normalize */
  readonly handleDisputed: (sessionId: string) => void;
  /** `SESSION_NOT_FOUND` → error snackbar; deliberately NO eviction arm — the row stays in the list */
  readonly handleDisputeSessionMissing: (sessionId: string) => void;
  /** `SESSION_INVALID_TRANSITION` → error snackbar; the row stays */
  readonly handleDisputeInvalidTransition: () => void;
  /** anything else → error snackbar; the dialog STAYS OPEN for a retry (the dispute slot stays claimed) */
  readonly handleDisputeFailure: (message: string) => void;
}

/**
 * Dispute-dialog outcome arms (ALL snackbars; the row stays in the list;
 * the dialog closes and releases the dispute slot on every terminal arm):
 * the dispute vocabulary per plan §4 is snackbar-mapped, NOT the cancel
 * flow's row-scoped inline alert.
 */
export function useStudentSessionDisputeArms(deps: Readonly<StudentSessionDisputeArmsDeps>): StudentSessionDisputeArms {
  const { sessionsCopy: t, errorsCopy: te, closeDisputeDialog, setRowAlerts, setNotice } = deps;

  const handleDisputed = useCallback(
    (sessionId: string): void => {
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: t.disputeOpenedNotice, severity: "success" });
      closeDisputeDialog();
    },
    [t, closeDisputeDialog, setRowAlerts, setNotice]
  );

  const handleDisputeSessionMissing = useCallback(
    (sessionId: string): void => {
      // Deliberately NO eviction arm (see the dispute dialog's docblock) —
      // the honest surface is the error notice; the row stays in the list.
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: te.sessionNotFound, severity: "error" });
      closeDisputeDialog();
    },
    [te, closeDisputeDialog, setRowAlerts, setNotice]
  );

  // No sessionId parameter: the invalid-transition arm never addresses the
  // row (no inline alert — the dispute vocabulary is snackbar-mapped), and a
  // parameterless callback stays assignable to the dialog's
  // `(sessionId: string) => void` prop type.
  const handleDisputeInvalidTransition = useCallback((): void => {
    setNotice({ message: te.sessionInvalidTransition, severity: "error" });
    closeDisputeDialog();
  }, [te, closeDisputeDialog, setNotice]);

  const handleDisputeFailure = useCallback(
    (message: string): void => {
      setNotice({ message, severity: "error" });
    },
    [setNotice]
  );

  return { handleDisputed, handleDisputeSessionMissing, handleDisputeInvalidTransition, handleDisputeFailure };
}
