import type { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
// NOTE: `LinkStatus` is used ONLY at type positions in this file. The
// mandated value-import form is auto-normalized to `import type` by Biome
// `lint/style/useImportType` (safe fix applied by `biome check --write`).
// Runtime consumers (the `isLinkStatus` fail-closed read-mapping guard and
// the service-layer status transitions) MUST keep their OWN value imports
// of `LinkStatus`.
import type { LinkStatus } from "@/backend/enum/shared/link-status.enum";

export type ParentLinkRequestSelectType = typeof parentLinkRequests.$inferSelect;
export type ParentLinkRequestInsertType = typeof parentLinkRequests.$inferInsert;

/**
 * OutgoingParentLinkRequestReturnType — the complete wire shape for a link
 * request owned by the requesting parent: the creation result, the
 * withdrawal (cancel) result, and every row of the parent's outgoing list.
 *
 * Closed, readonly output shape: exactly the fields the GraphQL
 * `OutgoingParentLinkRequest` object promises — nothing more. The student
 * appears ONLY through `studentMaskedName` (the deterministic
 * `maskFullName` output); the raw student identity, the parent FK, and
 * every internal column never cross this boundary (zero overlap with any
 * mutation input surface).
 *
 * - `status` re-applies the canonical `LinkStatus` TS mirror over the row;
 *   stored values are validated with `isLinkStatus` at the read-mapping
 *   boundary (fail-closed) before any value carries this type.
 * - `createdAt` / `expiresAt` / `respondedAt` are the raw row timestamps;
 *   `respondedAt` stays null until the request is resolved, and liveness
 *   (`expiresAt` vs the captured instant) is decided by the service, never
 *   re-derived by clients.
 */
export interface OutgoingParentLinkRequestReturnType {
  readonly id: number;
  readonly status: LinkStatus;
  readonly studentMaskedName: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt: Date | null;
}

/**
 * IncomingParentLinkRequestReturnType — the complete wire shape for a link
 * request addressed to the deciding student: every row of the student's
 * incoming list and the respond (accept/reject) result.
 *
 * Closed, readonly output shape: exactly the fields the GraphQL
 * `IncomingParentLinkRequest` object promises. The requesting parent
 * appears ONLY through `parentFullName` (an already-assembled display
 * name); the parent user id, the student FK, and every internal column
 * never cross this boundary.
 *
 * - `status` is guard-validated at the read-mapping boundary exactly like
 *   the outgoing shape.
 */
export interface IncomingParentLinkRequestReturnType {
  readonly id: number;
  readonly status: LinkStatus;
  readonly parentFullName: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt: Date | null;
}
