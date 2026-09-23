"use client";

import { useQuery } from "@apollo/client/react";
import { Stack } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import { SessionNoticeSnackbar } from "@/frontend/components/ui/sessionList";
import type { SessionStatus, SessionType } from "@/frontend/graphql/generated/gql/graphql";
import { adminSessionQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { AdminSessionDetailDrawer } from "@/frontend/views/admin/session-governance/AdminSessionDetailDrawer";
import { AdminSessionGovernanceChrome } from "@/frontend/views/admin/session-governance/AdminSessionGovernanceChrome";
import { AdminSessionGovernanceDialogs } from "@/frontend/views/admin/session-governance/AdminSessionGovernanceDialogs";
import { AdminSessionsBody } from "@/frontend/views/admin/session-governance/AdminSessionsBody";
import { JoinObservationAction } from "@/frontend/views/admin/session-governance/JoinObservationAction";
import { useAdminSessionGovernanceActions } from "@/frontend/views/admin/session-governance/useAdminSessionGovernanceActions";
import { useAdminSessionGovernanceData } from "@/frontend/views/admin/session-governance/useAdminSessionGovernanceData";
import { useAdminSessionGovernanceJoin } from "@/frontend/views/admin/session-governance/useAdminSessionGovernanceJoin";
import { AdminSessionGovernance, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * AdminSessionGovernanceContainer — the client orchestrator behind
 * `/admin/session-governance` (the admin directory over ALL
 * sessions plus the four governance operations).
 *
 * Stateful composition ONLY (mirrors the admin disputes orchestrator):
 * the Apollo bindings live in the domain hooks this container composes —
 * the read tier {@link useAdminSessionGovernanceData} (the stateful
 * directory query `adminSessions`, filter + honest-total paging) — while
 * this component keeps the drawer's nullable browse-detail query
 * (`adminSession`, skipped while closed) keyed to the drawer state it
 * owns; the write tier splits into
 * {@link useAdminSessionGovernanceActions} (the three governance-dialog
 * mutations + the notice slot + cancel idempotency) and
 * {@link useAdminSessionGovernanceJoin} (the drawer-banner join mutation).
 * The dialogs, drawer and banner stay presentational and receive triggers
 * + in-flight flags. `useLazyQuery` is banned per
 * `sharedDocuments/AGENTS.md`.
 *
 * Filter orchestration — the chrome edits a DRAFT (raw strings for the
 * participant-id fields, `yyyy-MM-dd` tokens for the creation window);
 * APPLY validates (ids must be whole numbers; a zero-width window is a
 * legitimate empty result) and commits the wire-shaped filter into state,
 * re-keying the query variables and resetting the 1-based page. RESET
 * restores the unfiltered directory. Filter id members are `Int` on the
 * wire (numbers, never strings) and the window bounds are ISO-8601 UTC
 * instants (inclusive from-midnight, EXCLUSIVE to-midnight — the repo's
 * half-open `created_at >= from AND < to` contract).
 *
 * Status summary — the chrome's per-status counts derive from the LOADED
 * page rows (real data only; the honest `totalCount` is the only
 * server-truth number surfaced — nothing is extrapolated across pages).
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
 *
 * Page-level authorization is owned by the server admin route guard —
 * this container performs no role logic. MUI v9 discipline: `sx`-only styling, theme-palette colors,
 * `*Outlined` icons only, RTL-safe logical composition.
 */

/** Raw filter-bar draft — participant ids stay STRINGS until APPLY validates. */
export interface DirectoryFilterDraft {
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly type: SessionType | null;
  readonly status: SessionStatus | null;
  /** `yyyy-MM-dd` tokens from the native date inputs (null = unset). */
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
}

/** Per-status summary over the LOADED page (real data only). */
export interface StatusSummaryCounts {
  readonly scheduled: number;
  readonly started: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly disputed: number;
  readonly needsAttention: number;
}

/**
 * The admin session-governance view: always-on chrome (title + honest-count
 * bar + status summary + filter bar) over a swapping body — skeleton /
 * permission fallback / error / empty / rows + pager — plus the detail
 * drawer, the governance dialogs, the join-observation banner and the
 * snackbar chrome.
 */
export function AdminSessionGovernanceContainer(): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);
  const tSessions = useAppTranslation(Sessions);
  const [drawerSessionId, setDrawerSessionId] = useState<string | null>(null);
  const directory = useAdminSessionGovernanceData();
  const actions = useAdminSessionGovernanceActions();
  const join = useAdminSessionGovernanceJoin({ onNotice: actions.noticeArm });

  const openDrawer = useCallback((sessionId: string): void => {
    setDrawerSessionId(sessionId);
  }, []);

  const closeDrawer = useCallback((): void => {
    setDrawerSessionId(null);
  }, []);

  // The drawer's nullable browse-detail read — skipped while closed, keyed
  // to the drawer state above (the ONLY query left in this module; every
  // other Apollo binding lives in the domain hooks).
  const detailQuery = useQuery(adminSessionQueryDocument, {
    variables: { id: drawerSessionId ?? "" },
    skip: drawerSessionId === null,
  });

  return (
    <Stack data-testid="admin-session-governance-view" sx={{ gap: 3 }}>
      <AdminSessionGovernanceChrome
        title={t.pageTitle}
        countLine={t.countLine(directory.totalCount)}
        statusCounts={directory.statusCounts}
        needsAttentionLabel={t.needsAttentionLabel}
        summaryScopeHint={t.summaryScopeHint}
        statusLabels={tSessions}
        filterDraft={directory.filterDraft}
        filterInvalidTeacherId={directory.filterInvalidIds.teacher}
        filterInvalidStudentId={directory.filterInvalidIds.student}
        filterInvalidMessage={t.filterInvalidId}
        onFilterDraftChange={directory.updateFilterDraft}
        onApplyFilters={directory.applyFilters}
        onResetFilters={directory.resetFilters}
      />
      <AdminSessionsBody
        loading={directory.loading}
        busy={directory.listBusy}
        error={directory.error}
        data={directory.data}
        page={directory.page}
        totalPages={directory.totalPages}
        filtersActive={directory.filtersActive}
        onRetry={() => {
          void directory.refetch();
        }}
        onPageChange={directory.changePage}
        onOpenDetails={openDrawer}
        onDialogIntent={actions.openDialog}
        t={t}
        tSessions={tSessions}
      />
      <AdminSessionGovernanceDialogs
        dialog={actions.dialog}
        rescheduleLoading={actions.rescheduleLoading}
        cancelLoading={actions.cancelLoading}
        reassignLoading={actions.reassignLoading}
        onClose={actions.closeDialog}
        onRescheduleSubmit={actions.submitReschedule}
        onCancelSubmit={actions.submitCancel}
        onReassignSubmit={actions.submitReassign}
      />
      <AdminSessionDetailDrawer
        open={drawerSessionId !== null}
        detail={detailQuery.data?.adminSession ?? null}
        loading={detailQuery.loading}
        error={detailQuery.error}
        tSessions={tSessions}
        onClose={closeDrawer}
        onRetry={() => {
          void detailQuery.refetch();
        }}
        joinBanner={
          drawerSessionId === null ? null : (
            <JoinObservationAction
              sessionId={drawerSessionId}
              joined={join.joinedSessionId === drawerSessionId}
              loading={join.joinLoading}
              onJoin={() => {
                void join.commitJoin({ variables: { input: { sessionId: drawerSessionId } } });
              }}
            />
          )
        }
      />
      <SessionNoticeSnackbar notice={actions.notice} onDismiss={actions.dismissNotice} />
    </Stack>
  );
}
