"use client";

/**
 * sessionBodyBranches — the role-neutral branch components shared by the
 * student and teacher sessions bodies (the visual state matrix's
 * query-error / empty-list / rows branches).
 *
 * Both role bodies apply the SAME error classification table (denial family
 * → the shared `PermissionDeniedFallback`; every other failure → the
 * localized generic inline alert), the SAME filtered-vs-generic empty-state
 * split (the filter-list icon + `filteredEmpty*` copy only when a status
 * chip is active), and the SAME row mapping (one `SessionRow` per payload —
 * cancel/dispute intents, per-row dispute slot, caller-resolved lifecycle
 * `actions`). The caller only picks the testids, the unfiltered icon and
 * copy, and the role's affordance builder, so the suites' byte-stable
 * anchors (`student-sessions-error` / `teacher-sessions-error`,
 * `student-sessions-empty` / `teacher-sessions-empty`) survive here as
 * plain prop values.
 */

import { FilterListOutlined as FilteredIcon, type SvgIconComponent } from "@mui/icons-material";
import { Alert, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type {
  MyStudentSessionsQuery_myStudentSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { SessionRow } from "@/frontend/views/student/sessions/SessionRow";
import { SessionsEmptyState } from "@/frontend/views/student/sessions/SessionsEmptyState";
import type { SessionRowAction } from "@/frontend/views/student/sessions/sessionRowAction";
import type { SessionRowRole } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { type InFlightSlotBook, isSlotInFlight } from "@/frontend/views/student/sessions/sessionRowSlotBook";

interface SessionQueryErrorBodyProps {
  readonly error: unknown;
  /** The per-role error-alert testid (suite anchor). */
  readonly errorTestId: string;
  /** The localized generic error copy (`sessions.genericError`). */
  readonly genericErrorMessage: string;
}

/**
 * Settled query failure: denial family (FORBIDDEN → `permission-fallback`;
 * UNAUTHORIZED → `auth-recovery`, surfacing identically after the error
 * link's refresh-retry path has given up — ApplicantStatusCard precedent)
 * maps to the shared section fallback; every other settled failure renders
 * the localized generic inline alert.
 */
export function SessionQueryErrorBody({
  error,
  errorTestId,
  genericErrorMessage,
}: Readonly<SessionQueryErrorBodyProps>): ReactNode {
  const rawCode = extractErrorCode(error);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
  const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
  if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
    return <PermissionDeniedFallback />;
  }
  return (
    <Stack data-testid={errorTestId} sx={{ py: { xs: 4, sm: 6 } }}>
      <Alert severity="error" variant="outlined">
        {genericErrorMessage}
      </Alert>
    </Stack>
  );
}

interface SessionsEmptyBranchProps {
  readonly statusFilter: SessionStatus | null;
  /** The container-owned empty-state testid (suite anchor). */
  readonly testId: string;
  /** The unfiltered ("all") icon filling the tinted circle. */
  readonly emptyIcon: SvgIconComponent;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
}

/**
 * An empty page: the DISTINCT filtered-empty copy (filter-list icon,
 * `filteredEmpty*`) only when a status chip is active; the caller's generic
 * empty state stays reserved for the unfiltered "all" view.
 */
export function SessionsEmptyBranch(props: Readonly<SessionsEmptyBranchProps>): ReactNode {
  const { statusFilter, testId, emptyIcon, emptyTitle, emptyBody, filteredTitle, filteredBody } = props;
  const isFiltered = statusFilter !== null;
  return (
    <SessionsEmptyState
      testId={testId}
      icon={isFiltered ? FilteredIcon : emptyIcon}
      title={isFiltered ? filteredTitle : emptyTitle}
      body={isFiltered ? filteredBody : emptyBody}
    />
  );
}

interface SessionsRowListProps {
  /**
   * The session payload rows (normalized `Session` entities). The student
   * and teacher list item types are structurally identical codegen shapes
   * (see `SessionRow`'s contract), so both roles feed this one slot.
   */
  readonly sessions: readonly MyStudentSessionsQuery_myStudentSessions_items[];
  readonly rowAlerts: Readonly<Record<string, string>>;
  /** Cancel-CTA intent — the container owns the dialog slot. */
  readonly onCancelIntent: (sessionId: string) => void;
  /** Dispute-CTA intent — the container owns the dispute-dialog slot. */
  readonly onDisputeIntent: (sessionId: string) => void;
  /** Per-row dispute slot book — dispute CTAs disable per row. */
  readonly disputeInFlightSlots: InFlightSlotBook<string>;
  /**
   * The row-owner role token (each role surface's container constant) —
   * scopes every row's dispute affordance matrix via `isDisputable`.
   */
  readonly role: SessionRowRole;
  /** The role's lifecycle-affordance builder (confirm / start / complete). */
  readonly actionsFor: (session: MyStudentSessionsQuery_myStudentSessions_items) => ReadonlyArray<SessionRowAction>;
  /**
   * Case-detail intent — forwarded to every row (the row renders the
   * "Case details" affordance only while it carries dispute history).
   * Omitted by the student surface (no case dialog there); supplied by the
   * teacher surface's container.
   */
  readonly onCaseIntent?: (sessionId: string) => void;
  /**
   * Details intent — forwarded to every row (the row renders the
   * read-only "Session details" icon-button for EVERY status while its
   * container supplies the intent). Omitted surfaces render no affordance.
   */
  readonly onDetailsIntent?: (sessionId: string) => void;
  /**
   * The teacher surface's rubric-pending overlay — the pending read's id
   * set plus the localized pill label. A row whose id is in the set
   * renders the "awaiting your evaluation" pill beside its meta cells
   * (the same membership gate that renders the row's submit CTA, so pill
   * and CTA always agree). The student surface omits the prop.
   */
  readonly awaitingEvaluation?: {
    readonly ids: ReadonlySet<string>;
    readonly label: string;
  };
  /**
   * The teacher surface's parked-draft overlay — the storage membership
   * read's id set (session ids whose draft is parked and restorable) plus
   * the localized chip label. A row whose id is in the set renders the
   * chip beside its meta cells so the evaluator can see WHICH pending
   * sessions carry an unsubmitted draft without opening the dialog. The
   * student surface omits the prop (no rubric flow there).
   */
  readonly parkedDrafts?: {
    readonly ids: ReadonlySet<string>;
    readonly label: string;
  };
}

/**
 * The rows branch: one `SessionRow` per payload, each row's dispute CTA
 * disabled iff ITS OWN `dispute` slot is open and its lifecycle CTAs
 * resolved through the caller's affordance matrix (per payload shape).
 */
export function SessionsRowList(props: Readonly<SessionsRowListProps>): ReactNode {
  const {
    sessions,
    rowAlerts,
    onCancelIntent,
    onDisputeIntent,
    disputeInFlightSlots,
    role,
    actionsFor,
    onCaseIntent,
    onDetailsIntent,
    awaitingEvaluation,
    parkedDrafts,
  } = props;
  return (
    <Stack sx={{ gap: 2 }}>
      {sessions.map(session => (
        <SessionRow
          key={session.id}
          session={session}
          alertMessage={rowAlerts[session.id] ?? null}
          onCancelIntent={onCancelIntent}
          onDisputeIntent={onDisputeIntent}
          disputeDisabled={isSlotInFlight(disputeInFlightSlots, session.id, "dispute")}
          role={role}
          actions={actionsFor(session)}
          onCaseIntent={onCaseIntent}
          onDetailsIntent={onDetailsIntent}
          awaitingEvaluationLabel={awaitingEvaluation?.ids.has(session.id) ? awaitingEvaluation.label : null}
          parkedDraftLabel={parkedDrafts?.ids.has(session.id) ? parkedDrafts.label : null}
        />
      ))}
    </Stack>
  );
}
