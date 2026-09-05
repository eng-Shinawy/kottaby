import { useCallback, useState } from "react";
import {
  addInFlightAction,
  type InFlightSlots,
  removeInFlightAction,
} from "@/frontend/views/student/sessions/studentSessionInFlightSlots";

/** The dialog slots + per-row in-flight slot book owned by this hook. */
export interface StudentSessionDialogSlots {
  /** Id of the session whose cancel dialog is open (`null` = closed). */
  readonly cancelDialogSessionId: string | null;
  /** Id of the session whose dispute dialog is open (`null` = closed). */
  readonly disputeDialogSessionId: string | null;
  /** Full per-row slot book — dispute + confirm CTAs disable per row. */
  readonly inFlightSlots: InFlightSlots;
  readonly openCancelDialog: (sessionId: string) => void;
  readonly closeCancelDialog: () => void;
  /** Opening the dispute dialog ALSO claims the row's `dispute` slot. */
  readonly openDisputeDialog: (sessionId: string) => void;
  /** Closing (any outcome) releases the row's dispute slot. */
  readonly closeDisputeDialog: () => void;
  /** Claims the row's `confirm` slot (confirm mutation launch). */
  readonly claimConfirmSlot: (sessionId: string) => void;
  /** Releases the row's `confirm` slot (every confirm outcome). */
  readonly clearConfirmSlot: (sessionId: string) => void;
}

/**
 * Dialog open/close state + the per-row in-flight slot book for the
 * student sessions container — the row whose dispute dialog is open holds
 * the `dispute` slot, disabling its dispute CTA behind the modal while its
 * mutation runs; the confirm mutation (container-owned, no dialog) books
 * the `confirm` slot for its own row.
 */
export function useStudentSessionDialogSlots(): StudentSessionDialogSlots {
  // Cancel-dialog owner (single dialog slot, re-keyed per session id).
  const [cancelDialogSessionId, setCancelDialogSessionId] = useState<string | null>(null);
  // Dispute-dialog owner (single dialog slot, re-keyed per id).
  const [disputeDialogSessionId, setDisputeDialogSessionId] = useState<string | null>(null);
  // Per-row in-flight slots (immutable slot book — see the module docblock).
  const [inFlightSlots, setInFlightSlots] = useState<InFlightSlots>({});

  const openCancelDialog = useCallback((sessionId: string): void => {
    setCancelDialogSessionId(sessionId);
  }, []);

  const closeCancelDialog = useCallback((): void => {
    setCancelDialogSessionId(null);
  }, []);

  const openDisputeDialog = useCallback((sessionId: string): void => {
    setDisputeDialogSessionId(sessionId);
    setInFlightSlots(prev => addInFlightAction(prev, sessionId, "dispute"));
  }, []);

  const closeDisputeDialog = useCallback((): void => {
    setDisputeDialogSessionId(null);
    setInFlightSlots(prev =>
      disputeDialogSessionId === null ? prev : removeInFlightAction(prev, disputeDialogSessionId, "dispute")
    );
  }, [disputeDialogSessionId]);

  const claimConfirmSlot = useCallback((sessionId: string): void => {
    setInFlightSlots(prev => addInFlightAction(prev, sessionId, "confirm"));
  }, []);

  const clearConfirmSlot = useCallback((sessionId: string): void => {
    setInFlightSlots(prev => removeInFlightAction(prev, sessionId, "confirm"));
  }, []);

  return {
    cancelDialogSessionId,
    disputeDialogSessionId,
    inFlightSlots,
    openCancelDialog,
    closeCancelDialog,
    openDisputeDialog,
    closeDisputeDialog,
    claimConfirmSlot,
    clearConfirmSlot,
  };
}
