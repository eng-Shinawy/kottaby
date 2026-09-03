"use client";

/**
 * TeacherSessionsBody — the swapping body BELOW the always-on chrome
 * (matrix branches 1–5) as a pure presentational resolver, extracted
 * verbatim from `TeacherSessionsContainer` (the max-lines split):
 * skeleton / permission fallback / error notice / empty (generic vs
 * filtered) / rows with lifecycle CTAs.
 */

import { SchoolOutlined as EmptyIcon, FilterListOutlined as FilteredIcon } from "@mui/icons-material";
import { Alert, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type {
  MyTeacherSessionsQuery,
  MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { SessionRow } from "@/frontend/views/student/sessions/SessionRow";
import { SessionsEmptyState } from "@/frontend/views/student/sessions/SessionsEmptyState";
import { TeacherSessionsLoadingSkeleton } from "@/frontend/views/teacher/sessions/TeacherSessionsLoadingSkeleton";
import { teacherActionsForSession } from "@/frontend/views/teacher/sessions/teacherSessionCacheArms";
import { type InFlightSlots, isInFlight } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

export interface TeacherSessionsBodyProps {
  readonly statusFilter: SessionStatus | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: MyTeacherSessionsQuery | undefined;
  readonly rowAlerts: Readonly<Record<string, string>>;
  readonly onCancelIntent: (sessionId: string) => void;
  readonly onDisputeIntent: (sessionId: string) => void;
  /** Per-row dispute slot book — dispute CTAs disable per row. */
  readonly disputeInFlightSlots: InFlightSlots;
  readonly inFlightSlots: InFlightSlots;
  readonly onStart: (sessionId: string) => void;
  readonly onComplete: (sessionId: string) => void;
  readonly t: SessionsLabels;
}

/**
 * The swapping body BELOW the always-on chrome — matrix branches 1–5 as a
 * pure presentational resolver (module-scope so the container stays a
 * state+callbacks orchestrator): skeleton / permission fallback / error
 * notice / empty (generic vs filtered) / rows with lifecycle CTAs.
 */
export function TeacherSessionsBody({
  statusFilter,
  loading,
  error,
  data,
  rowAlerts,
  onCancelIntent,
  onDisputeIntent,
  disputeInFlightSlots,
  inFlightSlots,
  onStart,
  onComplete,
  t,
}: Readonly<TeacherSessionsBodyProps>): ReactNode {
  if (loading && data === undefined) {
    // Branch 1 — first fetch for the active filter: skeleton rows announce
    // busy semantics. A cache-hit variables change keeps the settled list
    // mounted (no skeleton flash on filter round-trips).
    return <TeacherSessionsLoadingSkeleton />;
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
    return <TeacherSessionsLoadingSkeleton />;
  }
  const sessions: readonly MyTeacherSessionsQuery_myTeacherSessions_items[] = data.myTeacherSessions.items;
  if (sessions.length === 0) {
    // Branches 4a/4b — an empty page (the applicant teacher's permanent
    // state: an empty page, NEVER an error). The DISTINCT filtered-empty
    // copy (with the filter-list icon) only when a status chip is active;
    // the generic empty state stays reserved for the unfiltered "all" view.
    const isFiltered = statusFilter !== null;
    return (
      <SessionsEmptyState
        testId="teacher-sessions-empty"
        icon={isFiltered ? FilteredIcon : EmptyIcon}
        title={isFiltered ? t.filteredEmptyTitle : t.teacherEmptyTitle}
        body={isFiltered ? t.filteredEmptyBody : t.teacherEmptyBody}
      />
    );
  }
  // Branch 5 — rows + lifecycle CTAs (each CTA disabled iff ITS OWN row+kind
  // slot is open).
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
          actions={teacherActionsForSession(session, {
            t,
            inFlightSlots,
            onStart,
            onComplete,
          })}
        />
      ))}
    </Stack>
  );
}

interface SessionsErrorNoticeProps {
  readonly message: string;
}

/** Settled query failure without a denial-family code — generic inline alert. */
function SessionsErrorNotice({ message }: Readonly<SessionsErrorNoticeProps>): ReactNode {
  return (
    <Stack data-testid="teacher-sessions-error" sx={{ py: { xs: 4, sm: 6 } }}>
      <Alert severity="error" variant="outlined">
        {message}
      </Alert>
    </Stack>
  );
}
