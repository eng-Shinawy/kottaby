/**
 * Governance actions helpers — pure functions extracted from
 * `useGovernanceActions` so the hook module stays under the
 * `max-lines` (150) cap for `frontend/views/**` files.
 */

import type { SubmitEventHandler } from "react";
import { extractErrorCode, extractErrorMessage, extractFieldErrors } from "@/frontend/lib/graphql-error-utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

export type ActionKind = "suspend" | "unsuspend" | "block" | "unblock";
export type Copy = AdminUsersLabels["governanceActions"];
export type InlineAlert = { readonly severity: "info" | "warning"; readonly message: string };

export interface DialogMeta {
  readonly title: string;
  readonly message: string;
  readonly confirmColor: "warning" | "error" | "primary";
}

const PERIOD_MIN = 1;
const PERIOD_MAX = 3650;

export function isValidPeriodDays(raw: string): boolean {
  if (raw.trim() === "") return false;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= PERIOD_MIN && parsed <= PERIOD_MAX;
}

/** Conflict code → inline Alert severity (REQ-065 matrix). */
export function alertSeverity(code: string | null): "info" | "warning" {
  return code === "USER_ALREADY_DELETED" ? "warning" : "info";
}

export function metaFor(copy: Copy, action: ActionKind): DialogMeta {
  switch (action) {
    case "suspend":
      return { title: copy.suspendDialogTitle, message: copy.suspendDialogMessage, confirmColor: "warning" };
    case "unsuspend":
      return { title: copy.unsuspendDialogTitle, message: copy.unsuspendDialogMessage, confirmColor: "primary" };
    case "block":
      return { title: copy.blockDialogTitle, message: copy.blockDialogMessage, confirmColor: "error" };
    default:
      return { title: copy.unblockDialogTitle, message: copy.unblockDialogMessage, confirmColor: "primary" };
  }
}

/** Server-error → inline state mutation. Encapsulates the conflict-code routing matrix. */
export function buildRouteError(
  setDaysErr: (msg: string | null) => void,
  setAlert: (a: InlineAlert | null) => void
): (err: unknown) => void {
  return err => {
    const code = extractErrorCode(err);
    if (code === "FORBIDDEN") return undefined;
    if (code === "VALIDATION") {
      const periodMsg = extractFieldErrors(err).periodDays;
      if (periodMsg !== undefined) {
        setDaysErr(periodMsg);
        return undefined;
      }
    }
    setAlert({ severity: alertSeverity(code), message: extractErrorMessage(err) ?? "" });
    return undefined;
  };
}

/**
 * Submit-handler factory — branches per `openAction` kind, invoking the
 * supplied mutation runners + clearing dialog state on completion.
 */
export function buildSubmitHandler(
  openAction: ActionKind | null,
  copy: Copy,
  userId: number,
  days: string,
  setDaysErr: (msg: string | null) => void,
  setAlert: (a: InlineAlert | null) => void,
  complete: (toast: string) => void,
  routeError: (err: unknown) => void,
  suspendMut: (opts: {
    variables: { id: number; suspended: boolean; periodDays: number | null };
    onCompleted: () => void;
    onError: (e: unknown) => void;
  }) => Promise<unknown>,
  blockMut: (opts: {
    variables: { id: number; blocked: boolean };
    onCompleted: () => void;
    onError: (e: unknown) => void;
  }) => Promise<unknown>
): SubmitEventHandler<HTMLFormElement> {
  return event => {
    event.preventDefault();
    if (openAction === null) return undefined;
    setAlert(null);
    const id = userId;
    if (openAction === "suspend") {
      if (!isValidPeriodDays(days)) {
        setDaysErr(copy.suspendPeriodHelper);
        return undefined;
      }
      setDaysErr(null);
      void suspendMut({
        variables: { id, suspended: true, periodDays: Number(days) },
        onCompleted: () => complete(copy.suspendSuccessToast),
        onError: routeError,
      });
    } else if (openAction === "unsuspend") {
      void suspendMut({
        variables: { id, suspended: false, periodDays: null },
        onCompleted: () => complete(copy.unsuspendSuccessToast),
        onError: routeError,
      });
    } else if (openAction === "block") {
      void blockMut({
        variables: { id, blocked: true },
        onCompleted: () => complete(copy.blockSuccessToast),
        onError: routeError,
      });
    } else {
      void blockMut({
        variables: { id, blocked: false },
        onCompleted: () => complete(copy.unblockSuccessToast),
        onError: routeError,
      });
    }
    return undefined;
  };
}
