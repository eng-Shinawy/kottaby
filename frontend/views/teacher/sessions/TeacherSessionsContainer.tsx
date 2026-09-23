"use client";

/**
 * TeacherSessionsContainer — the client orchestrator behind
 * `/teacher/sessions`.
 *
 * The STUDENT twin (`StudentSessionsContainer`) is the structural precedent:
 * this container reuses its shared primitives — `SessionRow` (via the
 * optional `actions` prop added for the teacher lifecycle),
 * `SessionStatusFilterChips` and `CancelSessionConfirmDialog` — and copies
 * its stateful-composition shape. Stateful composition ONLY (NO Zustand, NO
 * persistence): the status filter lives in local `useState` and re-keys the
 * `useQuery` `variables`, which re-runs the STATEFUL `myTeacherSessions`
 * query (Apollo refetch semantics — `useLazyQuery` is banned per
 * `sharedDocuments/AGENTS.md`). Page-level authorization is owned by the
 * server guard (`withPageAuth`) — the container passes its surface's
 * row-role constant to the shared row slot (the dispute affordance seam
 * below) but performs no authorization logic.
 *
 * Teacher lifecycle: **Start** on `Scheduled`,
 * **Complete** on `Started`, **Cancel** on `Scheduled`/`Started`, **dispute**
 * affordance on `Scheduled`/`Started` — each affordance disabled while ITS
 * OWN row+kind slot is in flight (a `Record<sessionId, Set<actionKind>>` of
 * per-row slots — concurrent same-kind actions on two rows disable BOTH CTAs
 * and each clears independently, so an earlier row's CTA can never re-enable
 * mid-flight; the book extends with the `dispute` kind for the dispute
 * affordance); terminal
 * rows (`Completed`/`Cancelled`) render NO action affordances, and DISPUTED
 * rows keep the Cancel CTA VISIBLE but disabled (the state machine forbids
 * cancelling a disputed session — the only edge out is admin arbitration).
 * Completed EVALUATION rows that still owe a rubric submission (the
 * evaluator's pending-rubric read decides "still owes") additionally offer
 * the **submit-evaluation** affordance — the rubric dialog mounts keyed by
 * session id beside the report dialog.
 * The applicant teacher never owns sessions — the server answers an empty
 * page and the localized EMPTY state renders (never an error).
 *
 * Render branches (visual state matrix — mirrors the student container).
 * The chrome (page title + filter chips) renders in EVERY branch; only the
 * body BELOW it swaps — the former early returns omitted the chrome on
 * skeleton/error/empty, stranding the user with no filter row exactly when
 * the page went bare (resolved here):
 *
 * | # | Condition | Body (below the always-on chrome) |
 * |---|-----------|-----------------------------------|
 * | 1 | query in flight (no settled payload yet) | skeleton list rows (`aria-busy`) |
 * | 2 | query error, mapping-table denial family (`permission-fallback` / `auth-recovery`) | shared `PermissionDeniedFallback` |
 * | 3 | any other query error (masked 500 …) | inline `Alert` with `sessions.genericError` |
 * | 4a | zero items, NO status filter active (incl. the applicant teacher) | empty state (`teacherEmptyTitle` / `teacherEmptyBody`, school icon) |
 * | 4b | zero items, status filter ACTIVE | distinct filtered-empty state (`filteredEmptyTitle` / `filteredEmptyBody`, filter-list icon) |
 * | 5 | rows present | `SessionRow` list with lifecycle CTAs |
 *
 * Mutation outcome wiring — `startSession` / `completeSession` are owned
 * HERE; cancel ownership stays in the reused `CancelSessionConfirmDialog`
 * (whose `update`/eviction arms already normalize the cache) and the
 * dispute ownership lives in the reused `SessionDisputeConfirmDialog` (every
 * error arm → snackbar, row stays; success → cache normalize + slot release
 * — see the student container's dispute table, byte-identical wiring). The
 * dispute dialog keeps the SHIPPED held-escrow mutation binding
 * (`OPEN_SESSION_DISPUTE_MUTATION`): the teacher surface's dispute path is
 * the pre-completion escalation only — the shared row's role token scopes
 * the post-confirmation CTA off teacher rows entirely.
 * Cache
 * convergence is NORMALIZATION ONLY (NO refetch): every returned `Session!`
 * payload selects `id` first, and each mutation rewrites the transitioned
 * fields onto the `Session:<id>` entity. Error classification per
 * `extensions.code` (single `mapGraphQLErrorByCode` table + the caller-kept
 * arms):
 *
 * | Outcome (extensions.code)                  | Behavior |
 * |--------------------------------------------|----------|
 * | success | per-kind success snackbar (`sessionStartedNotice` / `sessionCompletedNotice` / cancel → `sessionCancelledNotice`) + row alert dropped |
 * | `SESSION_NOT_FOUND` (not-found family)     | evict the row — `myTeacherSessions` list fields filtered by `__ref`, entity evicted, `gc()`; `errors.sessionNotFound` error snackbar |
 * | `SESSION_INVALID_TRANSITION` (no mapping row) | row-scoped inline alert with `errors.sessionInvalidTransition` |
 * | `TEACHER_NOT_CERTIFIED` (no mapping row)   | row-scoped inline alert with `errors.teacherNotCertified` (observed on Complete when the certification lock lost the race) |
 * | `DUPLICATE_REQUEST` (map row: success-equivalent) | informational snackbar with `sessions.duplicateBookingInfo` |
 * | `FORBIDDEN`                                | error snackbar with `errors.forbidden` |
 * | masked `INTERNAL_SERVER_ERROR` / anything else | error snackbar with `sessions.genericError` |
 *
 * Feedback surfaces use plain MUI `Snackbar`/`Alert` (no notistack, no
 * Zustand). All copy resolves through compile-time i18n handles
 * (`useAppTranslation(Sessions | Errors)` property access — NEVER
 * `t('key')`).
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, `*Outlined` icons only, RTL-safe logical
 * composition.
 *
 * File layout (the max-lines split): the slot-book vocabulary + pure
 * helpers live in `teacherSessionSlots.ts`; the cache eviction + mutation
 * error arms + affordance matrix in `teacherSessionCacheArms.ts`; the
 * swapping body in `TeacherSessionsBody.tsx`; the loading skeleton in
 * `TeacherSessionsLoadingSkeleton.tsx`; the stateful hooks in
 * `useTeacherInFlightSlots` / `useTeacherCancelDialogArms` /
 * `useTeacherDisputeDialogArms` / `useTeacherLifecycleMutations`. This file
 * is the composition root: state ownership + the always-on chrome + the
 * dialog/snackbar slots.
 */

import { useQuery } from "@apollo/client/react";
import { Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { myTeacherSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { SessionStatusFilterChips } from "@/frontend/views/student/sessions/SessionStatusFilterChips";
import type { SessionRowRole } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { parkedRubricDraftSessionIds } from "@/frontend/views/teacher/sessions/rubricDraftStorage.helpers";
import { TeacherPendingRubricBanner } from "@/frontend/views/teacher/sessions/TeacherPendingRubricBanner";
import { TeacherSessionsBody } from "@/frontend/views/teacher/sessions/TeacherSessionsBody";
import { TeacherSessionsOverlays } from "@/frontend/views/teacher/sessions/TeacherSessionsOverlays";
import type { ContainerNotice } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { useTeacherSessionArms } from "@/frontend/views/teacher/sessions/useTeacherSessionArms";
import { useTeacherSessionDialogSessions } from "@/frontend/views/teacher/sessions/useTeacherSessionDialogSessions";
import { Sessions, useAppTranslation } from "@/shared/locale";

/**
 * The teacher sessions query variables for the active status filter —
 * extracted so the container stays within the per-function line budget.
 */
const teacherSessionsQueryVariables = (statusFilter: SessionStatus | null) => ({
  filter: statusFilter === null ? null : { status: statusFilter },
  page: null,
  pageSize: null,
});

/**
 * The teacher sessions view: ALWAYS-ON chrome (title + sticky filter chips)
 * over a swapping body — skeleton / permission fallback / error notice /
 * empty (generic or filtered) / rows with lifecycle CTAs — plus the cancel
 * dialog, the dispute case dialog (the session's own teacher's read —
 * rows with dispute history carry the "Case details" affordance), the
 * rubric-evaluation dialog (completed evaluation rows that still owe a
 * submission) and the snackbar chrome.
 */
export function TeacherSessionsContainer(): ReactNode {
  const t = useAppTranslation(Sessions);
  const [statusFilter, setStatusFilter] = useState<SessionStatus | null>(null);
  /**
   * The pending-rubric banner's client-side filter ("show only the rows
   * that still owe a rubric submission"). NOT a query variable — it
   * filters the settled page rows by the pending id set (one source of
   * truth with the rows' pill and submit CTA).
   */
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  const [rowAlerts, setRowAlerts] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<ContainerNotice | null>(null);
  const {
    caseDialogSessionId,
    openCaseDialog,
    closeCaseDialog,
    reportDialogSessionId,
    openReportDialog,
    closeReportDialog,
    openHomeworkDialog,
    rubricDialogSessionId,
    openRubricDialog,
    closeRubricDialog,
  } = useTeacherSessionDialogSessions();
  const dismissNotice = useCallback(() => setNotice(null), []);
  const handleFilterChange = useCallback((status: SessionStatus | null) => setStatusFilter(status), []);

  const { data, loading, error } = useQuery(myTeacherSessionsQueryDocument, {
    variables: teacherSessionsQueryVariables(statusFilter),
  });

  const { slots, cancelArms, disputeArms, mutations } = useTeacherSessionArms({ setRowAlerts, setNotice });

  const pendingRubricCount = mutations.rubric.pendingSessionIds.size;

  // The parked-draft chips — which PENDING sessions carry a restorable
  // draft (the storage intersection read, so a row can name its parked
  // draft without opening the dialog) — DERIVE during render (a membership read over
  // the parked-draft namespace, keyed by the pending set's identity): the
  // read is idempotent and only re-runs when the pending set changes —
  // on refetches, which is exactly when a chip may gain or lose a draft.
  const parkedDraftSessionIdSet = useMemo(
    () => new Set(parkedRubricDraftSessionIds(mutations.rubric.pendingSessionIds)),
    [mutations.rubric.pendingSessionIds]
  );

  // The lane reads as active only while the pending set is non-empty —
  // when the last submission lands and the set drains, the strip renders
  // inactive (a stale internal flag stays harmless: the next toggle
  // re-engages from the effective state, so the page never filters away
  // to a stranded empty view).
  const awaitingOnlyActive = awaitingOnly && pendingRubricCount > 0;

  /** Toggle the pending-only lane; toggle-ON clears a status chip (the pending rows are COMPLETED sessions — a chip would strand the filter on an empty page). */
  const toggleAwaitingOnly = useCallback((): void => {
    if (!awaitingOnlyActive) {
      setStatusFilter(null);
    }
    setAwaitingOnly(!awaitingOnlyActive);
  }, [awaitingOnlyActive]);

  // The teacher surface's row-role constant — the shared row's affordance
  // matrix scopes the post-confirmation dispute CTA off this surface.
  const rowRole: SessionRowRole = "teacher";

  // The body below the chrome resolves through `TeacherSessionsBody`
  // (matrix branches 1–5) — the chrome above renders in EVERY branch.
  return (
    <Stack data-testid="teacher-sessions-view" sx={{ gap: 3 }}>
      <Stack sx={{ gap: 2 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {t.teacherPageTitle}
        </Typography>
        <SessionStatusFilterChips value={statusFilter} onChange={handleFilterChange} />
        {pendingRubricCount > 0 ? (
          <TeacherPendingRubricBanner
            count={pendingRubricCount}
            active={awaitingOnlyActive}
            onToggle={toggleAwaitingOnly}
          />
        ) : null}
      </Stack>
      <TeacherSessionsBody
        statusFilter={statusFilter}
        loading={loading}
        error={error}
        data={data}
        awaitingOnly={awaitingOnlyActive}
        rowAlerts={rowAlerts}
        onCancelIntent={cancelArms.openCancelDialog}
        onDisputeIntent={disputeArms.openDisputeDialog}
        disputeInFlightSlots={slots.inFlightSlots}
        inFlightSlots={slots.inFlightSlots}
        onStart={mutations.handleStart}
        onComplete={mutations.handleComplete}
        onHomework={openHomeworkDialog}
        onReport={openReportDialog}
        onSubmitEvaluation={openRubricDialog}
        pendingRubricSessionIds={mutations.rubric.pendingSessionIds}
        parkedDrafts={{ ids: parkedDraftSessionIdSet, label: t.rubricDraftParkedChip }}
        role={rowRole}
        onCaseIntent={openCaseDialog}
        t={t}
      />
      <TeacherSessionsOverlays
        cancelArms={cancelArms}
        disputeArms={disputeArms}
        caseDialogSessionId={caseDialogSessionId}
        closeCaseDialog={closeCaseDialog}
        reportDialogSessionId={reportDialogSessionId}
        closeReportDialog={closeReportDialog}
        rubricDialogSessionId={rubricDialogSessionId}
        closeRubricDialog={closeRubricDialog}
        data={data}
        setNotice={setNotice}
        setRowAlerts={setRowAlerts}
        submitEvaluation={mutations.rubric.submitEvaluation}
        submitting={mutations.rubric.submitting}
        notice={notice}
        dismissNotice={dismissNotice}
      />
    </Stack>
  );
}
