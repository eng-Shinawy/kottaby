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
 * `totalCount` — never a fabricated window.
 */
export interface SessionPageReturnType {
  readonly items: readonly SessionReturnType[];
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
