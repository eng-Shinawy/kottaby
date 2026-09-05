"use client";

import { useQuery } from "@apollo/client/react";
import { Stack } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import { adminDisputedSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { AdminDisputesBody } from "@/frontend/views/admin/disputes/AdminDisputesBody";
import { AdminDisputesChrome } from "@/frontend/views/admin/disputes/AdminDisputesChrome";
import { AdminDisputesNoticeSnackbar } from "@/frontend/views/admin/disputes/AdminDisputesNoticeSnackbar";
import { ResolveDisputeDialog } from "@/frontend/views/admin/disputes/ResolveDisputeDialog";
import { useAdminDisputesNotice } from "@/frontend/views/admin/disputes/useAdminDisputesNotice";
import { Sessions, useAppTranslation } from "@/shared/locale";

/**
 * AdminDisputesContainer — the client orchestrator behind `/disputes`
 * (DEV3-005 R-111, the admin arbitration queue).
 *
 * Stateful composition ONLY (mirrors the student/teacher sessions
 * orchestrators): the 1-based page lives in local `useState` and re-keys the
 * `useQuery` variables (`offset`), which re-runs the STATEFUL
 * `adminDisputedSessions` query (Apollo refetch semantics — `useLazyQuery`
 * is banned per `sharedDocuments/AGENTS.md`). The status filter is PINNED to
 * `Disputed` server-side (the admin predicate is status-first — R-106), so
 * no filter chips render; the sticky bar carries the honest total instead
 * ({@link AdminDisputesChrome}). Page-level authorization is owned by the
 * server guard (`withPageAuth` with `roles: [UserRole.Admin]`) — this
 * container performs no role logic (the admin query identity is
 * server-bound per BOPLA hygiene).
 *
 * The render state matrix (branches 1–5: skeleton / denial fallback /
 * generic error / empty / rows + pager) resolves in
 * {@link AdminDisputesBody} below the always-on chrome.
 *
 * Arbitration-dialog wiring (DEV3-005 R-104/R-111) — the
 * `resolveSessionDispute` mutation and its code classification live in
 * `ResolveDisputeDialog` (+ its `useResolveSessionDispute` seam); EVERY
 * outcome surfaces a snackbar through {@link useAdminDisputesNotice}
 * (success → queue row leaves via the dialog's cache filter, NO refetch,
 * ghost-page step-back guard · `SESSION_NOT_FOUND` /
 * `SESSION_INVALID_TRANSITION` → error snackbar, row stays ·
 * `VALIDATION` / `FORBIDDEN` / masked → error snackbar, dialog stays open).
 * Query-context errors classify through the SINGLE `mapGraphQLErrorByCode`
 * table (`frontend/providers/apollo/error-link.map.ts`) — never the server
 * `message`.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, `*Outlined` icons only, RTL-safe logical
 * composition.
 */

/** Page size — the backend's own default/clamp midpoint (R-106: 1..50, default 25). */
const ADMIN_DISPUTES_PAGE_SIZE = 25;

/** Clamps a 1-based page into `1..totalPages` (never renders a ghost page). */
function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

/**
 * The admin disputes view: ALWAYS-ON chrome (title + sticky honest-count
 * bar) over a swapping body — skeleton / permission fallback / error notice
 * / empty / rows + pager — plus the arbitration dialog and snackbar chrome.
 */
export function AdminDisputesContainer(): ReactNode {
  const t = useAppTranslation(Sessions);

  // 1-based page — re-keys the query variables (`offset`) on change.
  const [page, setPage] = useState(1);

  // Arbitration-dialog owner (single dialog slot, re-keyed per session id).
  const [resolveDialogSessionId, setResolveDialogSessionId] = useState<string | null>(null);

  const { data, loading, error } = useQuery(adminDisputedSessionsQueryDocument, {
    variables: {
      filter: null,
      limit: ADMIN_DISPUTES_PAGE_SIZE,
      offset: (page - 1) * ADMIN_DISPUTES_PAGE_SIZE,
    },
  });

  const totalCount = data?.adminDisputedSessions.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_DISPUTES_PAGE_SIZE));

  const openResolveDialog = useCallback((sessionId: string): void => {
    setResolveDialogSessionId(sessionId);
  }, []);

  const closeResolveDialog = useCallback((): void => {
    setResolveDialogSessionId(null);
  }, []);

  // Ghost-page step-back arm — functional update keeps the callback stable;
  // the guard in `useAdminDisputesNotice` only fires when page > 1, so the
  // clamp is defensive only.
  const stepToPreviousPage = useCallback((): void => {
    setPage(prev => Math.max(1, prev - 1));
  }, []);

  const { notice, dismissNotice, handleResolved, handleSessionMissing, handleInvalidTransition, onFailure } =
    useAdminDisputesNotice({ data, page, closeResolveDialog, stepToPreviousPage });

  const handlePageChange = useCallback(
    (nextPage: number): void => {
      setPage(clampPage(nextPage, totalPages));
    },
    [totalPages]
  );

  return (
    <Stack data-testid="admin-disputes-view" sx={{ gap: 3 }}>
      <AdminDisputesChrome title={t.adminDisputesPageTitle} countLine={t.adminDisputesCountLine(totalCount)} />
      <AdminDisputesBody
        loading={loading}
        error={error}
        data={data}
        page={page}
        totalPages={totalPages}
        resolveDialogSessionId={resolveDialogSessionId}
        onPageChange={handlePageChange}
        onResolveIntent={openResolveDialog}
        t={t}
      />
      {resolveDialogSessionId !== null ? (
        <ResolveDisputeDialog
          key={resolveDialogSessionId}
          sessionId={resolveDialogSessionId}
          open
          onClose={closeResolveDialog}
          onResolved={handleResolved}
          onSessionMissing={handleSessionMissing}
          onInvalidTransition={handleInvalidTransition}
          onFailure={onFailure}
        />
      ) : null}
      <AdminDisputesNoticeSnackbar notice={notice} onDismiss={dismissNotice} />
    </Stack>
  );
}
