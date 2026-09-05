import type { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
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
