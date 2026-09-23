"use client";

/**
 * useSubscriptionDialogController — the subscription-management section's
 * lifecycle-dialog state machine: which dialog is open and for which row,
 * plus the shared submit pipeline every dialog flows through.
 *
 * Contract (shared with `useSubscriptionAdminActions`): a submit action
 * resolves `null` on success (the hook already refetched + toasted) and
 * the dialog closes; a string is the server-localized denial, pinned onto
 * the open dialog's inline alert until dismissed or corrected. Opening a
 * dialog always starts from a clean error slate.
 */
import { useCallback, useState } from "react";
import type { SubscriptionRow } from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";

/** Which lifecycle dialog the section wants open. */
export type OpenSubscriptionDialogKind = "extend" | "renew" | "cancel" | "changePlan";

/** The open dialog: its kind and the addressed subscription row. */
interface OpenSubscriptionDialog {
  readonly kind: OpenSubscriptionDialogKind;
  readonly row: SubscriptionRow;
}

/** The dialog state machine the section and its dialog host consume. */
export interface SubscriptionDialogController {
  /** The currently open dialog, or `null` when the section is idle. */
  readonly openDialog: OpenSubscriptionDialog | null;
  /** The server-localized denial pinned onto the open dialog (`null` = none). */
  readonly actionError: string | null;
  /** Opens a lifecycle dialog for a row (clears any pinned denial). */
  readonly openDialogFor: (kind: OpenSubscriptionDialogKind, row: SubscriptionRow) => void;
  /** Dismisses the open dialog and clears the pinned denial. */
  readonly closeDialog: () => void;
  /**
   * Runs one lifecycle submit: `null` resolves the dialog; a string pins
   * the denial onto the open dialog's inline alert.
   */
  readonly runAction: (run: () => Promise<string | null>) => Promise<void>;
}

export function useSubscriptionDialogController(): SubscriptionDialogController {
  const [openDialog, setOpenDialog] = useState<OpenSubscriptionDialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openDialogFor = useCallback((kind: OpenSubscriptionDialogKind, row: SubscriptionRow): void => {
    setActionError(null);
    setOpenDialog({ kind, row });
  }, []);

  const closeDialog = useCallback((): void => {
    setOpenDialog(null);
    setActionError(null);
  }, []);

  const runAction = useCallback(async (run: () => Promise<string | null>): Promise<void> => {
    const failure = await run();
    if (failure === null) {
      setOpenDialog(null);
      setActionError(null);
    } else {
      setActionError(failure);
    }
  }, []);

  return { openDialog, actionError, openDialogFor, closeDialog, runAction };
}
