"use client";

/**
 * TeacherSessionsBody — the swapping body BELOW the always-on chrome
 * (matrix branches 1–5) as a pure presentational resolver, extracted
 * verbatim from `TeacherSessionsContainer` (the max-lines split):
 * skeleton / permission fallback / error notice / empty (generic vs
 * filtered) / rows with lifecycle CTAs.
 */

import { SchoolOutlined as EmptyIcon } from "@mui/icons-material";
import type { ReactNode } from "react";
import {
  type MyTeacherSessionsQuery,
  type MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  SessionQueryErrorBody,
  SessionsEmptyBranch,
  SessionsRowList,
} from "@/frontend/views/student/sessions/sessionBodyBranches";
import type { SessionRowRole } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { TeacherSessionsLoadingSkeleton } from "@/frontend/views/teacher/sessions/TeacherSessionsLoadingSkeleton";
import { teacherActionsForSession } from "@/frontend/views/teacher/sessions/teacherSessionCacheArms";
import type { InFlightSlots } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { filterSessionsAwaitingRubric } from "@/frontend/views/teacher/sessions/teacherSessionsPendingFilter.helpers";
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
  /** Opens the homework viewer for a Started session (read-only). */
  readonly onHomework: (sessionId: string) => void;
  /** Opens the session report submission dialog for a Completed session. */
  readonly onReport: (sessionId: string) => void;
  /** Opens the rubric-evaluation dialog for a completed evaluation session. */
  readonly onSubmitEvaluation: (sessionId: string) => void;
  /**
   * Session ids that still owe a rubric submission (the evaluator's
   * pending read) — the submit-evaluation affordance gate.
   */
  readonly pendingRubricSessionIds: ReadonlySet<string>;
  /**
   * The parked-draft overlay — the storage membership read's id set plus
   * the localized chip label (see `SessionsRowList`). Omitted by surfaces
   * without the rubric flow.
   */
  readonly parkedDrafts?: {
    readonly ids: ReadonlySet<string>;
    readonly label: string;
  };
  /**
   * The pending-rubric banner's client-side lane — the settled rows are
   * filtered to the pending membership set (filter, pill, and CTA share
   * one source of truth). The status filter stays server-side; the two
   * lanes compose (toggle-ON clears the chip in the container).
   */
  readonly awaitingOnly: boolean;
  /**
   * The row-owner role token supplied by the teacher container (the
   * teacher surface constant) — scopes the rows' dispute affordance matrix
   * to the pre-completion path only.
   */
  readonly role: SessionRowRole;
  /**
   * Case-detail intent — opens the teacher dispute case dialog for the
   * session (rows with dispute history render the affordance; the row
   * itself scopes it via `disputeReason`).
   */
  readonly onCaseIntent: (sessionId: string) => void;
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
  awaitingOnly,
  rowAlerts,
  onCancelIntent,
  onDisputeIntent,
  disputeInFlightSlots,
  inFlightSlots,
  onStart,
  onComplete,
  onHomework,
  onReport,
  onSubmitEvaluation,
  pendingRubricSessionIds,
  parkedDrafts,
  role,
  onCaseIntent,
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
    return (
      <SessionQueryErrorBody error={error} errorTestId="teacher-sessions-error" genericErrorMessage={t.genericError} />
    );
  }
  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return <TeacherSessionsLoadingSkeleton />;
  }
  const settledSessions: readonly MyTeacherSessionsQuery_myTeacherSessions_items[] = data.myTeacherSessions.items;
  // The pending-only lane is a client-side membership pass (the status
  // chips stay server-side); an empty result under the lane renders the
  // filtered-empty copy (the lane counts as an active filter).
  const sessions = awaitingOnly
    ? filterSessionsAwaitingRubric(settledSessions, pendingRubricSessionIds)
    : settledSessions;
  if (sessions.length === 0) {
    // Branches 4a/4b — an empty page (the applicant teacher's permanent
    // state: an empty page, NEVER an error). The DISTINCT filtered-empty
    // copy only when a status chip OR the pending-only lane is active; the
    // generic empty state stays reserved for the unfiltered "all" view.
    return (
      <SessionsEmptyBranch
        statusFilter={awaitingOnly ? (statusFilter ?? SessionStatus.Completed) : statusFilter}
        testId="teacher-sessions-empty"
        emptyIcon={EmptyIcon}
        emptyTitle={t.teacherEmptyTitle}
        emptyBody={t.teacherEmptyBody}
        filteredTitle={t.filteredEmptyTitle}
        filteredBody={t.filteredEmptyBody}
      />
    );
  }
  // Branch 5 — rows + lifecycle CTAs (each CTA disabled iff ITS OWN row+kind
  // slot is open).
  return (
    <SessionsRowList
      sessions={sessions}
      rowAlerts={rowAlerts}
      onCancelIntent={onCancelIntent}
      onDisputeIntent={onDisputeIntent}
      disputeInFlightSlots={disputeInFlightSlots}
      role={role}
      actionsFor={session =>
        teacherActionsForSession(session, {
          t,
          inFlightSlots,
          onStart,
          onComplete,
          onHomework,
          onReport,
          onSubmitEvaluation,
          pendingRubricSessionIds,
        })
      }
      onCaseIntent={onCaseIntent}
      // The rubric-pending overlay rides the SAME membership set that
      // gates the rows' submit CTA — pill and affordance can never drift.
      awaitingEvaluation={{ ids: pendingRubricSessionIds, label: t.awaitingEvaluation }}
      parkedDrafts={parkedDrafts}
    />
  );
}
