/**
 * Admin Audit Write & Actor Context contract (Dev 3 → all).
 *
 * **BFLA gate:** This file is the dedicated admin-family home.
 * The barrel re-exports flat with NO convenience mixed-subset barrels
 * for student-facing flows.
 *
 * Audit rows MUST NEVER be updated — append-only semantics; governance
 * fields are excluded from the write shape.
 *
 * ActorContextRef carries ONLY userId + role.
 * Email, phone, credentials, tokens are PROHIBITED.
 */
import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { UserRole } from "@/backend/enum/users/user-role.enum";
import type { AuditLogSelectType } from "@/backend/types/audit/audit-log.types";

/**
 * Append-only. `id` and `createdAt` are system-set and PROHIBITED from input.
 * `actorId` is always `ctx.user.id`-derived — never an input.
 */
export interface AuditLogWriteContract {
  /** Always derived from `ctx.user.id` under admin authScope. */
  readonly actorId: AuditLogSelectType["actorId"];
  readonly actionType: AuditActionType;
  readonly entityType: string;
  /**
   * Affected row's id — `null` when the audited action has no single
   * backing entity (e.g. a cohort broadcast). Rides the schema-derived
   * column type (`audit_logs.entity_id`, already nullable) so the write
   * shape can never re-diverge from the physical column.
   */
  readonly entityId: AuditLogSelectType["entityId"];
  /** JSON-safe string, ≤2000 chars per schema constraint. */
  readonly details: string;
}

/**
 * Actor hand-off context.
 * PROHIBITED: email, phone, credentials, tokens, governance flags.
 */
export interface ActorContextRef {
  readonly userId: number;
  readonly role: UserRole;
}
