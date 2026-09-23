"use client";

import { useMutation } from "@apollo/client/react";
import { useCallback, useRef, useState } from "react";
import type { AdminSessionsQuery_adminSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminSessionCancelMutationDocument,
  adminSessionReassignMutationDocument,
  adminSessionRescheduleMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import type { GovernanceDialogState } from "@/frontend/views/admin/session-governance/AdminSessionGovernanceDialogs";
import type { ReschedulePair } from "@/frontend/views/admin/session-governance/RescheduleSessionDialog";
import { AdminSessionGovernance, Errors, useAppTranslation } from "@/shared/locale";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * useAdminSessionGovernanceActions — the write tier of the admin
 * session-governance container: the three governance-dialog
 * mutations (`adminRescheduleSession` / `adminCancelSession` /
 * `adminReassignTeacher`), the dialog state they open/close, the transient
 * snackbar notice slot, and the cancel idempotency claim. The join mutation
 * (drawer-banner flow, dialog-less) lives in
 * `useAdminSessionGovernanceJoin`.
 *
 * Mutation outcomes — EVERY arm surfaces a snackbar; the returned
 * `Session!` payloads auto-merge onto the cached directory entities by id
 * (no refetch): success closes the dialog + success notice;
 * `SESSION_NOT_FOUND` / `SESSION_INVALID_TRANSITION` close the dialog with
 * an error notice (a raced concurrent governance action makes the dialog's
 * premise stale — the merged payload updates the row in place);
 * `VALIDATION` / `FORBIDDEN` / masked failures keep the dialog open for a
 * corrected submit. The specific boundary denials
 * (`TEACHER_NOT_FOUND` / `TEACHER_NOT_CERTIFIED` /
 * `SESSION_RESCHEDULE_WINDOW_INVALID` / `SESSION_RESCHEDULE_START_IN_PAST`)
 * surface their OWN errors-namespace copy — never the directory-load
 * fallback. Codes classify through `extractErrorCode` +
 * `normalizeGraphQLErrorCode` — the server `message` is NEVER echoed.
 *
 * Cancel idempotency — each logical cancel attempt mints ONE
 * `crypto.randomUUID()` key when the dialog opens (the openDialog event
 * handler — the only ref write) and the submit handler threads it at call
 * time via the Apollo context header `x-idempotency-key` (the broadcasts
 * compose-send precedent); a retried submit stays on the SAME claim (server
 * replay dedupe) and a settled attempt can never leak its claim onward —
 * success closes the dialog while every open mints fresh, so no effect- or
 * hook-config-based rotation exists.
 */

/** Wire code family — a raced concurrent governance action (row gone / state moved). */
const SESSION_INVALID_TRANSITION_CODE = "SESSION_INVALID_TRANSITION";

/** One transient container-level notice rendered in the MUI Snackbar slot. */
type ContainerNotice = { readonly message: string; readonly severity: "success" | "info" | "error" };

/** Classifies a governance-mutation failure against the localized error copy. */
export function classifyMutationFailure(
  mutationError: unknown,
  t: AdminSessionGovernanceLabels,
  te: ErrorsLabels
): { readonly kind: "race" | "retryable"; readonly message: string } {
  const rawCode = extractErrorCode(mutationError);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
  if (code === SESSION_INVALID_TRANSITION_CODE) {
    return { kind: "race", message: te.sessionInvalidTransition };
  }
  // The directory detail read answers an absent row with data, but the
  // write tier still races: a concurrently-deleted target surfaces here.
  if (code === "SESSION_NOT_FOUND" || code === "NOT_FOUND") {
    return { kind: "race", message: te.sessionNotFound };
  }
  if (code === "TEACHER_NOT_CERTIFIED") {
    return { kind: "retryable", message: te.teacherNotCertified };
  }
  // Specific boundary denials surface their OWN errors-namespace copy —
  // never the directory-load fallback — so the operator learns WHICH
  // rule fired, not merely that something failed.
  if (code === "TEACHER_NOT_FOUND") {
    return { kind: "retryable", message: te.teacherNotFound };
  }
  if (code === "SESSION_RESCHEDULE_WINDOW_INVALID") {
    return { kind: "retryable", message: te.sessionRescheduleWindowInvalid };
  }
  if (code === "SESSION_RESCHEDULE_START_IN_PAST") {
    return { kind: "retryable", message: te.sessionRescheduleStartInPast };
  }
  if (code === "VALIDATION") {
    return { kind: "retryable", message: te.validation };
  }
  if (code === "FORBIDDEN") {
    return { kind: "retryable", message: te.forbidden };
  }
  return { kind: "retryable", message: t.errorTitle };
}

/**
 * Shared dialog-mutation failure arm — a raced concurrent action (row gone
 * / state moved) makes the dialog's premise STALE: close it with the error
 * notice (the returned `Session!` payload already merged the new state onto
 * the cached row where one arrived); every retryable failure keeps the
 * dialog open for a corrected submit with its own notice.
 */
function routeDialogMutationFailure(
  mutationError: unknown,
  t: AdminSessionGovernanceLabels,
  te: ErrorsLabels,
  closeWithNotice: (message: string, severity: "success" | "error") => void,
  onNotice: (message: string, severity: "success" | "error") => void
): void {
  const classified = classifyMutationFailure(mutationError, t, te);
  if (classified.kind === "race") {
    closeWithNotice(classified.message, "error");
    return;
  }
  onNotice(classified.message, "error");
}

/**
 * The transient snackbar notice slot of the admin session-governance
 * container: one notice at a time plus its plain arms (dismiss / set).
 * Presentation stays in `SessionNoticeSnackbar`; this module returns plain
 * state — no JSX.
 */
function useAdminSessionGovernanceNotice() {
  const [notice, setNotice] = useState<ContainerNotice | null>(null);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const noticeArm = useCallback((message: string, severity: "success" | "error"): void => {
    setNotice({ message, severity });
  }, []);

  return { notice, dismissNotice, noticeArm, setNotice };
}

/**
 * Owns the dialog-flow governance mutations + the dialog state of the
 * admin session-governance container. Returns plain state + triggers —
 * no JSX (the dialog slot renders them:
 * {@link AdminSessionGovernanceDialogs}; the drawer banner wiring stays in
 * the container).
 */
export function useAdminSessionGovernanceActions() {
  const t = useAppTranslation(AdminSessionGovernance);
  const te = useAppTranslation(Errors);
  const { notice, dismissNotice, noticeArm, setNotice } = useAdminSessionGovernanceNotice();

  const [dialog, setDialog] = useState<GovernanceDialogState | null>(null);
  const cancelKeyRef = useRef<string>(crypto.randomUUID());

  const closeDialog = useCallback((): void => {
    setDialog(null);
  }, []);

  const openDialog = useCallback(
    (kind: GovernanceDialogState["kind"], session: AdminSessionsQuery_adminSessions_items): void => {
      setDialog({ kind, session });
      if (kind === "cancel") {
        // One idempotency key per LOGICAL cancel attempt — minted HERE, in
        // the event handler that opens the attempt (event-handler ref write;
        // the submit handler only reads it at call time — see the docblock):
        // a retried submit rides the SAME claim (server replay dedupe) and
        // a settled attempt can never leak its claim onward, because success
        // closes the dialog while every open mints fresh.
        cancelKeyRef.current = crypto.randomUUID();
      }
    },
    []
  );

  /** Terminal dialog arm — its notice (success or race-error) + close. */
  const closeDialogWithNotice = useCallback(
    (message: string, severity: "success" | "error"): void => {
      setNotice({ message, severity });
      setDialog(null);
    },
    [setNotice]
  );

  // ---- dialog mutations (the container's write tier; join lives apart) -----
  const [commitReschedule, rescheduleMutation] = useMutation(adminSessionRescheduleMutationDocument, {
    onCompleted: () => closeDialogWithNotice(t.rescheduleSuccess, "success"),
    onError: mutationError => routeDialogMutationFailure(mutationError, t, te, closeDialogWithNotice, noticeArm),
  });

  const [commitCancel, cancelMutation] = useMutation(adminSessionCancelMutationDocument, {
    onCompleted: () => closeDialogWithNotice(t.cancelSuccess, "success"),
    onError: mutationError => routeDialogMutationFailure(mutationError, t, te, closeDialogWithNotice, noticeArm),
  });

  const [commitReassign, reassignMutation] = useMutation(adminSessionReassignMutationDocument, {
    onCompleted: () => closeDialogWithNotice(t.reassignSuccess, "success"),
    onError: mutationError => routeDialogMutationFailure(mutationError, t, te, closeDialogWithNotice, noticeArm),
  });

  // ---- dialog submit intents (the session id threads at CALL time) ---------
  const submitReschedule = (sessionId: string, pair: ReschedulePair): void => {
    void commitReschedule({ variables: { input: { sessionId, ...pair } } });
  };

  const submitCancel = (sessionId: string, reason: string | null): void => {
    // The attempt's claim is read at CALL time inside this event handler
    // and threaded directly into the mutation context — the header the
    // authLink merges into the outgoing request.
    void commitCancel({
      variables: { input: { sessionId, reason } },
      context: { headers: { "x-idempotency-key": cancelKeyRef.current } },
    });
  };

  const submitReassign = (sessionId: string, newTeacherUserId: number): void => {
    void commitReassign({ variables: { input: { sessionId, newTeacherUserId } } });
  };

  return {
    dialog,
    openDialog,
    closeDialog,
    notice,
    dismissNotice,
    noticeArm,
    rescheduleLoading: rescheduleMutation.loading,
    cancelLoading: cancelMutation.loading,
    reassignLoading: reassignMutation.loading,
    submitReschedule,
    submitCancel,
    submitReassign,
  };
}
