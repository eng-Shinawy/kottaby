/**
 * LinkStatus enum — mirrors the `link_status` pgEnum in
 * `backend/db/schema/enums.ts`. Values are canonical.
 * Used by `parent_link_requests.status` (reused frozen pgEnum — zero enum
 * edits; the value set is append-only).
 */
export enum LinkStatus {
  Pending = "pending",
  Confirmed = "confirmed",
  Rejected = "rejected",
  Expired = "expired",
}

/**
 * Type guard for a runtime link-status value (from a pgEnum row or a
 * transport payload). Returns `true` only for exact member strings — the
 * guard fails closed on any other input (wrong type, case mismatch,
 * whitespace, foreign values) rather than throwing.
 */
export function isLinkStatus(value: unknown): value is LinkStatus {
  return typeof value === "string" && (Object.values(LinkStatus) as string[]).includes(value);
}
