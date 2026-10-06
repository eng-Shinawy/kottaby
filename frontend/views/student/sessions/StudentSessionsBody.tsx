"use client";

import { EventOutlined as EmptyIcon } from "@mui/icons-material";
import type { ReactNode } from "react";
import type {
  MyStudentSessionsQuery,
  MyStudentSessionsQuery_myStudentSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { SessionsLoadingSkeleton } from "@/frontend/views/student/sessions/SessionsLoadingSkeleton";
import {
  SessionQueryErrorBody,
  SessionsEmptyBranch,
  SessionsRowList,
} from "@/frontend/views/student/sessions/sessionBodyBranches";
import type { SessionRowRole } from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { InFlightSlots } from "@/frontend/views/student/sessions/studentSessionInFlightSlots";
import { studentActionsForSession } from "@/frontend/views/student/sessions/studentSessionRowActions";
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
  /** Session ids the student has already rated — gates the Rate CTA + rated chip. */
  readonly ratedSessionIds: ReadonlySet<number>;
  /** Rate-CTA intent — the container owns the dialog slot. */
  readonly onRate: (sessionId: string) => void;
  /**
   * The row-owner role token supplied by the student container (the
   * student surface constant) — scopes the rows' dispute affordance matrix.
   */
  readonly role: SessionRowRole;
  /**
   * Case-detail intent — forwarded to every row (the row renders the
   * "Case details" affordance only while it carries dispute history).
   * The student surface supplies it (the filing participant's own case
   * dialog — `StudentDisputeCaseDialog` lives in the container's slot);
   * omitted surfaces (none today) simply render no affordance.
   */
  readonly onCaseIntent?: (sessionId: string) => void;
  /**
   * Details intent — forwarded to every row (the row renders the
   * read-only "Session details" affordance for EVERY status). The student
   * surface supplies it — its dialog slot lives in the container beside
   * the case-dialog slot.
   */
  readonly onDetailsIntent?: (sessionId: string) => void;
  readonly t: SessionsLabels;
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
  ratedSessionIds,
  onRate,
  role,
  onCaseIntent,
  onDetailsIntent,
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
    return (
      <SessionQueryErrorBody error={error} errorTestId="student-sessions-error" genericErrorMessage={t.genericError} />
    );
  }
  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return <SessionsLoadingSkeleton />;
  }
  const sessions: readonly MyStudentSessionsQuery_myStudentSessions_items[] = data.myStudentSessions.items;
  if (sessions.length === 0) {
    // Branches 4a/4b — an empty page: the DISTINCT filtered-empty copy only
    // when a status chip is active; the generic empty state stays reserved
    // for the unfiltered "all" view.
    return (
      <SessionsEmptyBranch
        statusFilter={statusFilter}
        testId="student-sessions-empty"
        emptyIcon={EmptyIcon}
        emptyTitle={t.studentEmptyTitle}
        emptyBody={t.studentEmptyBody}
        filteredTitle={t.filteredEmptyTitle}
        filteredBody={t.filteredEmptyBody}
      />
    );
  }
  // Branch 5 — rows (each row's confirm CTA disabled iff ITS OWN row+kind
  // slot is open; the affordance matrix resolves per payload shape, the
  // Rate CTA + rated chip keyed off the caller's rated set).
  return (
    <SessionsRowList
      sessions={sessions}
      rowAlerts={rowAlerts}
      onCancelIntent={onCancelIntent}
      onDisputeIntent={onDisputeIntent}
      disputeInFlightSlots={disputeInFlightSlots}
      role={role}
      actionsFor={session =>
        studentActionsForSession(session, { t, inFlightSlots, onConfirm, ratedSessionIds, onRate })
      }
      onCaseIntent={onCaseIntent}
      onDetailsIntent={onDetailsIntent}
    />
  );
}
