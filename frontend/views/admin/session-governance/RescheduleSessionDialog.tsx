"use client";

import { TextField } from "@mui/material";
import { type ReactNode, useState } from "react";
import type { AdminSessionsQuery_adminSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import {
  GovernanceDialogActions,
  GovernanceFormDialog,
} from "@/frontend/views/admin/session-governance/dialogFormAtoms";
import { isoToDatetimeLocalToken } from "@/frontend/views/admin/session-governance/sessionTypePresentation";
import { SessionDialogWarningCallout } from "@/frontend/views/student/sessions/SessionDialogWarningCallout";
import { AdminSessionGovernance, Common, Errors, useAppTranslation } from "@/shared/locale";

/**
 * RescheduleSessionDialog — the admin reschedule seam for one governance
 * session (`/admin/session-governance`). Structural
 * sibling of the arbitration dialog: portal/dialog/form discipline,
 * `React.SubmitEvent`, dismissal gated while the mutation is in flight
 * (the shared {@link GovernanceFormDialog} / {@link GovernanceDialogActions}
 * atoms carry that shell).
 *
 * Date inputs — native `datetime-local` TextFields (NO `@mui/x-date-pickers`
 * dependency exists in the tree, and the `AppDatePicker`/`AppTimePicker`
 * components referenced by `COMPONENT_PATTERNS.md` do not exist — plain
 * date fields are the established zero-dependency seam). Tokens convert to
 * ISO-8601 UTC instants at the submit seam (`DateTime` scalar wire shape);
 * the prefill converter (`isoToDatetimeLocalToken`) lives beside the
 * surface's shared presentation tables (`sessionTypePresentation`), keeping
 * this file's exports component-only.
 *
 * Client validation mirrors the service rules: the pair must be
 * ordered (`startedAt < endedAt`) and the start may not sit further than
 * the 5-minute grace window in the past — the SAME envelope the backend
 * enforces (`RESCHEDULE_START_PAST_GRACE_MS`), surfacing the localized
 * errors copy on the start field BEFORE the mutation fires. The mutation
 * itself and its error classification live in the container; this dialog
 * stays open on every failure arm for a corrected submit.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby` + focusable fields).
 */

/** Reschedule grace mirror — the replacement start may sit ≤5 min in the past. */
const RESCHEDULE_PAST_GRACE_MS = 5 * 60 * 1000;

/**
 * Client mirror of the reschedule validation envelope (service rules): the
 * pair must be ordered AND the start may not sit further than the grace
 * window in the past. Returns the localized message, or null when valid.
 */
function validateReschedulePair(
  startedAtIso: string,
  endedAtIso: string,
  tErrors: {
    readonly sessionRescheduleWindowInvalid: string;
    readonly sessionRescheduleStartInPast: string;
  }
): string | null {
  const startedMs = new Date(startedAtIso).getTime();
  const endedMs = new Date(endedAtIso).getTime();
  if (Number.isNaN(startedMs) || Number.isNaN(endedMs) || startedMs >= endedMs) {
    return tErrors.sessionRescheduleWindowInvalid;
  }
  if (startedMs < Date.now() - RESCHEDULE_PAST_GRACE_MS) {
    return tErrors.sessionRescheduleStartInPast;
  }
  return null;
}

/** The submit payload the container forwards to `adminRescheduleSession`. */
export interface ReschedulePair {
  readonly startedAt: string;
  readonly endedAt: string;
}

interface RescheduleSessionDialogProps {
  /** The session being rescheduled (prefills the current timing pair). */
  readonly session: AdminSessionsQuery_adminSessions_items;
  readonly open: boolean;
  /**
   * Dismiss intent (cancel Button / backdrop click / Escape) — ignored
   * while the reschedule mutation is pending.
   */
  readonly onClose: () => void;
  /** True while the container's reschedule mutation is in flight. */
  readonly loading: boolean;
  /** Validated submit intent — receives ISO-8601 UTC instants. */
  readonly onSubmit: (pair: ReschedulePair) => void;
}

/** Confirm-and-reschedule dialog (timing pair + service-rule mirror). */
export function RescheduleSessionDialog({
  session,
  open,
  onClose,
  loading,
  onSubmit,
}: Readonly<RescheduleSessionDialogProps>): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);
  const tc = useAppTranslation(Common);
  const te = useAppTranslation(Errors);

  const [startedAtToken, setStartedAtToken] = useState<string>(() => isoToDatetimeLocalToken(session.startedAt));
  const [endedAtToken, setEndedAtToken] = useState<string>(() => isoToDatetimeLocalToken(session.endedAt));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading || startedAtToken === "" || endedAtToken === "") return;
    const startedAtIso = new Date(startedAtToken).toISOString();
    const endedAtIso = new Date(endedAtToken).toISOString();
    const invalidMessage = validateReschedulePair(startedAtIso, endedAtIso, te);
    if (invalidMessage !== null) {
      setValidationMessage(invalidMessage);
      return;
    }
    setValidationMessage(null);
    onSubmit({ startedAt: startedAtIso, endedAt: endedAtIso });
  };

  return (
    <GovernanceFormDialog
      open={open}
      onClose={onClose}
      loading={loading}
      onSubmit={handleSubmit}
      titleId="reschedule-session-dialog-title"
      title={t.rescheduleTitle}
      actions={
        <GovernanceDialogActions
          onClose={onClose}
          loading={loading}
          cancelLabel={tc.cancel}
          submitLabel={t.rescheduleSubmit}
          submitTestId="reschedule-session-submit"
          submitDisabled={startedAtToken === "" || endedAtToken === ""}
        />
      }
    >
      <SessionDialogWarningCallout message={t.rescheduleBody} />
      <TextField
        label={t.rescheduleStartLabel}
        type="datetime-local"
        value={startedAtToken}
        onChange={event => {
          setStartedAtToken(event.target.value);
          setValidationMessage(null);
        }}
        required
        error={validationMessage !== null}
        helperText={validationMessage ?? undefined}
        aria-invalid={validationMessage !== null}
        data-testid="reschedule-session-start"
        slotProps={{
          htmlInput: { autoComplete: "off" },
          // Native datetime-local inputs ALWAYS paint their segment text —
          // the un-shrunk label would sit on top of it (plus Chrome's picker
          // indicator). Keep the label pinned to the notch instead.
          inputLabel: { shrink: true },
        }}
      />
      <TextField
        label={t.rescheduleEndLabel}
        type="datetime-local"
        value={endedAtToken}
        onChange={event => {
          setEndedAtToken(event.target.value);
          setValidationMessage(null);
        }}
        required
        data-testid="reschedule-session-end"
        slotProps={{
          htmlInput: { autoComplete: "off" },
          inputLabel: { shrink: true },
        }}
      />
    </GovernanceFormDialog>
  );
}
