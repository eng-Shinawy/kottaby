import type { students } from "@/backend/db/schema/students/students";
import type { UserSelectType } from "@/backend/types/users/user.types";

export type StudentSelectType = typeof students.$inferSelect;
export type StudentInsertType = typeof students.$inferInsert;

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
