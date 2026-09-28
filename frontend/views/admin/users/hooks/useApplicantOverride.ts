"use client";

/**
 * useApplicantOverride — state + mutation orchestration for the
 * ApplicantOverrideSection (the admin applicant-evaluation override
 * affordance on the user DETAIL page).
 *
 * One hook instance serves all three override directions: `startAction`
 * opens the dialog pre-set to a direction (certify / grant re-evaluation /
 * reject). The dialog owns the inline conflict `Alert` and one
 * `useMutation` call against the `AdminOverrideApplicantEvaluation`
 * document. Only the reject direction renders the cooldown-days field
 * (REQUIRED, client-mirrored 1..3650 gate) — the other two enable the
 * confirm button immediately and send no `cooldownDays` argument (the
 * `adminSetUserSuspended` periodDays precedent).
 *
 * Apollo merges the post-write `ApplicantProfile` into the SAME
 * `ApplicantProfile:<id>` normalized entry the detail query's `applicant`
 * field links to (id-first selection) — the snapshot card re-renders
 * WITHOUT a refetch.
 *
 * Conflict routing lives in `applicant-override-helpers`
 * (`buildOverrideRouteError`): FORBIDDEN → suppressed inline (global toast
 * path); `APPLICANT_OVERRIDE_COOLDOWN_INVALID` / VALIDATION → field-level
 * `helperText`; any other typed domain rejection → in-dialog info `Alert`
 * carrying the SERVER-localized message.
 *
 * i18n: this hook accepts the resolved `Copy` object so it stays
 * pure-logic and trivially unit-testable (same discipline as
 * `useCooldownExtension` / `useGovernanceActions`).
 */

import { useMutation } from "@apollo/client/react";
import { type SubmitEventHandler, useState } from "react";
import { adminOverrideApplicantEvaluationMutationDocument } from "@/frontend/graphql/sharedDocuments/admin";
import {
  buildOverrideRouteError,
  isValidOverrideDays,
  metaForOverride,
  type OverrideAction,
  type OverrideActionMeta,
  type OverrideCopy,
  type OverrideInlineAlert,
  overrideUsesDays,
  successToastOf,
} from "@/frontend/views/admin/users/hooks/applicant-override-helpers";

export interface ApplicantOverrideApi {
  /** Dialog-open direction, `null` while the dialog is closed. */
  readonly action: OverrideAction | null;
  /** Per-action dialog chrome (null while closed). */
  readonly meta: OverrideActionMeta | null;
  readonly days: string;
  readonly daysErr: string | null;
  readonly alert: OverrideInlineAlert | null;
  readonly inFlight: boolean;
  /** Reject-only: the cooldown-days field renders for this direction. */
  readonly daysVisible: boolean;
  readonly confirmDisabled: boolean;
  readonly startAction: (action: OverrideAction) => void;
  readonly closeDialog: () => void;
  readonly onDaysChange: (value: string) => void;
  readonly clearAlert: () => void;
  readonly handleSubmit: SubmitEventHandler<HTMLFormElement>;
}

export interface UseApplicantOverrideArgs {
  readonly applicantId: number;
  readonly copy: OverrideCopy;
  readonly onToast: (message: string) => void;
}

export function useApplicantOverride({ applicantId, copy, onToast }: UseApplicantOverrideArgs): ApplicantOverrideApi {
  const [action, setAction] = useState<OverrideAction | null>(null);
  const [days, setDays] = useState("");
  const [daysErr, setDaysErr] = useState<string | null>(null);
  const [alert, setAlert] = useState<OverrideInlineAlert | null>(null);
  const [overrideMut, { loading: inFlight }] = useMutation(adminOverrideApplicantEvaluationMutationDocument);

  const daysVisible = action !== null && overrideUsesDays(action);
  const confirmDisabled = inFlight || (daysVisible && !isValidOverrideDays(days));
  const meta = action === null ? null : metaForOverride(copy, action);

  const closeDialog = (): void => {
    if (inFlight) return;
    setAction(null);
    setAlert(null);
    setDaysErr(null);
    setDays("");
  };
  const startAction = (next: OverrideAction): void => {
    setAlert(null);
    setDaysErr(null);
    setDays("");
    setAction(next);
  };
  const onDaysChange = (value: string): void => {
    setDays(value);
    if (daysErr !== null) setDaysErr(null);
  };
  const clearAlert = (): void => setAlert(null);
  const complete = (toast: string): void => {
    setAction(null);
    setDays("");
    onToast(toast);
  };
  const routeError = buildOverrideRouteError(setDaysErr, setAlert);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = event => {
    event.preventDefault();
    setAlert(null);
    if (action === null) return undefined;
    if (daysVisible && !isValidOverrideDays(days)) {
      setDaysErr(copy.daysHelper);
      return undefined;
    }
    setDaysErr(null);
    const toast = successToastOf(copy, action);
    void overrideMut({
      variables: {
        applicantId,
        action,
        // `cooldownDays` rides the wire ONLY for the reject direction —
        // certify / grant_re_evaluation ignore it server-side. The explicit
        // `null` (vs a conditional omit) satisfies the generated variables
        // contract where the reject arm REQUIRES the key.
        cooldownDays: daysVisible ? Number(days) : null,
      },
      onCompleted: () => complete(toast),
      onError: routeError,
    });
    return undefined;
  };

  return {
    action,
    meta,
    days,
    daysErr,
    alert,
    inFlight,
    daysVisible,
    confirmDisabled,
    startAction,
    closeDialog,
    onDaysChange,
    clearAlert,
    handleSubmit,
  };
}
