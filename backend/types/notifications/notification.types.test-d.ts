/**
 * Type-Level Conformance Suite — notification canonical types.
 * Validated by `bun tsgo` (the compiler is the test runner).
 * `.test-d.ts` suffix = outside bun test runner glob.
 *
 * POSITIVES use `satisfies` — must compile.
 * NEGATIVES use `@ts-expect-error` directly before the offending line.
 */
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import type {
  NotificationDeliveryReceipt,
  NotificationEmitBatchInput,
  NotificationEmitInput,
  NotificationListFilterInput,
  NotificationListPageReturnType,
  NotificationReturnType,
  NotificationSelectType,
  RealtimeNotificationPayload,
} from "@/backend/types/notifications/notification.types";

// Helper to consume variables for TS6133
const v = (x: unknown): boolean => Boolean(x);

// A fully-populated persisted row (feeds the alias + receipt + page positives).
const row: NotificationSelectType = {
  id: 1,
  userId: 2,
  type: "session_request",
  title: "Session requested",
  body: "Your session was requested.",
  isRead: false,
  relatedEntityType: "session",
  relatedEntityId: 42,
  createdAt: new Date(),
};
v(row);

// A valid realtime data projection (reused by the envelope negatives below).
const dataProjection: RealtimeNotificationPayload["data"] = {
  id: 1,
  type: "session_request",
  title: "T",
  body: null,
  relatedEntityType: null,
  relatedEntityId: null,
  createdAt: new Date(),
};
v(dataProjection);

// ========== POSITIVES (must compile) ==========

// Alias anchor — NotificationReturnType ≡ NotificationSelectType (bidirectional)
const selectAsReturn: NotificationReturnType = row;
const returnAsSelect: NotificationSelectType = selectAsReturn;
v(selectAsReturn);
v(returnAsSelect);

// Emit input — minimal (fire-and-forget, no entity ref)
v({
  userId: 1,
  type: NotificationType.SessionRequest,
  title: "Session requested",
  body: null,
  relatedEntityType: null,
  relatedEntityId: null,
} satisfies NotificationEmitInput);

// Emit input — with entity ref + idempotency key
v({
  userId: 7,
  type: NotificationType.PaymentConfirmation,
  title: "Payment confirmed",
  body: "Your payment was received.",
  relatedEntityType: "session",
  relatedEntityId: 42,
  idempotencyKey: "emit-payment-1",
} satisfies NotificationEmitInput);

// Batch emit input — shared payload, multiple recipients
v({
  userIds: [1, 2, 3],
  type: NotificationType.SystemBroadcast,
  title: "Scheduled maintenance",
  body: "The platform will be briefly unavailable.",
  relatedEntityType: null,
  relatedEntityId: null,
  idempotencyKey: "emit-broadcast-1",
} satisfies NotificationEmitBatchInput);

// Delivery receipt — inserted rows + recipient ids
const receipt: NotificationDeliveryReceipt = {
  notifications: [row],
  recipientUserIds: [2],
};
v(receipt);

// List filter — fully filtered window
v({
  type: NotificationType.SessionRequest,
  isRead: false,
  limit: 20,
  offset: 0,
} satisfies NotificationListFilterInput);

// List filter — unfiltered window
v({ limit: 50, offset: 100 } satisfies NotificationListFilterInput);

// List page — empty window
v({ items: [], totalCount: 0, hasMore: false } satisfies NotificationListPageReturnType);

// List page — populated window with more pages beyond
v({ items: [row], totalCount: 61, hasMore: true } satisfies NotificationListPageReturnType);

// Realtime payload — allowlisted projection of a persisted row
v({
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
} satisfies RealtimeNotificationPayload);

// Realtime data allowlist — exactly the seven safe fields
const dataKeys: Array<keyof RealtimeNotificationPayload["data"]> = [
  "id",
  "type",
  "title",
  "body",
  "relatedEntityType",
  "relatedEntityId",
  "createdAt",
];
v(dataKeys);

// ========== NEGATIVES (@ts-expect-error immediately before the error) ==========

// Emit input — recipient id must be a number, never a client string
v({
  // @ts-expect-error — recipient id is a number
  userId: "user-1",
  type: NotificationType.SessionRequest,
  title: "T",
  body: null,
  relatedEntityType: null,
  relatedEntityId: null,
} satisfies NotificationEmitInput);

// Emit input — type must be an enum member, not a bare string
v({
  userId: 1,
  // @ts-expect-error — type must be a NotificationType enum member
  type: "session_request",
  title: "T",
  body: null,
  relatedEntityType: null,
  relatedEntityId: null,
} satisfies NotificationEmitInput);

// Emit input — isRead is system-managed (never caller-writable)
v({
  userId: 1,
  type: NotificationType.SessionRequest,
  title: "T",
  body: null,
  relatedEntityType: null,
  relatedEntityId: null,
  // @ts-expect-error — isRead is system-managed
  isRead: false,
} satisfies NotificationEmitInput);

// Batch emit input — userIds must be an array of numbers
v({
  // @ts-expect-error — userIds must be an array of numbers
  userIds: "1,2,3",
  type: NotificationType.SystemBroadcast,
  title: "T",
  body: null,
  relatedEntityType: null,
  relatedEntityId: null,
} satisfies NotificationEmitBatchInput);

// Receipt readonly arrays — mutation rejected at compile time
// @ts-expect-error — receipt.notifications is a readonly array (push rejected)
receipt.notifications.push(row);
// @ts-expect-error — receipt.recipientUserIds is a readonly array (push rejected)
receipt.recipientUserIds.push(3);

// Batch userIds — readonly array, mutation rejected at compile time
const batch: NotificationEmitBatchInput = {
  userIds: [1, 2],
  type: NotificationType.SystemBroadcast,
  title: "T",
  body: null,
  relatedEntityType: null,
  relatedEntityId: null,
};
v(batch);
// @ts-expect-error — batch.userIds is a readonly array (push rejected)
batch.userIds.push(3);

// List filter — limit and offset are both required
// @ts-expect-error — limit is required
const noLimit: NotificationListFilterInput = { offset: 0 };
v(noLimit);
// @ts-expect-error — offset is required
const noOffset: NotificationListFilterInput = { limit: 20 };
v(noOffset);

// List page — hasMore is required
// @ts-expect-error — hasMore is required
const noHasMore: NotificationListPageReturnType = { items: [], totalCount: 0 };
v(noHasMore);

// Realtime envelope — version is pinned to 1
const badVersion: RealtimeNotificationPayload = {
  // @ts-expect-error — envelope version is pinned to 1
  v: 2,
  kind: "notification",
  data: dataProjection,
};
v(badVersion);

// Realtime envelope — kind is the closed literal "notification"
const badKind: RealtimeNotificationPayload = {
  v: 1,
  // @ts-expect-error — kind is the literal "notification"
  kind: "heartbeat",
  data: dataProjection,
};
v(badKind);

// Realtime data allowlist — no account identifier key exists on the projection
// @ts-expect-error — recipient userId is excluded from the realtime projection
const leakKey: keyof RealtimeNotificationPayload["data"] = "userId";
v(leakKey);

// Realtime data — recipient userId must not ride the wire
const leaky: RealtimeNotificationPayload = {
  v: 1,
  kind: "notification",
  data: {
    ...dataProjection,
    // @ts-expect-error — recipient userId is excluded from the realtime projection
    userId: 2,
  },
};
v(leaky);
