import { useCallback } from "react";
import {
  dropRowAlert,
  type StudentSessionNoticeWiring,
} from "@/frontend/views/student/sessions/useStudentSessionNotices";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** Copy handles + shared setters + the dialog close + the rated marker the arms ride on. */
export interface StudentSessionRateArmsDeps extends StudentSessionNoticeWiring {
  /** `Sessions` namespace labels (compile-time i18n handles). */
  readonly sessionsCopy: SessionsLabels;
  /** `Errors` namespace labels (compile-time i18n handles). */
  readonly errorsCopy: ErrorsLabels;
  /** Closes the rate dialog slot (every terminal rate outcome). */
  readonly closeRateDialog: () => void;
  /** Marks one session rated in the rated-set hook (write-once reject arm). */
  readonly markSessionRated: (sessionId: number) => void;
}

/** The rate-dialog outcome arms consumed by `RateTeacherDialog`. */
export interface StudentSessionRateArms {
  /** success → `sessions.rateTeacherSuccess` snackbar (the cache already carries the rating) */
  readonly handleRated: (sessionId: string) => void;
  /** `SESSION_NOT_FOUND` → `errors.sessionNotFound` snackbar (eviction owned by the dialog) */
  readonly handleSessionMissing: (sessionId: string) => void;
  /** gate reject → the localized notice renders app-scope; the dialog closes */
  readonly handleSessionNotCompleted: (sessionId: string) => void;
  /** write-once reject → the row flips to its rated state; the localized notice renders app-scope */
  readonly handleAlreadySubmitted: (sessionId: string) => void;
  /** anything else → error snackbar with the dialog-resolved copy; the dialog stays open for a retry */
  readonly handleFailure: (message: string) => void;
}

/**
 * Rate-dialog outcome arms (the container wiring table): every terminal arm
 * drops the row's stale inline alert and closes the dialog slot;
 * `handleSessionNotCompleted` / `handleAlreadySubmitted` render their
 * localized notices through the mapped error surface (app-scope), so their
 * local arms only carry the dialog-slot + rated-marker bookkeeping;
 * `handleFailure` deliberately leaves the dialog open for a retry (its own
 * documented contract).
 */
export function useStudentSessionRateArms(deps: Readonly<StudentSessionRateArmsDeps>): StudentSessionRateArms {
  const { sessionsCopy: t, errorsCopy: te, closeRateDialog, markSessionRated, setRowAlerts, setNotice } = deps;

  const handleRated = useCallback(
    (sessionId: string): void => {
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: t.rateTeacherSuccess, severity: "success" });
      closeRateDialog();
    },
    [t, closeRateDialog, setRowAlerts, setNotice]
  );

  const handleSessionMissing = useCallback(
    (sessionId: string): void => {
      // Cache eviction + list filtering are owned by the dialog's
      // SESSION_NOT_FOUND arm — the row has already left the list here.
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      setNotice({ message: te.sessionNotFound, severity: "error" });
      closeRateDialog();
    },
    [te, closeRateDialog, setRowAlerts, setNotice]
  );

  const handleSessionNotCompleted = useCallback(
    (sessionId: string): void => {
      // The rejection notice renders through the mapped error surface
      // (app-scope) — the local arm only drops the stale alert + closes.
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      closeRateDialog();
    },
    [closeRateDialog, setRowAlerts]
  );

  const handleAlreadySubmitted = useCallback(
    (sessionId: string): void => {
      // The write-once rejection PROVES the rating exists — mark the row
      // rated so the Rate CTA yields to the rated chip without a refetch.
      // The rejection notice renders through the mapped error surface.
      markSessionRated(Number(sessionId));
      setRowAlerts(prev => dropRowAlert(prev, sessionId));
      closeRateDialog();
    },
    [markSessionRated, closeRateDialog, setRowAlerts]
  );

  const handleFailure = useCallback(
    (message: string): void => {
      setNotice({ message, severity: "error" });
      // The dialog stays open for a retry (its own documented contract).
    },
    [setNotice]
  );

  return { handleRated, handleSessionMissing, handleSessionNotCompleted, handleAlreadySubmitted, handleFailure };
}
