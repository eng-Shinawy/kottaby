import type { session } from "@/backend/db/schema/classes/session";
import type { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import type { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";

export type SessionSelectType = typeof session.$inferSelect;
export type SessionInsertType = typeof session.$inferInsert;

/**
 * Canonical GraphQL/API read shape for a session row.
 *
 * Derived straight from the table's select row — identical to
 * `SessionSelectType`. The schema column markers (`SessionStatus`,
 * `SessionType`, `SessionIntent`, and the escrow provenance lane
 * `HeldBalanceLane | null` via the column's `$type<>()` binding) flow
 * through with no Omit/re-typing. No forbidden fields exist on this table:
 * both participant ids are exposed deliberately (each is already known to
 * every authorized viewer of the row by construction).
 */
export type SessionReturnType = typeof session.$inferSelect;

/**
 * The participant-list read row: the canonical select row PLUS the two
 * optional display-name enrichments the participant listers batch onto the
 * page items. Every other producer keeps returning plain `SessionReturnType`
 * rows — the enrichment members stay OPTIONAL (`?: … | null`) so the wider
 * shape stays structurally assignable everywhere the plain row is accepted,
 * and an unpopulated member is indistinguishable from "not enriched" (the
 * GraphQL `Session.student`/`Session.teacher` fields resolve `null` for it).
 */
export type SessionListItemType = SessionReturnType & {
  readonly studentName?: string | null;
  readonly teacherName?: string | null;
};

/**
 * Projection row of the participant-name batch read (`users.id` +
 * `users.full_name`): the minimal column pair the participant listers join
 * back onto the page rows. `full_name` is NOT NULL at the schema, so the
 * projection is a closed non-nullable pair.
 */
export interface SessionParticipantNameRowType {
  readonly id: number;
  readonly fullName: string;
}

/**
 * Student-facing booking intent vocabulary: Hifz | Tajweed only.
 * The evaluation member of the underlying session-intent enum is
 * structurally unreachable from a session submission — evaluation
 * sessions are governed by the evaluation-session contract, not here.
 */
export type SessionStudentIntentType = SessionIntent.Hifz | SessionIntent.Tajweed;

/**
 * Session submission input: the client-controlled whitelist ONLY (BOPLA).
 *
 * Every server-controlled column is structurally absent by construction —
 * row identity, the student identity (resolved from the caller's context),
 * lifecycle status, session type, platform fee, hold marker, held lane,
 * deadlines, confirmation stamps, and timestamps are resolved or written by
 * the producing service inside the creation transaction. A client payload
 * structurally cannot carry, spoof, or influence any of them.
 */
export interface SessionSubmitInput {
  readonly teacherId: number;
  readonly intent: SessionStudentIntentType;
}

/**
 * List filters for participant session reads. Empty/absent members drop
 * out of the query — they never error; a present member narrows the result
 * set by lifecycle status.
 */
export interface SessionListFilterInput {
  readonly status?: SessionStatus | null;
}

/**
 * Paginated participant read result. `page`/`pageSize` echo the request
 * honestly: an out-of-range page yields empty `items` next to the true
 * `totalCount` — never a fabricated window. The items are the
 * participant-list read rows (`SessionListItemType`): the optional
 * display-name members are populated ONLY by the participant listers
 * batch-enrichment, so producers returning plain rows stay accepted.
 */
export interface SessionPageReturnType {
  readonly items: readonly SessionListItemType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Cold-path probe row for transition-error classification: the minimal
 * column projection a service reads around a guarded update (after a
 * zero-row miss; before the arbitration COMPLETE write), to disambiguate
 * not-found vs not-a-participant vs wrong-state vs a never-started
 * dispute. Probe reads never feed writes.
 */
export type SessionTransitionProbeRowType = Pick<
  SessionSelectType,
  "id" | "status" | "startedAt" | "studentId" | "teacherId"
>;

/**
 * Rating-eligibility probe row for the student→teacher evaluation gate:
 * the minimal column projection a service reads to decide whether a
 * session may be rated — row identity, both participant ids, the lifecycle
 * status, and the dual-confirmation stamps. Probe reads never feed writes;
 * duplicate rating submissions are arbitrated downstream by the
 * evaluations table's unique (session, evaluator) constraint.
 */
export type SessionRatingEligibilityProbeType = Pick<
  SessionSelectType,
  "id" | "studentId" | "teacherId" | "status" | "confirmedByTeacherAt" | "confirmedByStudentAt"
>;

/**
 * Evaluation-booking input: the single client-controlled field (BOPLA).
 *
 * The evaluator choice is the ONLY thing a client may pick — the applicant
 * identity resolves from the caller's context, and every other column
 * (lifecycle status, session type, fee, hold marker, deadline, and
 * timestamps) is server-assigned field-by-field by the booking service
 * inside its creation transaction. A client payload structurally cannot
 * carry, spoof, or influence any of them.
 */
export interface BookEvaluationSessionInput {
  readonly evaluatorId: number;
}
