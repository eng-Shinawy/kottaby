"use client";

import { GavelOutlined as EmptyIcon } from "@mui/icons-material";
import { Alert, Box, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type {
  AdminDisputedSessionsQuery,
  AdminDisputedSessionsQuery_adminDisputedSessions_items,
} from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { AdminDisputeRow } from "@/frontend/views/admin/disputes/AdminDisputeRow";
import { AdminDisputesPager } from "@/frontend/views/admin/disputes/AdminDisputesPager";
import { SessionsEmptyState } from "@/frontend/views/student/sessions/SessionsEmptyState";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputesBody — the swapping body BELOW the admin arbitration queue's
 * always-on chrome (`/disputes`, DEV3-005 R-111) — the visual state matrix
 * branches 1–5 as a pure presentational resolver (module scope keeps the
 * container a state+callbacks orchestrator; the chrome renders in EVERY
 * branch, only this body swaps):
 *
 * | # | Condition | Body |
 * |---|-----------|------|
 * | 1 | query in flight (no settled payload yet) | skeleton list rows mirroring the sessions loading skeleton (`aria-busy`) |
 * | 2 | query error, mapping-table denial family (`permission-fallback` / `auth-recovery`) | shared `PermissionDeniedFallback` (non-admin callers fail the admin role leg into FORBIDDEN — R-106) |
 * | 3 | any other query error (masked 500 …) | inline `Alert` with `sessions.genericError` |
 * | 4 | zero items | empty state via the shared `SessionsEmptyState` (gavel icon-circle, `adminDisputesEmpty*` copy — single pinned status, NO filtered variant) |
 * | 5 | rows present | `AdminDisputeRow` list + `AdminDisputesPager` (only when the honest total spans more than one page) |
 *
 * Query-context errors classify through the SINGLE `mapGraphQLErrorByCode`
 * table (`frontend/providers/apollo/error-link.map.ts`) — never the server
 * `message`.
 */

/** Skeleton row count — approximates list density without claiming data. */
const LOADING_ROW_COUNT = 3;

/**
 * Stable skeleton keys — module-scope so the loading rows never key off the
 * render-time array index (`noArrayIndexKey`).
 */
const LOADING_ROW_KEYS: readonly string[] = Array.from(
  { length: LOADING_ROW_COUNT },
  (_, index) => `skeleton-${index}`
);

interface AdminDisputesBodyProps {
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: AdminDisputedSessionsQuery | undefined;
  readonly page: number;
  readonly totalPages: number;
  /** Session id whose arbitration dialog is open (its resolve CTA disables). */
  readonly resolveDialogSessionId: string | null;
  readonly onPageChange: (nextPage: number) => void;
  readonly onResolveIntent: (sessionId: string) => void;
  readonly t: SessionsLabels;
}

/** The swapping body — skeleton / denial fallback / error / empty / rows + pager. */
export function AdminDisputesBody({
  loading,
  error,
  data,
  page,
  totalPages,
  resolveDialogSessionId,
  onPageChange,
  onResolveIntent,
  t,
}: Readonly<AdminDisputesBodyProps>): ReactNode {
  if (loading && data === undefined) {
    // Branch 1 — first fetch for the active page: skeleton rows announce
    // busy semantics. A cache-hit page change keeps the settled list
    // mounted (no skeleton flash on pager round-trips).
    return <AdminDisputesLoadingSkeleton />;
  }
  // Branches 2–3 — settled failures: denial family vs generic surfaced copy.
  if (error) {
    const rawCode = extractErrorCode(error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    // Denial family — FORBIDDEN maps to the shared section fallback (a
    // non-admin caller fails the R-106 role leg); UNAUTHORIZED
    // (auth-recovery) surfaces identically after the error link's
    // refresh-retry path has given up.
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return <AdminDisputesErrorNotice message={t.genericError} />;
  }
  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return <AdminDisputesLoadingSkeleton />;
  }
  const sessions: readonly AdminDisputedSessionsQuery_adminDisputedSessions_items[] = data.adminDisputedSessions.items;
  if (sessions.length === 0) {
    // Branch 4 — the queue drained: the shared icon-circle empty state with
    // the arbitration copy (single pinned status — NO filtered variant).
    return (
      <SessionsEmptyState
        testId="admin-disputes-empty"
        icon={EmptyIcon}
        title={t.adminDisputesEmptyTitle}
        body={t.adminDisputesEmptyBody}
      />
    );
  }
  // Branch 5 — rows + pager (the pager renders ONLY when the honest total
  // spans more than one page).
  return (
    <Stack sx={{ gap: 2 }}>
      {sessions.map(session => (
        <AdminDisputeRow
          key={session.id}
          session={session}
          t={t}
          onResolveIntent={onResolveIntent}
          resolveDisabled={resolveDialogSessionId === session.id}
        />
      ))}
      {totalPages > 1 ? (
        <AdminDisputesPager page={page} totalPages={totalPages} onPageChange={onPageChange} t={t} />
      ) : null}
    </Stack>
  );
}

interface AdminDisputesErrorNoticeProps {
  readonly message: string;
}

/** Settled query failure without a denial-family code — generic inline alert. */
function AdminDisputesErrorNotice({ message }: Readonly<AdminDisputesErrorNoticeProps>): ReactNode {
  return (
    <Stack data-testid="admin-disputes-error" sx={{ py: { xs: 4, sm: 6 } }}>
      <Alert severity="error" variant="outlined">
        {message}
      </Alert>
    </Stack>
  );
}

/**
 * Loading skeleton — bordered row shells mirroring the sessions containers'
 * loading skeleton's line rhythm (title text + rounded pill + body panel).
 */
function AdminDisputesLoadingSkeleton(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="admin-disputes-loading" sx={{ gap: 2 }}>
      {LOADING_ROW_KEYS.map(key => (
        <Box
          key={key}
          sx={theme => ({
            display: "grid",
            gap: 1.5,
            p: { xs: 2.5, sm: 3 },
            borderRadius: 3,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            bgcolor: theme.palette.surfaceContainerLow,
            boxShadow: theme.palette.shadow.card,
          })}
        >
          <Skeleton variant="text" sx={{ fontSize: "1.5rem", maxWidth: 260 }} />
          <Skeleton variant="rounded" sx={{ height: 24, width: 150, borderRadius: 999 }} />
          <Skeleton variant="rectangular" sx={{ height: 40, borderRadius: 2 }} />
        </Box>
      ))}
    </Stack>
  );
}
