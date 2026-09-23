import type { AdminAuditLogEntryReturnType } from "@/backend/types/audit/audit-trail.types";
import type { HomeWorkReturnType } from "@/backend/types/classes/home-work.types";
import type { RecitationReturnType } from "@/backend/types/classes/recitation.types";
import type { ReportReturnType } from "@/backend/types/classes/report.types";
import type { SessionReturnType, SessionSelectType } from "@/backend/types/classes/session.types";

/**
 * Post-confirmation session arbitration — the canonical types for the
 * consumed-escrow dispute path.
 *
 * A dual-confirmed session (`completed`, escrow consumed, teacher wallet
 * credited) may be disputed by the student; an admin then arbitrates with a
 * binding outcome out of the consumed-escrow `DisputeResolution` members
 * (`Refund` | `PartialRefund` | `Uphold`). The held-escrow dispute
 * generation (`scheduled`/`started` rows, resolved with `Cancel`/`Complete`)
 * shares the vocabulary but none of these types — its machinery lives in the
 * shipped session lifecycle.
 *
 * Every shape here is a read/call contract between the service layer and its
 * callers (GraphQL resolvers, sibling services): nothing in this file is
 * exposed to clients directly — the GraphQL surface binds its own object
 * types to these canonical shapes.
 */

/**
 * Arbitration classification probe: the escrow-focused column projection a
 * service reads to classify a disputed row before arbitrating it — row
 * identity, lifecycle state, both participants, and the financial facts that
 * discriminate the two dispute generations and drive the outcome legs
 * (`fee` amount, `feeHeld` hold marker, the permanent provenance lane, and
 * the student's dual-confirmation stamp). Extends the shipped transition
 * probe convention: a minimal `Pick` projection of the select row, read on
 * the cold path only — a probe read never gates or feeds a write.
 *
 * Member types flow straight from the schema select row: `fee` is the
 * decimal string (money is never re-typed), `feeHeld` stays column-nullable,
 * `heldBalanceLane` carries the `HeldBalanceLane | null` provenance
 * vocabulary via the column's type binding (NULL only while no fee was ever
 * held), and `confirmedByStudentAt` is `Date | null`.
 */
export type SessionArbitrationProbeType = Pick<
  SessionSelectType,
  | "id"
  | "status"
  | "studentId"
  | "teacherId"
  | "fee"
  | "feeHeld"
  | "heldBalanceLane"
  | "confirmedByStudentAt"
  | "resolutionOutcome"
  | "resolvedAt"
>;

/**
 * Admin case-review read: the complete evidence bundle an admin's
 * arbitration decision is based on, in one response — the full session row
 * (dispute reason, stamps, fee, hold marker, provenance lane), the session
 * report with its homework row, the recitation record, and the
 * session-scoped audit trail.
 *
 * Absent artifacts are honest `null`s — a session with no submitted report,
 * homework, or recitation renders no fabricated placeholder. The audit
 * trail entries are the canonical rendered admin-trail rows
 * (`AdminAuditLogEntryReturnType`), newest-first, and carry no note content
 * beyond what the audit convention already records. The participant display
 * names resolve server-side; an unreachable user row surfaces as an honest
 * `null` the view replaces with the numeric identity.
 */
export interface AdminDisputeCaseReturnType {
  readonly session: SessionReturnType;
  readonly report: ReportReturnType | null;
  readonly homework: HomeWorkReturnType | null;
  readonly recitation: RecitationReturnType | null;
  readonly auditTrail: readonly AdminAuditLogEntryReturnType[];
  readonly studentName: string | null;
  readonly teacherName: string | null;
}

/**
 * Teacher case-detail read: the dispute case bundle a session's OWN
 * teacher sees — the full session row (dispute reason, stamps, fee, hold
 * marker, provenance lane), the session report, the homework row and the
 * recitation record (all participant-owned artifacts), plus the
 * server-resolved student display name. The session-scoped audit trail is
 * deliberately ABSENT from this bundle: the trail is the admin governance
 * surface (`AuditTrailService` asserts an admin actor), so the teacher's
 * transparency comes from the dispute evidence itself, never from the
 * admin-only trail.
 *
 * Absent artifacts are honest `null`s — a session with no submitted
 * report, homework, or recitation renders no fabricated placeholder. The
 * student display name resolves server-side; an unreachable user row
 * surfaces as an honest `null` the view replaces with the numeric
 * identity.
 */
export interface TeacherDisputeCaseReturnType {
  readonly session: SessionReturnType;
  readonly report: ReportReturnType | null;
  readonly homework: HomeWorkReturnType | null;
  readonly recitation: RecitationReturnType | null;
  readonly studentName: string | null;
}

/**
 * The STUDENT mirror of the teacher case bundle — the filing participant's
 * own transparency read behind the arbitration story (the student surface's
 * "Case details" dialog). The producer is
 * `SessionArbitrationService.getStudentDisputeCase` (the participant
 * predicate lives service-side; non-participants and unknown ids collapse
 * into the same oracle-safe not-found denial). The bundle shape is the
 * teacher's mirrored: the session row, the participant-owned artifacts
 * (honest `null`s — never fabricated placeholders) and the TEACHER display
 * name resolved server-side (the caller's own name is equally absent —
 * the student knows who they are). The admin-only audit trail is
 * deliberately ABSENT (the trail read asserts an admin actor).
 */
export interface StudentDisputeCaseReturnType {
  readonly session: SessionReturnType;
  readonly report: ReportReturnType | null;
  readonly homework: HomeWorkReturnType | null;
  readonly recitation: RecitationReturnType | null;
  readonly teacherName: string | null;
}

/**
 * One admin arbitration queue row: the disputed session's full row wrapped
 * with the server-resolved participant display names, so the queue renders
 * identities without per-row user probes.
 *
 * Absent user rows surface as honest `null`s the view replaces with the
 * numeric identity.
 */
export interface AdminDisputedSessionRowReturnType {
  readonly session: SessionReturnType;
  readonly studentName: string | null;
  readonly teacherName: string | null;
}

/**
 * The admin arbitration queue page: one page of
 * `AdminDisputedSessionRowReturnType` entries plus the honest pagination
 * tail (the same envelope the shared session pages carry). The pinned
 * `disputed` scope lives in the query's service; this shape adds ONLY the
 * display names.
 */
export interface AdminDisputedSessionPageReturnType {
  readonly items: readonly AdminDisputedSessionRowReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Admin dispute analytics snapshot: the aggregate dispute counts read in
 * ONE table pass — the currently OPEN disputes (the arbitration queue's
 * own membership predicate), the total RESOLVED disputes (any resolution
 * family), and the per-outcome breakdown keyed to each `DisputeResolution`
 * member (the persisted `resolution_outcome` vocabulary, both escrow
 * generations included). Every value is an honest count of real rows —
 * zero is a legitimate answer, never a fabricated placeholder.
 */
export interface AdminDisputeAnalyticsReturnType {
  readonly openDisputes: number;
  readonly resolvedDisputes: number;
  readonly cancelCount: number;
  readonly completeCount: number;
  readonly refundCount: number;
  readonly partialRefundCount: number;
  readonly upholdCount: number;
}
