/**
 * useTeacherDisputeDialogArms — the dispute-dialog state + outcome arms,
 * extracted verbatim from `TeacherSessionsContainer` (the max-lines split).
 *
 * Owns the single dispute-dialog slot (re-keyed per id) and the four
 * outcome callbacks the reused `SessionDisputeConfirmDialog` invokes. All
 * arms are snackbars (the row stays in the list); the dialog closes and
 * releases the row's `dispute` in-flight slot — claimed on OPEN and
 * released on close (any outcome). Opening the dialog claims the slot via
 * the shared slot book; the session-missing arm deliberately performs NO
 * eviction (see the dispute dialog's docblock) — the honest surface is the
 * error notice.
 */

import { useCallback, useState } from "react";
import { type ContainerNotice, dropRowAlert } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

export interface TeacherDisputeDialogArms {
  readonly disputeDialogSessionId: string | null;
  readonly openDisputeDialog: (sessionId: string) => void;
  readonly closeDisputeDialog: () => void;
  readonly handleDisputed: (sessionId: string) => void;
  readonly handleDisputeSessionMissing: (sessionId: string) => void;
  readonly handleDisputeInvalidTransition: () => void;
  readonly handleDisputeFailure: (message: string) => void;
}

/** Wiring the dispute arms need: the slot book + the container's setters. */
interface DisputeArmsWiring {
  readonly claimDispute: (sessionId: string) => void;
  readonly releaseDispute: (sessionId: string) => void;
  readonly setRowAlerts: (
    updater: (prev: Readonly<Record<string, string>>) => Readonly<Record<string, string>>
  ) => void;
  readonly setNotice: (notice: ContainerNotice) => void;
}

/** The dispute-dialog slot + outcome arms — see the module docblock. */
export function useTeacherDisputeDialogArms(wiring: DisputeArmsWiring): TeacherDisputeDialogArms {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const [disputeDialogSessionId, setDisputeDialogSessionId] = useState<string | null>(null);
  const { claimDispute, releaseDispute, setRowAlerts, setNotice } = wiring;

  /** Dispute-dialog open — ALSO claims the row's `dispute` in-flight slot. */
  const openDisputeDialog = useCallback(
    (sessionId: string): void => {
      setDisputeDialogSessionId(sessionId);
      claimDispute(sessionId);
    },
    [claimDispute]
  );

  /** Dispute-dialog close (any outcome) — releases the row's dispute slot. */
  const closeDisputeDialog = useCallback((): void => {
    setDisputeDialogSessionId(current => {
      if (current !== null) releaseDispute(current);
      return null;
    });
  }, [releaseDispute]);

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

  /**
   * Failure arm (VALIDATION / FORBIDDEN / masked) — the dispute dialog
   * STAYS OPEN for a retry (its own documented contract), so the dispute
   * slot stays claimed and the snackbar carries the resolved copy.
   */
  const handleDisputeFailure = useCallback(
    (message: string): void => {
      setNotice({ message, severity: "error" });
    },
    [setNotice]
  );

  return {
    disputeDialogSessionId,
    openDisputeDialog,
    closeDisputeDialog,
    handleDisputed,
    handleDisputeSessionMissing,
    handleDisputeInvalidTransition,
    handleDisputeFailure,
  };
}
