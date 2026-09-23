import { useCallback, useState } from "react";

/**
 * The dispute case-dialog slot state: the session id whose case is on
 * view (or `null` when closed) plus its open/close intents. The dialog is
 * stateless per session — it owns its own case query — so the container
 * keeps ONLY the id (the teacher container's identical slot shape).
 */
export function useStudentSessionCaseDialogSlot(): {
  readonly caseDialogSessionId: string | null;
  readonly openCaseDialog: (sessionId: string) => void;
  readonly closeCaseDialog: () => void;
} {
  const [caseDialogSessionId, setCaseDialogSessionId] = useState<string | null>(null);
  const openCaseDialog = useCallback((sessionId: string): void => {
    setCaseDialogSessionId(sessionId);
  }, []);
  const closeCaseDialog = useCallback((): void => {
    setCaseDialogSessionId(null);
  }, []);
  return { caseDialogSessionId, openCaseDialog, closeCaseDialog };
}
