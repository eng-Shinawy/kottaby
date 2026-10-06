import { useCallback, useState } from "react";
import type { MyStudentSessionsQuery_myStudentSessions_items } from "@/frontend/graphql/generated/gql/graphql";

/**
 * The session-details dialog slot: the id of the session whose details are
 * on view (or `null` when closed) plus its open/close intents. The shape is
 * the case-dialog slot's (`useStudentSessionCaseDialogSlot`) verbatim — one
 * stateful id, stateless dialogs — because the dialog owns its own
 * `sessionById` read. The dialog additionally needs the CLICKED LIST ROW
 * (the counterpart bands are populated only by the list producers;
 * `sessionById` stays band-free by design), so each container re-reads the
 * row from its own settled list payload through `resolveSessionRowById`
 * while the slot keeps carrying ONLY the identity.
 */
export function useSessionDetailsDialogSlot(): {
  readonly detailsSessionId: string | null;
  readonly openDetailsDialog: (sessionId: string) => void;
  readonly closeDetailsDialog: () => void;
} {
  const [detailsSessionId, setDetailsSessionId] = useState<string | null>(null);
  const openDetailsDialog = useCallback((sessionId: string): void => {
    setDetailsSessionId(sessionId);
  }, []);
  const closeDetailsDialog = useCallback((): void => {
    setDetailsSessionId(null);
  }, []);
  return { detailsSessionId, openDetailsDialog, closeDetailsDialog };
}

/**
 * The list-item shape the details slot's row lookup feeds (the student
 * item type — the teacher list's items are its structurally identical
 * codegen twin, the same identity `SessionRow` rides).
 */
export type SessionDetailsRowPayload = MyStudentSessionsQuery_myStudentSessions_items;
