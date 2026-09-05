"use client";

import { useCallback, useState } from "react";
import type { AdminDisputedSessionsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * useAdminDisputesNotice — the arbitration-outcome notice slot for
 * `AdminDisputesContainer` (DEV3-005 R-104/R-111): one transient snackbar
 * notice (success / info / error) plus the outcome handlers the
 * `ResolveDisputeDialog` invokes. EVERY outcome surfaces a snackbar:
 *
 * | Outcome (extensions.code) | Container behavior |
 * |---------------------------|--------------------|
 * | success | `sessions.disputeResolvedNotice` success snackbar; the resolved row leaves the queue via the dialog's cache filter (items + honest `totalCount` decrement, NO refetch); the dialog closes and the row's resolve affordance re-enables; a now-empty trailing page steps back one page instead of rendering a ghost page |
 * | `SESSION_NOT_FOUND` | `errors.sessionNotFound` error snackbar; the row STAYS (a raced concurrent arbitration is the honest explanation — no eviction arm on an admin surface) |
 * | `SESSION_INVALID_TRANSITION` | `errors.sessionInvalidTransition` error snackbar; the row stays |
 * | `VALIDATION` / `FORBIDDEN` / anything else | error snackbar with the copy the dialog resolved (`errors.validation` / `errors.forbidden` / `sessions.genericError`); the dialog stays open for a corrected choice |
 */

/** One transient container-level notice rendered in the MUI Snackbar slot. */
export interface ContainerNotice {
  readonly message: string;
  readonly severity: "success" | "info" | "error";
}

interface UseAdminDisputesNoticeArgs {
  /** Settled queue payload — the ghost-page guard reads its row count. */
  readonly data: AdminDisputedSessionsQuery | undefined;
  /** Current 1-based page — guards the ghost-page step-back. */
  readonly page: number;
  /** Closes the arbitration dialog (every terminal arm except failures). */
  readonly closeResolveDialog: () => void;
  /**
   * Steps the 1-based page back one page (clamped at 1) — invoked by the
   * ghost-page guard when the LAST row of a trailing page resolves.
   */
  readonly stepToPreviousPage: () => void;
}

/**
 * Owns the transient notice slot and the arbitration-outcome handlers
 * (success / session-missing / invalid-transition / failure). Presentation
 * stays in `AdminDisputesNoticeSnackbar`; this module returns plain state —
 * no JSX.
 */
export function useAdminDisputesNotice({
  data,
  page,
  closeResolveDialog,
  stepToPreviousPage,
}: Readonly<UseAdminDisputesNoticeArgs>) {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const [notice, setNotice] = useState<ContainerNotice | null>(null);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  /** Success — queue already converged through the dialog's cache filter. */
  const handleResolved = useCallback((): void => {
    setNotice({ message: t.disputeResolvedNotice, severity: "success" });
    closeResolveDialog();
    // Ghost-page guard: the LAST row of a trailing page just left — step
    // back one page (re-keys `offset`, which re-runs the stateful query)
    // instead of rendering an empty page with a stale page number.
    if (data?.adminDisputedSessions.items.length === 1 && page > 1) {
      stepToPreviousPage();
    }
  }, [t, data, page, closeResolveDialog, stepToPreviousPage]);

  const handleSessionMissing = useCallback((): void => {
    // Deliberately NO eviction arm (see the resolve dialog's docblock) —
    // the honest surface is the error notice; the row stays in the queue.
    // Parameterless: assignable to the dialog's `(sessionId: string) => void`
    // prop type, and the arm never addresses the row.
    setNotice({ message: te.sessionNotFound, severity: "error" });
    closeResolveDialog();
  }, [te, closeResolveDialog]);

  const handleInvalidTransition = useCallback((): void => {
    // Another admin resolved this dispute first — the snackbar is the
    // honest surface; the row stays until the next page flip refetches it.
    setNotice({ message: te.sessionInvalidTransition, severity: "error" });
    closeResolveDialog();
  }, [te, closeResolveDialog]);

  /**
   * Failure arm (VALIDATION / FORBIDDEN / masked) — the dialog STAYS OPEN
   * for a corrected choice (its own documented contract).
   */
  const onFailure = useCallback((message: string): void => {
    setNotice({ message, severity: "error" });
  }, []);

  return { notice, dismissNotice, handleResolved, handleSessionMissing, handleInvalidTransition, onFailure };
}
