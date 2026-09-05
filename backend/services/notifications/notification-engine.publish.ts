import { logger } from "@/backend/lib/logger";
import {
  storeEmitReceiptQuietly,
  warnEmitIdempotencyUnavailable,
} from "@/backend/services/notifications/emit-idempotency";
import { toRealtimePayload } from "@/backend/services/notifications/notification-engine.projections";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications/notification-engine.service";
import type { NotificationFanoutTransport } from "@/backend/services/notifications/realtime/fanout-transport";
import { resolveFanoutTransport } from "@/backend/services/notifications/realtime/fanout-transport.factory";
import type { NotificationDeliveryReceipt, RealtimeNotificationPayload } from "@/backend/types";

let defaultFanoutTransportPromise: Promise<NotificationFanoutTransport> | undefined;

function resolveDefaultFanoutTransport(): Promise<NotificationFanoutTransport> {
  defaultFanoutTransportPromise ??= resolveFanoutTransport();
  return defaultFanoutTransportPromise;
}

/**
 * Publishes one realtime fan-out, degrading on ANY failure to a single
 * structured `NOTIFICATION_DELIVERY_DEGRADED` log and a resolve.
 */
export async function publishAfterCommit(
  userIds: readonly number[],
  payload: RealtimeNotificationPayload,
  locale: string,
  options: NotificationEngineCallOptions | undefined
): Promise<void> {
  try {
    const transport = options?.transport ?? (await resolveDefaultFanoutTransport());
    await transport.publishFanout(userIds, payload);
  } catch (error) {
    logger.logDomainError("Notification realtime delivery degraded; the persisted inbox remains authoritative", {
      code: "NOTIFICATION_DELIVERY_DEGRADED",
      entity: "notifications",
      locale,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

/** Sequential in-order publish+store sweep. */
export async function publishReceiptsFromIndex(
  receipts: readonly NotificationDeliveryReceipt[],
  index: number,
  locale: string,
  options: NotificationEngineCallOptions | undefined
): Promise<void> {
  if (index >= receipts.length) {
    return;
  }
  const receipt = receipts[index];
  const cache = options?.cache;
  if (receipt.emitClaimKey !== undefined) {
    if (cache === undefined) {
      warnEmitIdempotencyUnavailable();
    } else {
      await storeEmitReceiptQuietly(cache, receipt.emitClaimKey, receipt);
    }
  }
  const representativeRow = receipt.notifications.at(0);
  if (representativeRow !== undefined) {
    await publishAfterCommit(receipt.recipientUserIds, toRealtimePayload(representativeRow), locale, options);
  }
  await publishReceiptsFromIndex(receipts, index + 1, locale, options);
}
