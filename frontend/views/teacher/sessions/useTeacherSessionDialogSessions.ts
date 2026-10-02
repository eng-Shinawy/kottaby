"use client";

/**
 * The keyed dialog sessions of the teacher sessions surface — one state
 * triple per dialog (case / report / rubric / prep) with their open/close
 * intents, split out of `TeacherSessionsContainer.tsx` (lint caps). Pure
 * session-id state: each dialog mounts keyed by session id and reads its
 * own data.
 */

import { useCallback, useState } from "react";

/** The keyed session-id state + open/close intents of the surface's dialogs. */
export function useTeacherSessionDialogSessions(): {
  caseDialogSessionId: string | null;
  openCaseDialog: (sessionId: string) => void;
  closeCaseDialog: () => void;
  reportDialogSessionId: string | null;
  openReportDialog: (sessionId: string) => void;
  closeReportDialog: () => void;
  /** The homework CTA shares the report dialog's session slot. */
  openHomeworkDialog: (sessionId: string) => void;
  rubricDialogSessionId: string | null;
  openRubricDialog: (sessionId: string) => void;
  closeRubricDialog: () => void;
  /** The preparation glance's own dialog slot (scheduled tajweed rows). */
  prepDialogSessionId: string | null;
  openPrepDialog: (sessionId: string) => void;
  closePrepDialog: () => void;
} {
  const [caseDialogSessionId, setCaseDialogSessionId] = useState<string | null>(null);
  const [reportDialogSessionId, setReportDialogSessionId] = useState<string | null>(null);
  const [rubricDialogSessionId, setRubricDialogSessionId] = useState<string | null>(null);
  const openCaseDialog = useCallback((sessionId: string) => setCaseDialogSessionId(sessionId), []);
  const closeCaseDialog = useCallback(() => setCaseDialogSessionId(null), []);
  const openReportDialog = useCallback((sessionId: string) => setReportDialogSessionId(sessionId), []);
  const closeReportDialog = useCallback(() => setReportDialogSessionId(null), []);
  const openHomeworkDialog = useCallback((sessionId: string) => setReportDialogSessionId(sessionId), []);
  const openRubricDialog = useCallback((sessionId: string) => setRubricDialogSessionId(sessionId), []);
  const closeRubricDialog = useCallback(() => setRubricDialogSessionId(null), []);
  const [prepDialogSessionId, setPrepDialogSessionId] = useState<string | null>(null);
  const openPrepDialog = useCallback((sessionId: string) => setPrepDialogSessionId(sessionId), []);
  const closePrepDialog = useCallback(() => setPrepDialogSessionId(null), []);
  return {
    caseDialogSessionId,
    openCaseDialog,
    closeCaseDialog,
    reportDialogSessionId,
    openReportDialog,
    closeReportDialog,
    openHomeworkDialog,
    rubricDialogSessionId,
    openRubricDialog,
    closeRubricDialog,
    prepDialogSessionId,
    openPrepDialog,
    closePrepDialog,
  };
}
