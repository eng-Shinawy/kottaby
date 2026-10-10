import {
  CancelOutlined as CancelledIcon,
  CheckCircleOutlined as CompletedIcon,
  ReportProblemOutlined as DisputedIcon,
  ScheduleOutlined as ScheduledIcon,
  PlayCircleOutlined as StartedIcon,
  type SvgIconComponent,
} from "@mui/icons-material";
import type { Palette } from "@mui/material/styles";
import {
  type MyStudentSessionsQuery_myStudentSessions_items,
  SessionIntent,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * Shared presentation tables for the session list row parts
 * (`SessionRow` + its extracted siblings in this folder).
 *
 * Every table is keyed by the server enum member STRINGS through
 * `Record<string, …>` lookups — oxlint `no-unsafe-enum-comparison` bans
 * `switch` over enum members and direct enum comparisons, so the lifecycle
 * vocabulary travels exclusively through these token tables.
 */

/** Typographic placeholder for nullable payload values (NOT locale copy). */
export const NO_VALUE_PLACEHOLDER = "—";

/**
 * Status-chip label-key union — the NARROW slice of `SessionsLabels` the
 * lifecycle chip may render. The namespace also carries template-function
 * labels (e.g. `adminDisputesCountLine`) that are NOT renderable as a chip
 * label, so the lookup table is keyed by this Pick-union, never the full
 * `keyof SessionsLabels`.
 */
export type StatusChipLabelKey = keyof Pick<
  SessionsLabels,
  "statusScheduled" | "statusStarted" | "statusCompleted" | "statusCancelled" | "statusDisputed"
>;

/** Chip label key per lifecycle status (vocabulary-stability pin includes `Disputed`). */
export const STATUS_LABEL_KEY: Record<string, StatusChipLabelKey> = {
  [SessionStatus.Scheduled]: "statusScheduled",
  [SessionStatus.Started]: "statusStarted",
  [SessionStatus.Completed]: "statusCompleted",
  [SessionStatus.Cancelled]: "statusCancelled",
  [SessionStatus.Disputed]: "statusDisputed",
};

/**
 * Resolves the row's lifecycle chip label: the {@link STATUS_LABEL_KEY}
 * table maps the payload member onto the `SessionsLabels` status key, an
 * unknown member falls back to the raw payload value verbatim (the
 * defensive-corrupt arm — identical posture to {@link resolveIntentTitle}).
 */
export function resolveStatusLabel(status: string, labels: SessionsLabels): string {
  const labelKey = STATUS_LABEL_KEY[status];
  return status in STATUS_LABEL_KEY && labelKey in labels ? labels[labelKey] : status;
}

/**
 * Intent-title label-key union — the slice of `SessionsLabels` the row's
 * localized intent title may render (the STATUS_LABEL_KEY mirror; keyed by
 * the `SessionIntent` member strings, typed to the new keys). Unknown
 * members fall back at the call site (defensive-corrupt arm — the raw
 * payload value renders verbatim there, mirroring the status fallback).
 */
type IntentChipLabelKey = keyof Pick<SessionsLabels, "intentHifz" | "intentTajweed" | "intentEvaluation">;

/** Intent label key per booking intent (vocabulary-stability pin includes `Evaluation`). */
const INTENT_LABEL_KEY: Record<string, IntentChipLabelKey> = {
  [SessionIntent.Hifz]: "intentHifz",
  [SessionIntent.Tajweed]: "intentTajweed",
  [SessionIntent.Evaluation]: "intentEvaluation",
};

/**
 * Resolves the row's LOCALIZED intent title: the {@link INTENT_LABEL_KEY}
 * table maps the payload member onto the `SessionsLabels` intent key, an
 * unknown member falls back to the raw payload value verbatim (the
 * defensive-corrupt arm — the same posture as the status fallback), and a
 * null intent resolves to {@link NO_VALUE_PLACEHOLDER}.
 */
export function resolveIntentTitle(intent: string | null, labels: SessionsLabels): string {
  if (intent === null) {
    return NO_VALUE_PLACEHOLDER;
  }
  const labelKey = INTENT_LABEL_KEY[intent];
  return intent in INTENT_LABEL_KEY && labelKey in labels ? labels[labelKey] : intent;
}

/**
 * Resolves the row-owner's counterpart identity band: the band each list
 * batch-enriches is the COUNTERPART side only, so the role picks which
 * payload band carries the name (teacher rows read the student band and
 * vice versa) plus its role caption. An unpopulated band resolves
 * `name: null` — the honest no-band answer `SessionRowCounterpart` renders
 * as nothing.
 */
export function resolveCounterpartBand(
  role: SessionRowRole,
  session: Pick<MyStudentSessionsQuery_myStudentSessions_items, "student" | "teacher">,
  labels: SessionsLabels
): { readonly name: string | null; readonly caption: string } {
  const band = role === "teacher" ? session.student : session.teacher;
  return {
    name: band?.fullName ?? null,
    caption: role === "teacher" ? labels.withStudentCaption : labels.withTeacherCaption,
  };
}

/** Visual tone family driving the chip's container/on-container pair. */
export type StatusTone = "info" | "primary" | "success" | "error" | "warning";

/** Tone per lifecycle status (Scheduled=info, Started=primary, terminal pairs). */
export const STATUS_TONE: Record<string, StatusTone> = {
  [SessionStatus.Scheduled]: "info",
  [SessionStatus.Started]: "primary",
  [SessionStatus.Completed]: "success",
  [SessionStatus.Cancelled]: "error",
  [SessionStatus.Disputed]: "warning",
};

/** Tone → Material 3 container/on-container pair (ProfileView pattern). */
export const TONE_COLORS: Record<
  string,
  { readonly bg: (palette: Palette) => string; readonly fg: (palette: Palette) => string }
> = {
  info: { bg: p => p.infoContainer, fg: p => p.onInfoContainer },
  primary: { bg: p => p.primaryContainer, fg: p => p.onPrimaryContainer },
  success: { bg: p => p.successContainer, fg: p => p.onSuccessContainer },
  error: { bg: p => p.errorContainer, fg: p => p.onErrorContainer },
  warning: { bg: p => p.warningContainer, fg: p => p.onWarningContainer },
};

/** Semantically-matching outlined chip icon per lifecycle status. */
export const STATUS_ICON: Record<string, SvgIconComponent> = {
  [SessionStatus.Scheduled]: ScheduledIcon,
  [SessionStatus.Started]: StartedIcon,
  [SessionStatus.Completed]: CompletedIcon,
  [SessionStatus.Cancelled]: CancelledIcon,
  [SessionStatus.Disputed]: DisputedIcon,
};

/**
 * Cancellable-lifecycle lookup — the Cancel CTA renders ENABLED only for
 * these statuses (Record lookup, never an enum comparison). Disputed rows
 * render the CTA DISABLED (the state machine forbids cancelling a disputed
 * session — R-110).
 */
export const CANCELLABLE_STATUSES: Record<string, true> = {
  [SessionStatus.Scheduled]: true,
  [SessionStatus.Started]: true,
};

/**
 * Confirm-pending lookup — the student's confirm affordance and
 * the "awaiting student confirmation" hint key off this status via Record
 * lookup (never an enum comparison). The row additionally requires the
 * student stamp to be unset and the hold still marked.
 */
export const CONFIRM_PENDING_STATUSES: Record<string, true> = {
  [SessionStatus.Completed]: true,
};

/**
 * Rate-eligible lookup — the student's Rate affordance keys off this status
 * via Record lookup (never an enum comparison). The row additionally
 * requires BOTH completion stamps (the dual-confirmation handshake) and the
 * session to be absent from the student's rated set.
 */
export const RATE_ELIGIBLE_STATUSES: Record<string, true> = {
  [SessionStatus.Completed]: true,
};

/** Disputed token (Record lookup — the disabled-Cancel state). */
export const DISPUTED_STATUS: Record<string, true> = {
  [SessionStatus.Disputed]: true,
};

/**
 * Hold-concluded lookup — the statuses where the fee-hold lifecycle has
 * REACHED its settled outcome, so `feeHeld = false` is the meaningful
 * "released/consumed" answer (Cancelled: the hold was refunded; Completed:
 * the hold was consumed by the dual-confirmation handshake or arbitration).
 * On the pre-settlement statuses (Scheduled/Started) and while a dispute is
 * open the hold is the EXPECTED state, so a `false` wire value there is an
 * edge/corrupt shape the details dialog answers with honest silence (the
 * same posture as the row pills, which render nothing when a shape
 * membership fails). Record lookup — never an enum comparison.
 */
export const HOLD_CONCLUDED_STATUSES: Record<string, true> = {
  [SessionStatus.Completed]: true,
  [SessionStatus.Cancelled]: true,
};

/**
 * Deadline-pending lookup — the statuses where the booking's
 * `confirmationDeadline` still governs the session's fate (the 24h window a
 * freshly created session may lapse within, per
 * `SESSION_CONFIRMATION_WINDOW_MS`). From Start onward the lifecycle has
 * moved past the deadline, so the timeline renders the stamp only while the
 * session is `Scheduled`. Record lookup — never an enum comparison.
 */
export const DEADLINE_PENDING_STATUSES: Record<string, true> = {
  [SessionStatus.Scheduled]: true,
};

/**
 * Disputable-lifecycle lookup — the dispute CTA renders ONLY for these
 * statuses (R-110: disputes open from `scheduled` or `started`). The set is
 * SHARED by the student and teacher rows and stays byte-stable: the
 * post-confirmation escalation is scoped by {@link isDisputable}'s role
 * clause, never by widening this table (which would leak the CTA onto
 * teacher rows).
 */
const DISPUTABLE_STATUSES: Record<string, true> = {
  [SessionStatus.Scheduled]: true,
  [SessionStatus.Started]: true,
};

/**
 * Post-confirmation disputable lookup — the STATUS clause of the student's
 * post-confirmation escalation. The full shape additionally requires the
 * student confirmation stamp to be SET and the held fee to be CONSUMED
 * ({@link isPostConfirmationDisputable}) — a completed row still holding
 * its fee is the exactly-once confirm-pending shape and stays
 * undisputable.
 */
const POST_CONFIRMATION_DISPUTABLE_STATUSES: Record<string, true> = {
  [SessionStatus.Completed]: true,
};

/** The dispute-shape slice of the shared session row the predicates read. */
type DisputeShapeRow = Pick<
  MyStudentSessionsQuery_myStudentSessions_items,
  "status" | "confirmedByStudentAt" | "feeHeld" | "resolvedAt"
>;

/**
 * The post-confirmation dispute shape: `Completed` ∧ student confirmation
 * stamp set ∧ hold consumed (escrow consumed by the dual-confirmation
 * handshake). Record lookups only — never an enum comparison.
 */
export function isPostConfirmationDisputable(session: DisputeShapeRow): boolean {
  return (
    session.status in POST_CONFIRMATION_DISPUTABLE_STATUSES &&
    session.confirmedByStudentAt !== null &&
    !session.feeHeld &&
    // Arbitration terminality: an arbitrated row (resolution stamp set)
    // renders NO re-dispute CTA — the admin's decision is binding, so the
    // affordance matrix mirrors the service-side denial exactly.
    session.resolvedAt === null
  );
}

/**
 * The row-owner role token the shared row affordances scope by. The student
 * and teacher surfaces each mount behind their own server-side page guard
 * (`withPageAuth`), so each surface passes its OWN constant down the shared
 * row slot. The token scopes only the UI affordance matrix — every dispute
 * mutation re-validates the caller's ownership + the state matrix
 * server-side, so a forged token can surface a denial, never access.
 */
export type SessionRowRole = "student" | "teacher";

/**
 * Role-scoped dispute eligibility for ONE session row — the dispute CTA's
 * affordance matrix. Pre-completion rows (the shipped
 * {@link DISPUTABLE_STATUSES} lookup) stay disputable for BOTH row roles;
 * the post-confirmation escalation
 * ({@link isPostConfirmationDisputable}) is reachable ONLY from the
 * student-role surface. The shared status set is deliberately NOT widened
 * here — role scoping happens at this seam, keeping the teacher rows'
 * dispute affordance byte-stable (pre-completion path only).
 */
export function isDisputable(session: DisputeShapeRow, role: SessionRowRole): boolean {
  if (session.status in DISPUTABLE_STATUSES) {
    return true;
  }
  return role === "student" && isPostConfirmationDisputable(session);
}

/**
 * Resolves ONE settled list row by session id (the details-dialog slot's
 * row-payload lookup): the slot stores only the id (the case-dialog slot's
 * shape), so the container re-reads the clicked row from its OWN settled
 * list payload — the counterpart bands are populated by the list producers
 * only (`sessionById` stays band-free by design), which is why the dialog's
 * band data rides this lookup instead of the single-session read. `null`
 * id or an id absent from the items resolves `null` — the honest no-band
 * answer the dialog renders as nothing.
 */
export function resolveSessionRowById<T extends { readonly id: string }>(
  items: readonly T[],
  sessionId: string | null
): T | null {
  if (sessionId === null) {
    return null;
  }
  return items.find(item => item.id === sessionId) ?? null;
}
