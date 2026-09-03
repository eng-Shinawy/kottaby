import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";

/** Service input as copied field-by-field from the GraphQL resolver (closed whitelist). */
export interface AdminAuditTrailFiltersSubmitInput {
  readonly actorId?: number | null;
  readonly actionType?: AuditActionType | null;
  readonly entityType?: string | null;
  readonly entityId?: number | null;
  readonly from?: Date | null;
  readonly to?: Date | null;
}

/** One rendered row of the global trail. entityId/details are nullable by design. */
export interface AdminAuditLogEntryReturnType {
  readonly id: number;
  readonly actionType: AuditActionType;
  readonly actorId: number;
  readonly actorName: string; // CURRENT users.full_name (documented, not a snapshot)
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
  readonly createdAt: Date;
}

export interface AdminAuditLogPageReturnType {
  readonly items: readonly AdminAuditLogEntryReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}
