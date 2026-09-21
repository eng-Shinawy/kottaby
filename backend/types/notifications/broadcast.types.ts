import type { broadcasts } from "@/backend/db/schema/notifications/broadcasts";
import type { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import type { BroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";
import type { UserRole } from "@/backend/enum/users/user-role.enum";

/**
 * Type-discriminated audience selector for an admin broadcast — the closed
 * statement of "who receives this broadcast".
 *
 * Exactly one companion field is meaningful per `type` member; the service
 * layer enforces the coherence matrix (fail-closed, pre-database) before any
 * cohort resolution:
 *
 * - `All`     — every companion absent (whole governed user base).
 * - `Role`    — `role` required; `country` / `planId` absent.
 * - `Country` — `country` required (trimmed, at most 100 characters);
 *   `role` / `planId` absent.
 * - `Plan`    — `planId` required (positive safe integer); `role` /
 *   `country` absent.
 *
 * The shape is readonly and closed: no index signature, no optional escape
 * hatch — callers map fields explicitly (never a `{ ...input }` spread into
 * persistence). It is the wire + service input shape and is request-scoped:
 * it is never persisted (individual notification rows record the resolved
 * recipient, not the cohort), so it has no schema-derived counterpart.
 */
export interface BroadcastAudienceSelector {
  readonly type: BroadcastAudienceType;
  /** Recipient role — meaningful only when `type` is `Role`. */
  readonly role?: UserRole | null;
  /** Recipient country (exact match) — meaningful only when `type` is `Country`. */
  readonly country?: string | null;
  /** Plan whose active subscribers receive the broadcast — meaningful only when `type` is `Plan`. */
  readonly planId?: number | null;
}

/**
 * Admin-authored broadcast submission — the closed input surface of the
 * admin broadcast mutation, mapped field-by-field into the notification
 * engine's batch emit (never spread).
 *
 * - `title` — non-empty after trim, at most 255 characters (the engine's
 *   title ceiling).
 * - `body` — optional long-form copy; `null` when absent. Stored verbatim
 *   and never localized per recipient (rendering carries `dir="auto"`).
 * - `audience` — the cohort selector. Recipients are resolved server-side
 *   exclusively from it; the caller can never name an individual user.
 */
export interface BroadcastNotificationSubmitInput {
  readonly title: string;
  readonly body: string | null;
  readonly audience: BroadcastAudienceSelector;
}

/**
 * The persisted row shape of the `broadcasts` header table — one row per
 * accepted send, carrying the verbatim copy, the audience snapshot, the
 * sender, the recipient count, and the one-way lifecycle state.
 *
 * Field semantics:
 * - `audienceType` — nullable cohort snapshot: historical rows whose audit
 *   snapshot is missing or unrecognized stay valid instead of blocking a
 *   backfill.
 * - `audienceRole` / `audienceCountry` / `audiencePlanId` — the snapshot
 *   companions; `audiencePlanId` deliberately carries no foreign key (the
 *   plan may be deleted later without invalidating history).
 * - `status` — the one-way `active → stopped` lifecycle state; `stopped` is
 *   terminal.
 * - `sentById` — the sender, restrict-deleted against `users` so send
 *   provenance always attributes to a real user; `stoppedById` — the
 *   stopper, nullable and set-null on user deletion (optional provenance).
 * - `idempotencyKey` — nullable unique caller-owned dedupe key; the unique
 *   violation is the send-path replay arbiter.
 */
export type BroadcastSelectType = typeof broadcasts.$inferSelect;

/**
 * Insert shape for the `broadcasts` header table (the `$inferInsert`
 * contract): columns with defaults (`status`, `sentAt`) and nullable columns
 * are optional; the copy, the recipient count, and the sender are required.
 */
export type BroadcastInsertType = typeof broadcasts.$inferInsert;

/**
 * `AdminBroadcastEntryReturnType` — one row of the admin broadcast history
 * listing: the header row's fields plus the sender/stopper display names
 * (`sentByName` / `stoppedByName`), which the list/detail query resolves via
 * SQL joins against `users` — never per-row service fetches. Names are the
 * CURRENT `users.full_name` (documented, not a snapshot).
 */
export interface AdminBroadcastEntryReturnType {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly audienceType: BroadcastAudienceType | null;
  readonly audienceRole: UserRole | null;
  readonly audienceCountry: string | null;
  readonly audiencePlanId: number | null;
  readonly status: BroadcastStatus;
  readonly recipientCount: number;
  readonly sentById: number;
  readonly sentByName: string;
  readonly sentAt: Date;
  readonly stoppedById: number | null;
  readonly stoppedByName: string | null;
  readonly stoppedAt: Date | null;
}

/**
 * `AdminBroadcastPageReturnType` — paginated admin broadcast history
 * envelope. An out-of-range page yields an empty `items` array with the
 * honest `totalCount` (never clamped, never an error). `page` and `pageSize`
 * are echoed back so callers can normalize client-side pagination state.
 */
export interface AdminBroadcastPageReturnType {
  readonly items: readonly AdminBroadcastEntryReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * `AdminBroadcastDetailReturnType` — the detail view payload: the header
 * entry plus the live delivery/read aggregates derived from the broadcast's
 * still-present notification rows. For a stopped broadcast both live counts
 * are 0 (the rows were retracted); the entry's `recipientCount` preserves
 * the original reach.
 */
export interface AdminBroadcastDetailReturnType {
  readonly entry: AdminBroadcastEntryReturnType;
  readonly liveDeliveredCount: number;
  readonly liveReadCount: number;
}

/**
 * `AdminBroadcastListFilters` — the closed, request-scoped filter surface of
 * the admin broadcast history listing. Every field is optional (absent/null
 * = no filter) and the filters compose AND-wise; the shape is readonly and
 * closed (no index signature) — callers map fields explicitly, never a
 * `{ ...input }` spread into the query.
 */
export interface AdminBroadcastListFilters {
  readonly titleSearch?: string | null;
  readonly status?: BroadcastStatus | null;
  readonly audienceType?: BroadcastAudienceType | null;
}
