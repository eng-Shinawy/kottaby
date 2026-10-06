import type { students } from "@/backend/db/schema/students/students";
import type { UserSelectType } from "@/backend/types/users/user.types";

export type StudentSelectType = typeof students.$inferSelect;

/**
 * The ONLY payload a parent-facing handshake-code lookup may return.
 * Minimal by construction: no database identity, no contact fields, no
 * governance state — masked confirmation plus the linkable signal only.
 */
export interface HandshakeCodeLookupReturnType {
  readonly maskedName: string;
  readonly linkable: boolean;
}

/**
 * Internal discovery row shape for the handshake-code lookup — composed
 * exclusively from the canonical select types via indexed access (no
 * re-derived column shapes). Service-internal only: it never surfaces
 * through GraphQL; the parent-facing payload is HandshakeCodeLookupReturnType.
 */
export type HandshakeDiscoveryRowType = Pick<StudentSelectType, "parentId"> &
  Pick<UserSelectType, "fullName" | "isDeleted" | "isBlocked" | "suspended" | "suspendedAt" | "suspendedPeriodDays">;

/**
 * Server-internal row for resolving a parent-link target by handshake code —
 * the student identity plus the parent FK and the users-side governance
 * columns consumed by the discovery exclusion predicate. It exists for the
 * link-request write path only and NEVER surfaces through GraphQL (the
 * parent-facing payload remains HandshakeCodeLookupReturnType); unlike
 * HandshakeDiscoveryRowType it carries the raw student id so the write path
 * can address the target row directly.
 */
export interface StudentLinkTargetRowType {
  readonly studentId: number;
  readonly parentId: number | null;
  readonly fullName: string;
  readonly isDeleted: boolean | null;
  readonly isBlocked: boolean | null;
  readonly suspended: boolean | null;
  readonly suspendedAt: Date | null;
  readonly suspendedPeriodDays: number | null;
}

/**
 * `StudentSessionBalanceReturnType` — the caller's own prepaid
 * session-credit lanes, one integer counter per booking lane.
 *
 * Domain: each `balance_*` column on the `students` row counts PRE-PAID
 * session credits for its lane (trial, hifz, tajweed, reviews). The booking
 * flow spends these credits through the debit ladder — the trial lane is
 * drawn first, then the intent lane — while subscription activation credits
 * and refunds replenish them; THIS shape is the read-only surface over the
 * stored counters and carries none of that ladder logic (it answers "what
 * is stored", never re-computing spendability).
 *
 * Nullability mirrors the schema columns verbatim: `balance_trial` is NOT
 * NULL (the segregated one-time trial lane, zeroed at registration), while
 * the three purchased lanes are nullable columns whose NULL reads as "no
 * purchased credit ever landed on this lane" — surfaced honestly, never
 * fabricated into zeros. Closed by construction: no identifiers, no contact
 * fields, no governance state — the four lane counters only. A pure read
 * projection with no database identity of its own (the GraphQL object is an
 * embedded value type without an `id`).
 */
export interface StudentSessionBalanceReturnType {
  readonly balanceTrial: number;
  readonly balanceHifz: number | null;
  readonly balanceTajweed: number | null;
  readonly balanceReviews: number | null;
}
