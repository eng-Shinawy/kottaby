"use client";

/**
 * useCooldownExtension — state + mutation orchestration for the
 * CooldownExtensionSection (the admin applicant-cooldown extension
 * affordance on the user DETAIL page).
 *
 * Owns the dialog open state, the `additionalDays` field state, the inline
 * conflict `Alert`, and one `useMutation` call against the
 * `AdminExtendApplicantCooldown` document. Apollo merges the post-write
 * `ApplicantProfile` into the SAME `ApplicantProfile:<id>` normalized entry
 * the detail query's `applicant` field links to (id-first selection) — the
 * snapshot card re-renders WITHOUT a refetch.
 *
 * Conflict routing lives in `cooldown-extension-helpers`
 * (`buildExtensionRouteError`): FORBIDDEN → suppressed inline (global toast
 * path); VALIDATION → field-level `helperText`; any other typed domain
 * rejection → in-dialog info `Alert` carrying the SERVER-localized message.
 *
 * i18n: this hook accepts the resolved `Copy` object so it stays
 * pure-logic and trivially unit-testable (same discipline as
 * `useGovernanceActions`).
 */

import { useMutation } from "@apollo/client/react";
import { type SubmitEventHandler, useState } from "react";
import { adminExtendApplicantCooldownMutationDocument } from "@/frontend/graphql/sharedDocuments/admin";
import {
  buildExtensionRouteError,
  type ExtensionCopy,
  type ExtensionInlineAlert,
  isValidExtensionDays,
} from "@/frontend/views/admin/users/hooks/cooldown-extension-helpers";

export interface CooldownExtensionApi {
  readonly open: boolean;
  readonly days: string;
  readonly daysErr: string | null;
  readonly alert: ExtensionInlineAlert | null;
  readonly inFlight: boolean;
  readonly confirmDisabled: boolean;
  readonly openDialog: () => void;
  readonly closeDialog: () => void;
  readonly onDaysChange: (value: string) => void;
  readonly clearAlert: () => void;
  readonly handleSubmit: SubmitEventHandler<HTMLFormElement>;
}

export interface UseCooldownExtensionArgs {
  readonly applicantId: number;
  readonly copy: ExtensionCopy;
  readonly onToast: (message: string) => void;
}

export function useCooldownExtension({ applicantId, copy, onToast }: UseCooldownExtensionArgs): CooldownExtensionApi {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");
  const [daysErr, setDaysErr] = useState<string | null>(null);
  const [alert, setAlert] = useState<ExtensionInlineAlert | null>(null);
  const [extendMut, { loading: inFlight }] = useMutation(adminExtendApplicantCooldownMutationDocument);
  const confirmDisabled = inFlight || !isValidExtensionDays(days);

  const closeDialog = (): void => {
    if (inFlight) return;
    setOpen(false);
    setAlert(null);
    setDaysErr(null);
    setDays("");
  };
  const openDialog = (): void => {
    setAlert(null);
    setDaysErr(null);
    setDays("");
    setOpen(true);
  };
  const onDaysChange = (value: string): void => {
    setDays(value);
    if (daysErr !== null) setDaysErr(null);
  };
  const clearAlert = (): void => setAlert(null);
  const complete = (): void => {
    setOpen(false);
    setDays("");
    onToast(copy.successToast);
  };
  const routeError = buildExtensionRouteError(setDaysErr, setAlert);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = event => {
    event.preventDefault();
    setAlert(null);
    if (!isValidExtensionDays(days)) {
      setDaysErr(copy.daysHelper);
      return;
    }
    setDaysErr(null);
    void extendMut({
      variables: { applicantId, additionalDays: Number(days) },
      onCompleted: complete,
      onError: routeError,
    });
  };

  return {
    open,
    days,
    daysErr,
    alert,
    inFlight,
    confirmDisabled,
    openDialog,
    closeDialog,
    onDaysChange,
    clearAlert,
    handleSubmit,
  };
}
