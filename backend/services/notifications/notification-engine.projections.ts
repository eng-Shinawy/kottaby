import type {
  NotificationEmitInput,
  NotificationInsertType,
  NotificationReturnType,
  RealtimeNotificationPayload,
} from "@/backend/types";

/** Copy fields shared by the single-recipient and batch emit contracts. */
export type NotificationEmitCopy = Pick<
  NotificationEmitInput,
  "type" | "title" | "body" | "relatedEntityType" | "relatedEntityId"
>;

/**
 * Field-by-field mapping into `NotificationInsertType` (BOPLA — no object
 * spreads; only whitelisted columns are ever written).
 */
export function toNotificationInsert(userId: number, copy: NotificationEmitCopy, now: Date): NotificationInsertType {
  return {
    userId,
    type: copy.type,
    title: copy.title,
    body: copy.body,
    isRead: false,
    relatedEntityType: copy.relatedEntityType,
    relatedEntityId: copy.relatedEntityId,
    createdAt: now,
  };
}

/**
 * Allowlisted realtime payload projection of one persisted row (BOPLA —
 * field-by-field).
 */
export function toRealtimePayload(row: NotificationReturnType): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      createdAt: row.createdAt,
    },
  };
}
