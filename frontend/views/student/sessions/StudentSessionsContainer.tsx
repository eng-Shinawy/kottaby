"use client";

import { useApolloClient, useQuery } from "@apollo/client/react";
import { Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import type { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { myStudentSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { SessionStatusFilterChips } from "@/frontend/views/student/sessions/SessionStatusFilterChips";
import { StudentSessionsBody } from "@/frontend/views/student/sessions/StudentSessionsBody";
import { StudentSessionsDialogs } from "@/frontend/views/student/sessions/StudentSessionsDialogs";
import { StudentSessionsNoticeSnackbar } from "@/frontend/views/student/sessions/StudentSessionsNoticeSnackbar";
import { useStudentSessionCancelArms } from "@/frontend/views/student/sessions/useStudentSessionCancelArms";
import { useStudentSessionConfirm } from "@/frontend/views/student/sessions/useStudentSessionConfirm";
import { useStudentSessionDialogSlots } from "@/frontend/views/student/sessions/useStudentSessionDialogSlots";
import { useStudentSessionDisputeArms } from "@/frontend/views/student/sessions/useStudentSessionDisputeArms";
import { useStudentSessionNotices } from "@/frontend/views/student/sessions/useStudentSessionNotices";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * StudentSessionsContainer — the client orchestrator behind
 * `/student/sessions`.
 *
 * Stateful composition ONLY (NO Zustand store, NO persistence): the
 * status-filter selection lives in local `useState` and re-keys
 * `useQuery` `variables`, which re-runs the STATEFUL
 * `myStudentSessions` query (Apollo refetch semantics — `useLazyQuery`
 * is banned per `sharedDocuments/AGENTS.md`). Page-level authorization is
 * owned by the server guard (`withPageAuth`) — this container performs no
 * role logic. The stateful machinery lives in the sibling hooks:
 * `useStudentSessionDialogSlots` (dialog slots + per-row in-flight slot
 * book), `useStudentSessionNotices` (row alerts + snackbar notice),
 * `useStudentSessionCancelArms` / `useStudentSessionDisputeArms` (dialog
 * outcome routing) and `useStudentSessionConfirm` (the container-owned
 * confirm-completion mutation).
 *
 * Render branches (visual state matrix) — the chrome (page title + filter
 * chips) renders in EVERY branch; only the body BELOW it swaps
 * (`StudentSessionsBody`). The former early returns omitted the chrome on
 * skeleton/error/empty, which stranded the user with no filter row exactly
 * when the page went bare (resolved):
 *
 * | # | Condition | Body (below the always-on chrome) |
 * |---|-----------|-----------------------------------|
 * | 1 | query in flight (no settled payload yet) | skeleton list rows mirroring the `ApplicantStatusCard` loading skeleton (`aria-busy`) |
 * | 2 | query error, mapping-table denial family (`permission-fallback` / `auth-recovery`) | shared `PermissionDeniedFallback` |
 * | 3 | any other query error (masked 500 …) | inline `Alert` with `sessions.genericError` |
 * | 4a | zero items, NO status filter active | empty state (`studentEmptyTitle` / `studentEmptyBody`, calendar icon) |
 * | 4b | zero items, status filter ACTIVE | distinct filtered-empty state (`filteredEmptyTitle` / `filteredEmptyBody`, filter-list icon) |
 * | 5 | rows present | `SessionRow` list |
 *
 * Mutation outcome wiring — the `cancelSession` mutation and its code
 * classification live in {@link CancelSessionConfirmDialog}; the container
 * receives typed callbacks (`useStudentSessionCancelArms`) and renders the
 * surfaces:
 *
 * | Outcome (extensions.code) | Container behavior |
 * |---------------------------|--------------------|
 * | success | `sessions.holdReleasedNotice` success snackbar + stale row alert dropped |
 * | `SESSION_NOT_FOUND` | `errors.sessionNotFound` error snackbar (cache eviction + list filtering are owned by the dialog's not-found arm — the row has already left the list here) |
 * | `SESSION_INVALID_TRANSITION` | row-scoped inline alert via `SessionRow` `alertMessage` carrying `errors.sessionInvalidTransition` |
 * | `DUPLICATE_REQUEST` | informational snackbar with `sessions.duplicateBookingInfo` (never an error treatment — docs/IDEMPOTENCY.md §3) |
 * | `FORBIDDEN` / masked `INTERNAL_SERVER_ERROR` / anything else | error snackbar with the copy the dialog resolved (`errors.forbidden` / `sessions.genericError`); the dialog stays open for a retry |
 *
 * Dispute-dialog wiring — the `openSessionDispute` mutation
 * and its code classification live in {@link SessionDisputeConfirmDialog};
 * EVERY error arm surfaces a snackbar (the dispute error vocabulary)
 * and the row stays in the list (no eviction arm — the dialog's docblock):
 *
 * | Outcome (extensions.code) | Container behavior |
 * |---------------------------|--------------------|
 * | success | `sessions.disputeOpenedNotice` success snackbar; the row flips to its DISPUTED chip via the dialog's cache normalize (no refetch); the dispute dialog closes and the row's `dispute` in-flight slot releases |
 * | `SESSION_NOT_FOUND` | `errors.sessionNotFound` error snackbar; row stays; dialog closes |
 * | `SESSION_INVALID_TRANSITION` | `errors.sessionInvalidTransition` error snackbar; row stays; dialog closes |
 * | `VALIDATION` / `FORBIDDEN` / anything else | error snackbar with the copy the dialog resolved (`errors.validation` / `errors.forbidden` / `sessions.genericError`); the dialog stays open for a retry |
 *
 * The dispute affordance participates in the per-row slot
 * book (`Record<sessionId, Set<kind>>` extended with the `dispute` kind):
 * the row whose dispute dialog is open holds the slot, disabling its own
 * dispute CTA while the modal owns the mutation.
 *
 * Confirm-completion wiring — the `confirmSessionCompletion`
 * mutation is owned by `useStudentSessionConfirm` (no dialog: the row's
 * Confirm CTA fires directly, its consequence explainer riding the CTA
 * tooltip), mirroring the teacher container's direct lifecycle mutations:
 *
 * | Outcome (extensions.code) | Container behavior |
 * |---------------------------|--------------------|
 * | success | `sessions.sessionConfirmedNotice` success snackbar; the row's `confirmedByStudentAt`/`feeHeld` fields normalize via the mutation's cache `update` (the Confirm CTA + pending pill leave in place — no refetch); the row's `confirm` in-flight slot releases |
 * | `SESSION_NOT_FOUND` (not-found family) | evict the row — `myStudentSessions` list fields filtered by `__ref`, entity evicted, `gc()`; `errors.sessionNotFound` error snackbar |
 * | `SESSION_INVALID_TRANSITION` | row-scoped inline alert via `SessionRow` `alertMessage` carrying `errors.sessionInvalidTransition` |
 * | `FORBIDDEN` | error snackbar with `errors.forbidden` |
 * | masked `INTERNAL_SERVER_ERROR` / anything else | error snackbar with `sessions.genericError` |
 *
 * The confirm affordance matrix keys off the EXACTLY-ONCE financial shape
 * (`Completed` ∧ student stamp unset ∧ hold still marked) — the same shape
 * the row's pending pill renders. An arbitration-settled hold (`feeHeld =
 * false`) renders NO confirm CTA: the idempotent mutation would return the
 * row untouched and the stamp would stay unset — an affordance there would
 * be dishonest.
 *
 * Query-context errors classify through the SINGLE
 * `mapGraphQLErrorByCode` table (`frontend/providers/apollo/error-link.map.ts`)
 * — never the server `message`.
 *
 * All copy resolves through compile-time i18n handles
 * (`useAppTranslation(Sessions | Errors)` property access — NEVER
 * `t('key')`).
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, `*Outlined` icons only, RTL-safe logical
 * composition.
 */

/**
 * The student sessions view: ALWAYS-ON chrome (title + sticky filter chips)
 * over a swapping body — skeleton / permission fallback / error notice /
 * empty (generic or filtered) / rows — plus the cancel/dispute dialogs and
 * the snackbar chrome. State + callbacks only (extracted to sibling hooks);
 * the body resolver (`StudentSessionsBody`) keeps the chrome rendering in
 * EVERY branch (the user never loses the filter row).
 */
export function StudentSessionsContainer(): ReactNode {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const client = useApolloClient();

  // Status filter — `null` is the "all" token; every change re-keys the
  // query `variables`, which re-runs the stateful query (Apollo refetch).
  const [statusFilter, setStatusFilter] = useState<SessionStatus | null>(null);

  const handleFilterChange = useCallback((status: SessionStatus | null): void => {
    setStatusFilter(status);
  }, []);

  const { data, loading, error } = useQuery(myStudentSessionsQueryDocument, {
    variables: {
      filter: statusFilter === null ? null : { status: statusFilter },
      page: null,
      pageSize: null,
    },
  });

  const {
    cancelDialogSessionId,
    disputeDialogSessionId,
    inFlightSlots,
    openCancelDialog,
    closeCancelDialog,
    openDisputeDialog,
    closeDisputeDialog,
    claimConfirmSlot,
    clearConfirmSlot,
  } = useStudentSessionDialogSlots();

  const { rowAlerts, notice, setRowAlerts, setNotice, dismissNotice } = useStudentSessionNotices();

  const cancelArms = useStudentSessionCancelArms({
    sessionsCopy: t,
    errorsCopy: te,
    closeCancelDialog,
    setRowAlerts,
    setNotice,
  });

  const disputeArms = useStudentSessionDisputeArms({
    sessionsCopy: t,
    errorsCopy: te,
    closeDisputeDialog,
    setRowAlerts,
    setNotice,
  });

  const { handleConfirm } = useStudentSessionConfirm({
    cache: client.cache,
    sessionsCopy: t,
    errorsCopy: te,
    claimConfirmSlot,
    clearConfirmSlot,
    setRowAlerts,
    setNotice,
  });

  return (
    <Stack data-testid="student-sessions-view" sx={{ gap: 3 }}>
      <Stack sx={{ gap: 2 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {t.studentPageTitle}
        </Typography>
        <SessionStatusFilterChips value={statusFilter} onChange={handleFilterChange} />
      </Stack>
      <StudentSessionsBody
        statusFilter={statusFilter}
        loading={loading}
        error={error}
        data={data}
        rowAlerts={rowAlerts}
        onCancelIntent={openCancelDialog}
        onDisputeIntent={openDisputeDialog}
        disputeInFlightSlots={inFlightSlots}
        inFlightSlots={inFlightSlots}
        onConfirm={handleConfirm}
        t={t}
      />
      <StudentSessionsDialogs
        cancelDialogSessionId={cancelDialogSessionId}
        disputeDialogSessionId={disputeDialogSessionId}
        onCloseCancelDialog={closeCancelDialog}
        onCloseDisputeDialog={closeDisputeDialog}
        onCancelled={cancelArms.handleCancelled}
        onSessionMissing={cancelArms.handleSessionMissing}
        onInvalidTransition={cancelArms.handleInvalidTransition}
        onDuplicateReplay={cancelArms.handleDuplicateReplay}
        onCancelFailure={cancelArms.handleFailure}
        onDisputed={disputeArms.handleDisputed}
        onDisputeSessionMissing={disputeArms.handleDisputeSessionMissing}
        onDisputeInvalidTransition={disputeArms.handleDisputeInvalidTransition}
        onDisputeFailure={disputeArms.handleDisputeFailure}
      />
      <StudentSessionsNoticeSnackbar notice={notice} onDismiss={dismissNotice} />
    </Stack>
  );
}
