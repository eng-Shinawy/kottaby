"use client";

/**
 * useGovernanceActions — state + mutation orchestration for the
 * GovernanceActionsSection (suspend / unsuspend / block / unblock).
 *
 * Owns the dialog open-target, the suspend `periodDays` field state, the
 * inline conflict `Alert`, and the two `useMutation` calls against the
 * Phase 4.1 documents. Apollo merges each post-write detail fragment into
 * the SAME `AdminUserDetail:<id>` normalized entity (id-first) — the detail
 * query re-renders WITHOUT a refetch.
 *
 * Conflict routing (REQ-065):
 *  - `FORBIDDEN` → suppressed inline (rides the existing
 *    `GraphQLErrorSurfaceHost` toast path globally);
 *  - `VALIDATION` carrying a `periodDays` field error → field-level
 *    `helperText` projection via `extractFieldErrors`;
 *  - any other code → in-dialog `Alert` carrying the SERVER-localized
 *    message (`severity="info"` for state conflicts, `severity="warning"`
 *    for `USER_ALREADY_DELETED`).
 *
 * i18n: `useAppTranslation(AdminUsers).governanceActions` is consumed by the
 * CALLER (the component) — this hook accepts the resolved `Copy` object so it
 * stays pure-logic and trivially unit-testable.
 */

import { useMutation } from "@apollo/client/react";
import { type SubmitEventHandler, useState } from "react";
import type { AdminUserDetailQuery_adminUserDetail } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminSetUserBlockedMutationDocument,
  adminSetUserSuspendedMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import {
  type ActionKind,
  buildRouteError,
  buildSubmitHandler,
  type Copy,
  type DialogMeta,
  type InlineAlert,
  isValidPeriodDays,
  metaFor,
} from "@/frontend/views/admin/users/hooks/governance-actions-helpers";

export interface GovernanceActionsApi {
  readonly openAction: ActionKind | null;
  readonly meta: DialogMeta | null;
  readonly days: string;
  readonly daysErr: string | null;
  readonly alert: InlineAlert | null;
  readonly inFlight: boolean;
  readonly confirmDisabled: boolean;
  readonly openDialog: (action: ActionKind) => void;
  readonly closeDialog: () => void;
  readonly onDaysChange: (value: string) => void;
  readonly clearAlert: () => void;
  readonly handleSubmit: SubmitEventHandler<HTMLFormElement>;
}

export interface UseGovernanceActionsArgs {
  readonly user: AdminUserDetailQuery_adminUserDetail;
  readonly copy: Copy;
  readonly onToast: (message: string) => void;
}

export function useGovernanceActions({ user, copy, onToast }: UseGovernanceActionsArgs): GovernanceActionsApi {
  const [openAction, setOpenAction] = useState<ActionKind | null>(null);
  const [days, setDays] = useState("");
  const [daysErr, setDaysErr] = useState<string | null>(null);
  const [alert, setAlert] = useState<InlineAlert | null>(null);
  const [suspendMut, { loading: suspendLoading }] = useMutation(adminSetUserSuspendedMutationDocument);
  const [blockMut, { loading: blockLoading }] = useMutation(adminSetUserBlockedMutationDocument);
  const inFlight = suspendLoading || blockLoading;
  const meta = openAction === null ? null : metaFor(copy, openAction);
  const confirmDisabled = inFlight || (openAction === "suspend" && !isValidPeriodDays(days));

  const closeDialog = (): void => {
    if (inFlight) return;
    setOpenAction(null);
    setAlert(null);
    setDaysErr(null);
    setDays("");
  };
  const openDialog = (action: ActionKind): void => {
    setAlert(null);
    setDaysErr(null);
    setDays("");
    setOpenAction(action);
  };
  const onDaysChange = (value: string): void => {
    setDays(value);
    if (daysErr !== null) setDaysErr(null);
  };
  const clearAlert = (): void => setAlert(null);
  const routeError = buildRouteError(setDaysErr, setAlert);
  const complete = (toast: string): void => {
    setOpenAction(null);
    setDays("");
    onToast(toast);
  };
  const handleSubmit = buildSubmitHandler(
    openAction,
    copy,
    user.id,
    days,
    setDaysErr,
    setAlert,
    complete,
    routeError,
    suspendMut,
    blockMut
  );

  return {
    openAction,
    meta,
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
