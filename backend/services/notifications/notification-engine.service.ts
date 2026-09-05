import { NotificationRepository } from "@/backend/db/repo";
import type { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";
import {
  isPositiveSafeInt,
  validateEmitBatchInput,
  validateEmitInput,
} from "@/backend/services/notifications/emit-validation";
import { claimOrPriorReceipt, withTransaction } from "@/backend/services/notifications/notification-engine.helpers";
import {
  NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT,
  NOTIFICATION_INBOX_MAX_PAGE_LIMIT,
  resolveInboxListRequest,
  validateInboxUserId,
  validateOptionalNotificationType,
} from "@/backend/services/notifications/notification-engine.inbox";
import { toNotificationInsert } from "@/backend/services/notifications/notification-engine.projections";
import { publishReceiptsFromIndex } from "@/backend/services/notifications/notification-engine.publish";
import type { NotificationFanoutTransport } from "@/backend/services/notifications/realtime/fanout-transport";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationEmitBatchInput,
  NotificationEmitInput,
  NotificationListFilterInput,
  NotificationListPageReturnType,
  NotificationReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

export { NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT, NOTIFICATION_INBOX_MAX_PAGE_LIMIT };

export interface NotificationEngineCallOptions {
  readonly transport?: NotificationFanoutTransport;
  readonly cache?: NotificationIdempotencyClaimCache;
}

const NOTIFICATION_ENTITY = "NOTIFICATION";

export namespace NotificationEngine {
  export async function emitForUser(
    input: NotificationEmitInput,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationReturnType | NotificationDeliveryReceipt> {
    const t = getServerTranslations(locale).errorsTranslations;
    validateEmitInput(input, t.validation);

    const { priorReceipt, claimKey } = await claimOrPriorReceipt(
      input.idempotencyKey,
      [input.userId],
      input.type,
      options
    );
    if (priorReceipt !== undefined) {
      return priorReceipt;
    }

    const now = new Date();
    const insert = toNotificationInsert(input.userId, input, now);

    if (tx !== undefined) {
      const row = await withTransaction(tx, txArg => NotificationRepository.createReturning(insert, txArg));
      return { notifications: [row], recipientUserIds: [input.userId], emitClaimKey: claimKey };
    }

    const row = await withTransaction(undefined, txArg => NotificationRepository.createReturning(insert, txArg));
    const receipt: NotificationDeliveryReceipt = {
      notifications: [row],
      recipientUserIds: [input.userId],
      emitClaimKey: claimKey,
    };
    await publishReceiptsFromIndex([receipt], 0, locale, options);
    return row;
  }

  export async function emitForUsers(
    input: NotificationEmitBatchInput,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationDeliveryReceipt> {
    const t = getServerTranslations(locale).errorsTranslations;
    validateEmitBatchInput(input, t.validation);

    const { priorReceipt, claimKey } = await claimOrPriorReceipt(
      input.idempotencyKey,
      input.userIds,
      input.type,
      options
    );
    if (priorReceipt !== undefined) {
      return priorReceipt;
    }

    const now = new Date();
    const inserts = input.userIds.map(userId => toNotificationInsert(userId, input, now));

    if (tx !== undefined) {
      const rows = await withTransaction(tx, txArg => NotificationRepository.createManyReturning(inserts, txArg));
      return { notifications: rows, recipientUserIds: [...input.userIds], emitClaimKey: claimKey };
    }

    const rows = await withTransaction(undefined, txArg => NotificationRepository.createManyReturning(inserts, txArg));
    const receipt: NotificationDeliveryReceipt = {
      notifications: rows,
      recipientUserIds: [...input.userIds],
      emitClaimKey: claimKey,
    };
    await publishReceiptsFromIndex([receipt], 0, locale, options);
    return receipt;
  }

  export async function publishReceipts(
    receipts: readonly NotificationDeliveryReceipt[],
    locale: string,
    options?: NotificationEngineCallOptions
  ): Promise<void> {
    await publishReceiptsFromIndex(receipts, 0, locale, options);
  }

  export async function listMyNotifications(
    userId: number,
    filter: NotificationListFilterInput,
    locale: string,
    tx?: DBTransaction
  ): Promise<NotificationListPageReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    validateInboxUserId(userId, t.validation);
    const { limit, offset } = resolveInboxListRequest(filter, t.validation);

    const items = await NotificationRepository.listForUser(userId, filter, limit, offset, tx);
    const totalCount = await NotificationRepository.countForUser(userId, filter, tx);
    return { items, totalCount, hasMore: offset + items.length < totalCount };
  }

  export async function getMyUnreadCount(userId: number, locale: string, tx?: DBTransaction): Promise<number> {
    const t = getServerTranslations(locale).errorsTranslations;
    validateInboxUserId(userId, t.validation);
    return NotificationRepository.countUnread(userId, tx);
  }

  export async function markRead(
    callerUserId: number,
    notificationId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<NotificationReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    validateInboxUserId(callerUserId, t.validation);
    if (!isPositiveSafeInt(notificationId)) {
      throw new ValidationError(t.validation);
    }

    const row = await NotificationRepository.markReadOnce(notificationId, callerUserId, tx);
    if (row === null) {
      logger.logDomainError("Notification mark-read denied: no row matches the caller's id pair", {
        code: "NOTIFICATION_NOT_FOUND",
        entity: "notifications",
        entityId: notificationId,
        locale,
      });
      throw new NotFoundError(NOTIFICATION_ENTITY, t.notificationNotFound);
    }
    return row;
  }

  export async function markAllRead(
    callerUserId: number,
    type: NotificationType | null,
    locale: string,
    tx?: DBTransaction
  ): Promise<number> {
    const t = getServerTranslations(locale).errorsTranslations;
    validateInboxUserId(callerUserId, t.validation);
    validateOptionalNotificationType(type, t.validation);
    return NotificationRepository.markAllReadForUser(callerUserId, type, tx);
  }
}
