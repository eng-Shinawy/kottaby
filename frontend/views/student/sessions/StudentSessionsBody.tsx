"use client";

import { EventOutlined as EmptyIcon, FilterListOutlined as FilteredIcon } from "@mui/icons-material";
import { Alert, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type {
  MyStudentSessionsQuery,
  MyStudentSessionsQuery_myStudentSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { SessionRow } from "@/frontend/views/student/sessions/SessionRow";
import { SessionsEmptyState } from "@/frontend/views/student/sessions/SessionsEmptyState";
import { SessionsLoadingSkeleton } from "@/frontend/views/student/sessions/SessionsLoadingSkeleton";
import { type InFlightSlots, isInFlight } from "@/frontend/views/student/sessions/studentSessionInFlightSlots";
import { studentActionsForSession } from "@/frontend/views/student/sessions/useStudentSessionConfirm";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

interface StudentSessionsBodyProps {
  readonly statusFilter: SessionStatus | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: MyStudentSessionsQuery | undefined;
  readonly rowAlerts: Readonly<Record<string, string>>;
  readonly onCancelIntent: (sessionId: string) => void;
  readonly onDisputeIntent: (sessionId: string) => void;
  /** Per-row dispute slot book — dispute CTAs disable per row. */
  readonly disputeInFlightSlots: InFlightSlots;
  /** Full per-row slot book — the confirm CTA disables per row. */
  readonly inFlightSlots: InFlightSlots;
  /** Confirm-CTA intent — the container owns the mutation. */
  readonly onConfirm: (sessionId: string) => void;
  readonly t: SessionsLabels;
}

interface SessionsErrorNoticeProps {
  readonly message: string;
}

/** Settled query failure without a denial-family code — generic inline alert. */
function SessionsErrorNotice({ message }: Readonly<SessionsErrorNoticeProps>): ReactNode {
  return (
    <Stack data-testid="student-sessions-error" sx={{ py: { xs: 4, sm: 6 } }}>
      <Alert severity="error" variant="outlined">
        {message}
      </Alert>
    </Stack>
  );
}

/**
 * The swapping body BELOW the always-on chrome — visual matrix branches 1–5
 * as a pure presentational resolver: skeleton / permission fallback / error
 * notice / empty (generic vs filtered) / rows. Every caller renders the
 * chrome ABOVE this body so the filter row never disappears (the former
 * early-return strandings are resolved in the container).
 */
export function StudentSessionsBody({
  statusFilter,
  loading,
  error,
  data,
  rowAlerts,
  onCancelIntent,
  onDisputeIntent,
  disputeInFlightSlots,
  inFlightSlots,
  onConfirm,
  t,
}: Readonly<StudentSessionsBodyProps>): ReactNode {
  if (loading && data === undefined) {
    // Branch 1 — first fetch for the active filter: skeleton rows announce
    // busy semantics. A cache-hit variables change keeps the settled list
    // mounted (no skeleton flash on filter round-trips).
    return <SessionsLoadingSkeleton />;
  }
  // Branches 2–3 — settled failures: denial family vs generic surfaced copy.
  if (error) {
    const rawCode = extractErrorCode(error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    // Denial family — FORBIDDEN maps to the shared section fallback;
    // UNAUTHORIZED (auth-recovery) surfaces identically after the error
    // link's refresh-retry path has given up (ApplicantStatusCard precedent).
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return <SessionsErrorNotice message={t.genericError} />;
  }
  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return <SessionsLoadingSkeleton />;
  }
  const sessions: readonly MyStudentSessionsQuery_myStudentSessions_items[] = data.myStudentSessions.items;
  if (sessions.length === 0) {
    // Branches 4a/4b — an empty page: the DISTINCT filtered-empty copy
    // (with the filter-list icon) only when a status chip is active; the
    // generic empty state stays reserved for the unfiltered "all" view.
    const isFiltered = statusFilter !== null;
    return (
      <SessionsEmptyState
        testId="student-sessions-empty"
        icon={isFiltered ? FilteredIcon : EmptyIcon}
        title={isFiltered ? t.filteredEmptyTitle : t.studentEmptyTitle}
        body={isFiltered ? t.filteredEmptyBody : t.studentEmptyBody}
      />
    );
  }
  // Branch 5 — rows (each row's confirm CTA disabled iff ITS OWN row+kind
  // slot is open; the affordance matrix resolves per payload shape).
  return (
    <Stack sx={{ gap: 2 }}>
      {sessions.map(session => (
        <SessionRow
          key={session.id}
          session={session}
          alertMessage={rowAlerts[session.id] ?? null}
          onCancelIntent={onCancelIntent}
          onDisputeIntent={onDisputeIntent}
          disputeDisabled={isInFlight(disputeInFlightSlots, session.id, "dispute")}
          actions={studentActionsForSession(session, {
            t,
            inFlightSlots,
            onConfirm,
          })}
        />
      ))}
    </Stack>
  );
}
