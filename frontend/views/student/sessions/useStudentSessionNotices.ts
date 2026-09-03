import { useCallback, useState } from "react";

/** One transient container-level notice rendered in the MUI Snackbar slot. */
export interface ContainerNotice {
  readonly message: string;
  readonly severity: "success" | "info" | "error";
}

/** Removes one row-scoped alert entry (pure — stable `useCallback` deps). */
export function dropRowAlert(
  alerts: Readonly<Record<string, string>>,
  sessionId: string
): Readonly<Record<string, string>> {
  if (!(sessionId in alerts)) return alerts;
  return Object.fromEntries(Object.entries(alerts).filter(([id]) => id !== sessionId));
}

/** Narrow setter shapes the outcome arms + confirm wiring consume. */
export interface StudentSessionNoticeWiring {
  readonly setRowAlerts: (
    updater: (prev: Readonly<Record<string, string>>) => Readonly<Record<string, string>>
  ) => void;
  readonly setNotice: (notice: ContainerNotice) => void;
}

/** The transient feedback state owned by this hook. */
export interface StudentSessionNotices extends StudentSessionNoticeWiring {
  /** sessionId → inline row alert copy (e.g. SESSION_INVALID_TRANSITION). */
  readonly rowAlerts: Readonly<Record<string, string>>;
  /** Single transient notice slot (success / info / error snackbar). */
  readonly notice: ContainerNotice | null;
  readonly dismissNotice: () => void;
}

/**
 * Row-scoped inline alerts + the single transient snackbar notice for the
 * student sessions container. Feedback surfaces use plain MUI
 * `Snackbar`/`Alert` (the same snackbar machinery as the app-scope
 * `GraphQLErrorSurfaceHost`; no notistack, no Zustand).
 */
export function useStudentSessionNotices(): StudentSessionNotices {
  const [rowAlerts, setRowAlerts] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<ContainerNotice | null>(null);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  return { rowAlerts, notice, setRowAlerts, setNotice, dismissNotice };
}
