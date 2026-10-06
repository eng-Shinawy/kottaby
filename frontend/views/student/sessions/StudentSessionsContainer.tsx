"use client";

import { useQuery } from "@apollo/client/react";
import { Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import type { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { myStudentSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { StudentDisputeCaseDialog } from "@/frontend/views/student/disputes/StudentDisputeCaseDialog";
import { SessionDetailsDialog } from "@/frontend/views/student/sessions/SessionDetailsDialog";
import { SessionStatusFilterChips } from "@/frontend/views/student/sessions/SessionStatusFilterChips";
import { StudentSessionsBody } from "@/frontend/views/student/sessions/StudentSessionsBody";
import {
  StudentRateDialogSlot,
  StudentSessionsDialogs,
} from "@/frontend/views/student/sessions/StudentSessionsDialogs";
import { StudentSessionsNoticeSnackbar } from "@/frontend/views/student/sessions/StudentSessionsNoticeSnackbar";
import { resolveSessionRowById, type SessionRowRole } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { resolveStudentDisputeMutationForRow } from "@/frontend/views/student/sessions/studentSessionDisputeMutationForRow";
import { useMyTeacherEvaluations } from "@/frontend/views/student/sessions/useMyTeacherEvaluations";
import { useSessionDetailsDialogSlot } from "@/frontend/views/student/sessions/useSessionDetailsDialogSlot";
import { useStudentSessionCaseDialogSlot } from "@/frontend/views/student/sessions/useStudentSessionCaseDialogSlot";
import { useStudentSessionDialogSlots } from "@/frontend/views/student/sessions/useStudentSessionDialogSlots";
import { useStudentSessionMutationArms } from "@/frontend/views/student/sessions/useStudentSessionMutationArms";
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
 * owned by the server guard (`withPageAuth`) — the container passes its
 * surface's row-role constant to the shared row slot but performs no
 * authorization logic. The stateful machinery lives in the sibling hooks:
 * `useStudentSessionDialogSlots` (dialog slots + per-row in-flight slot
 * book), `useStudentSessionNotices` (row alerts + snackbar notice),
 * `useStudentSessionMutationArms` (the cancel / dispute / rate arms plus
 * the confirm-completion mutation), `useStudentSessionCaseDialogSlot`
 * (the dispute case-dialog session id), `useSessionDetailsDialogSlot`
 * (the read-only details dialog's session id) and `useMyTeacherEvaluations`
 * (the rated-session-id set the Rate gate consumes).
 *
 * Row-role token: this container supplies the shared row slot's
 * `"student"` role constant — the affordance seam that lets student rows
 * reach the post-confirmation dispute escalation on top of the shipped
 * pre-completion path. The token is grounded in the surface's mounting:
 * this component renders ONLY under the server-guarded `/student/sessions`
 * page (`withPageAuth({ roles: [UserRole.Student] })`), and every dispute
 * mutation re-validates the caller's ownership + the state matrix
 * server-side — the token scopes UI affordances, never authorization.
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
 * Mutation outcome wiring — cancel (`cancelSession`), dispute
 * (`openSessionDispute`, riding the generation-resolved binding from
 * `resolveStudentDisputeMutationForRow`), rate
 * (`submitTeacherEvaluation`) and confirm-completion
 * (`confirmSessionCompletion`, no dialog: the row's Confirm CTA fires
 * directly) — each mutation and its code classification live in its
 * sibling dialog/hook; the container receives typed callbacks and renders
 * the surfaces:
 *
 * | Outcome (extensions.code) | Container behavior |
 * |---------------------------|--------------------|
 * | success | localized success snackbar; the row's cache normalize/append/filter applies in place (no refetch); the dialog closes and the row's in-flight slot releases |
 * | `SESSION_NOT_FOUND` | `errors.sessionNotFound` error snackbar (cache eviction + list filtering are owned by the dialog's/hook's not-found arm — the row has already left the list here; confirm evicts the row itself) |
 * | `SESSION_INVALID_TRANSITION` | row-scoped inline alert via `SessionRow` `alertMessage` carrying `errors.sessionInvalidTransition` |
 * | `DUPLICATE_REQUEST` (cancel) | informational snackbar with `sessions.duplicateBookingInfo` (never an error treatment — docs/IDEMPOTENCY.md §3) |
 * | `EVALUATION_ALREADY_SUBMITTED` / `EVALUATION_SESSION_NOT_COMPLETED` (rate) | the row is marked rated / the localized notice renders app-scope through the mapped error surface; the dialog closes |
 * | `FORBIDDEN` / masked `INTERNAL_SERVER_ERROR` / anything else | error snackbar with the copy the dialog resolved (`errors.forbidden` / `errors.validation` / `sessions.genericError`); the dialog stays open for a retry |
 *
 * The confirm affordance matrix keys off the EXACTLY-ONCE financial shape
 * (`Completed` ∧ student stamp unset ∧ hold still marked) — the same shape
 * the row's pending pill renders. An arbitration-settled hold (`feeHeld =
 * false`) renders NO confirm CTA: the idempotent mutation would return the
 * row untouched and the stamp would stay unset — an affordance there would
 * be dishonest. The rate CTA renders ONLY on the dual-confirmed-completed
 * shape whose id is absent from the rated set (`useMyTeacherEvaluations`),
 * whose write-once end-state renders the read-only rated chip instead.
 *
 * Query-context errors classify through the SINGLE
 * `mapGraphQLErrorByCode` table (`frontend/providers/apollo/error-link.map.ts`)
 * — never the server `message`. All copy resolves through compile-time
 * i18n handles (`useAppTranslation(Sessions | Errors)` property access —
 * NEVER `t('key')`). MUI v9 discipline: `sx`-only styling, colors
 * exclusively through `theme.palette.*` callbacks, `*Outlined` icons only,
 * RTL-safe logical composition.
 */

/**
 * The student sessions view: ALWAYS-ON chrome (title + sticky filter chips)
 * over a swapping body — skeleton / permission fallback / error notice /
 * empty (generic or filtered) / rows — plus the role-shared cancel/dispute
 * dialog seam, the STUDENT-ONLY rate dialog (mounted HERE through
 * `StudentRateDialogSlot` — the teacher twin renders the same seam, and
 * students rate teachers; teachers never rate), the dispute case dialog
 * and the snackbar chrome. State + callbacks only (extracted to sibling
 * hooks); the body resolver (`StudentSessionsBody`) keeps the chrome
 * rendering in EVERY branch (the user never loses the filter row).
 */
export function StudentSessionsContainer(): ReactNode {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);

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

  // The rated-session-id read — the Rate gate's own cache territory (the
  // sessions-list payload is never widened for it).
  const { ratedSessionIds, markSessionRated } = useMyTeacherEvaluations();

  const slots = useStudentSessionDialogSlots();

  const notices = useStudentSessionNotices();

  // Case-dialog slot — the session id whose dispute case is on view, or
  // `null` when the dialog is closed (the teacher container's identical
  // slot shape — the filing participant's mirror of the counterparty read).
  const { caseDialogSessionId, openCaseDialog, closeCaseDialog } = useStudentSessionCaseDialogSlot();

  // Details-dialog slot — the read-only "Session details" affordance's
  // session id (or `null` when closed). The row payload for the dialog's
  // band re-reads from THIS surface's settled list payload (the bands are
  // list-producer territory; `sessionById` stays band-free).
  const { detailsSessionId, openDetailsDialog, closeDetailsDialog } = useSessionDetailsDialogSlot();
  const detailsSession = resolveSessionRowById(data?.myStudentSessions.items ?? [], detailsSessionId);

  const { cancelArms, disputeArms, rateArms, handleConfirm } = useStudentSessionMutationArms({
    sessionsCopy: t,
    errorsCopy: te,
    slots,
    notices,
    markSessionRated,
  });

  const disputeMutation = resolveStudentDisputeMutationForRow(data, slots.disputeDialogSessionId);

  const rowRole: SessionRowRole = "student";

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
        rowAlerts={notices.rowAlerts}
        onCancelIntent={slots.openCancelDialog}
        onDisputeIntent={slots.openDisputeDialog}
        disputeInFlightSlots={slots.inFlightSlots}
        inFlightSlots={slots.inFlightSlots}
        onConfirm={handleConfirm}
        ratedSessionIds={ratedSessionIds}
        onRate={slots.openRateDialog}
        role={rowRole}
        onCaseIntent={openCaseDialog}
        onDetailsIntent={openDetailsDialog}
        t={t}
      />
      <StudentSessionsDialogs
        cancelDialogSessionId={slots.cancelDialogSessionId}
        disputeDialogSessionId={slots.disputeDialogSessionId}
        onCloseCancelDialog={slots.closeCancelDialog}
        onCloseDisputeDialog={slots.closeDisputeDialog}
        onCancelled={cancelArms.handleCancelled}
        onSessionMissing={cancelArms.handleSessionMissing}
        onInvalidTransition={cancelArms.handleInvalidTransition}
        onDuplicateReplay={cancelArms.handleDuplicateReplay}
        onCancelFailure={cancelArms.handleFailure}
        disputeMutation={disputeMutation}
        onDisputed={disputeArms.handleDisputed}
        onDisputeSessionMissing={disputeArms.handleDisputeSessionMissing}
        onDisputeInvalidTransition={disputeArms.handleDisputeInvalidTransition}
        onDisputeFailure={disputeArms.handleDisputeFailure}
      />
      {/* Student-only rate dialog — mounted OUTSIDE the role-shared seam
          (the teacher twin renders that seam too; teachers never rate). */}
      <StudentRateDialogSlot
        rateDialogSessionId={slots.rateDialogSessionId}
        onCloseRateDialog={slots.closeRateDialog}
        rateArms={rateArms}
      />
      {caseDialogSessionId !== null ? (
        <StudentDisputeCaseDialog sessionId={caseDialogSessionId} open onClose={closeCaseDialog} />
      ) : null}
      {/* Read-only details dialog — mounted ONLY for an open slot (the
          case-dialog mount shape); the query itself is skip-gated while
          closed. */}
      <SessionDetailsDialog
        rowRole={rowRole}
        open={detailsSessionId !== null}
        sessionId={detailsSessionId}
        session={detailsSession}
        onClose={closeDetailsDialog}
      />
      <StudentSessionsNoticeSnackbar notice={notices.notice} onDismiss={notices.dismissNotice} />
    </Stack>
  );
}
