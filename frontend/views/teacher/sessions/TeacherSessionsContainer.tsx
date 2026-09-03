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
 * server guard (`withPageAuth`) — this container performs no role logic.
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
 * — see the student container's dispute table, byte-identical wiring).
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
import { Alert, Snackbar, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import type { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { myTeacherSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { CancelSessionConfirmDialog } from "@/frontend/views/student/sessions/CancelSessionConfirmDialog";
import { SessionDisputeConfirmDialog } from "@/frontend/views/student/sessions/SessionDisputeConfirmDialog";
import { SessionStatusFilterChips } from "@/frontend/views/student/sessions/SessionStatusFilterChips";
import { TeacherSessionsBody } from "@/frontend/views/teacher/sessions/TeacherSessionsBody";
import { type ContainerNotice, SNACKBAR_AUTOHIDE_MS } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { useTeacherCancelDialogArms } from "@/frontend/views/teacher/sessions/useTeacherCancelDialogArms";
import { useTeacherDisputeDialogArms } from "@/frontend/views/teacher/sessions/useTeacherDisputeDialogArms";
import { useTeacherInFlightSlots } from "@/frontend/views/teacher/sessions/useTeacherInFlightSlots";
import { useTeacherLifecycleMutations } from "@/frontend/views/teacher/sessions/useTeacherLifecycleMutations";
import { Sessions, useAppTranslation } from "@/shared/locale";

/**
 * The teacher sessions view: ALWAYS-ON chrome (title + sticky filter chips)
 * over a swapping body — skeleton / permission fallback / error notice /
 * empty (generic or filtered) / rows with lifecycle CTAs — plus the cancel
 * dialog and the snackbar chrome.
 */
export function TeacherSessionsContainer(): ReactNode {
  const t = useAppTranslation(Sessions);

  // Status filter — `null` is the "all" token; every change re-keys the
  // query `variables`, which re-runs the stateful query (Apollo refetch).
  const [statusFilter, setStatusFilter] = useState<SessionStatus | null>(null);

  // sessionId → inline row alert copy (SESSION_INVALID_TRANSITION /
  // TEACHER_NOT_CERTIFIED rejections).
  const [rowAlerts, setRowAlerts] = useState<Readonly<Record<string, string>>>({});

  // Single transient notice slot (success / info / error snackbar).
  const [notice, setNotice] = useState<ContainerNotice | null>(null);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const handleFilterChange = useCallback((status: SessionStatus | null): void => {
    setStatusFilter(status);
  }, []);

  const { data, loading, error } = useQuery(myTeacherSessionsQueryDocument, {
    variables: {
      filter: statusFilter === null ? null : { status: statusFilter },
      page: null,
      pageSize: null,
    },
  });

  const slots = useTeacherInFlightSlots();

  const cancelArms = useTeacherCancelDialogArms({ setRowAlerts, setNotice });

  const disputeArms = useTeacherDisputeDialogArms({
    claimDispute: sessionId => slots.claimSlot(sessionId, "dispute"),
    releaseDispute: sessionId => slots.releaseSlot(sessionId, "dispute"),
    setRowAlerts,
    setNotice,
  });

  const mutations = useTeacherLifecycleMutations({
    setRowAlerts,
    setNotice,
    claimSlot: slots.claimSlot,
    clearStart: slots.clearStart,
    clearComplete: slots.clearComplete,
  });

  // The body below the chrome resolves through `TeacherSessionsBody`
  // (matrix branches 1–5) — extracting it keeps this orchestrator to state +
  // callbacks only while the chrome above renders in EVERY branch (the user
  // never loses the filter row).
  return (
    <Stack data-testid="teacher-sessions-view" sx={{ gap: 3 }}>
      <Stack sx={{ gap: 2 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {t.teacherPageTitle}
        </Typography>
        <SessionStatusFilterChips value={statusFilter} onChange={handleFilterChange} />
      </Stack>
      <TeacherSessionsBody
        statusFilter={statusFilter}
        loading={loading}
        error={error}
        data={data}
        rowAlerts={rowAlerts}
        onCancelIntent={cancelArms.openCancelDialog}
        onDisputeIntent={disputeArms.openDisputeDialog}
        disputeInFlightSlots={slots.inFlightSlots}
        inFlightSlots={slots.inFlightSlots}
        onStart={mutations.handleStart}
        onComplete={mutations.handleComplete}
        t={t}
      />
      {cancelArms.cancelDialogSessionId !== null ? (
        <CancelSessionConfirmDialog
          key={cancelArms.cancelDialogSessionId}
          sessionId={cancelArms.cancelDialogSessionId}
          open
          onClose={cancelArms.closeCancelDialog}
          onCancelled={cancelArms.handleCancelled}
          onSessionMissing={cancelArms.handleSessionMissing}
          onInvalidTransition={cancelArms.handleInvalidTransition}
          onDuplicateReplay={cancelArms.handleDuplicateReplay}
          onFailure={cancelArms.handleFailure}
        />
      ) : null}
      {disputeArms.disputeDialogSessionId !== null ? (
        <SessionDisputeConfirmDialog
          key={disputeArms.disputeDialogSessionId}
          sessionId={disputeArms.disputeDialogSessionId}
          open
          onClose={disputeArms.closeDisputeDialog}
          onDisputed={disputeArms.handleDisputed}
          onSessionMissing={disputeArms.handleDisputeSessionMissing}
          onInvalidTransition={disputeArms.handleDisputeInvalidTransition}
          onFailure={disputeArms.handleDisputeFailure}
        />
      ) : null}
      <Snackbar
        open={notice !== null}
        autoHideDuration={SNACKBAR_AUTOHIDE_MS}
        onClose={dismissNotice}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {notice === null ? undefined : (
          <Alert onClose={dismissNotice} severity={notice.severity} variant="filled">
            {notice.message}
          </Alert>
        )}
      </Snackbar>
    </Stack>
  );
}
