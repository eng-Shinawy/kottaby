import { db } from "@/backend/db";
import type { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import {
  attemptEmitClaim,
  buildEmitClaimKey,
  warnEmitIdempotencyUnavailable,
} from "@/backend/services/notifications/emit-idempotency";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications/notification-engine.service";
import type { DBTransaction, NotificationDeliveryReceipt } from "@/backend/types";

/**
 * Runs `fn` inside a transaction. When `outerTx` is provided (caller-owned
 * unit) the work runs in a SAVEPOINT on the outer transaction — failures roll
 * back only the savepoint and the outer transaction stays usable; when
 * `outerTx` is undefined the engine opens its own top-level `db.transaction`,
 * whose resolution IS the commit.
 */
export async function withTransaction<T>(
  outerTx: DBTransaction | undefined,
  fn: (tx: DBTransaction) => Promise<T>
): Promise<T> {
  if (outerTx) {
    return outerTx.transaction(fn);
  }
  return db.transaction(fn);
}

/**
 * Pre-insert idempotency claim for one emission. Returns the PRIOR receipt
 * when a duplicate claim is replayable (the caller must return it WITHOUT
 * inserting or publishing) plus the claim key under which the completed
 * receipt must be stored post-commit.
 */
export async function claimOrPriorReceipt(
  idempotencyKey: string | undefined,
  userIds: readonly number[],
  type: NotificationType,
  options: NotificationEngineCallOptions | undefined
): Promise<{ priorReceipt: NotificationDeliveryReceipt | undefined; claimKey: string | undefined }> {
  if (idempotencyKey === undefined) {
    return { priorReceipt: undefined, claimKey: undefined };
  }
  const cache = options?.cache;
  if (cache === undefined) {
    warnEmitIdempotencyUnavailable();
    return { priorReceipt: undefined, claimKey: undefined };
  }
  const claimKey = buildEmitClaimKey(userIds, type, idempotencyKey);
  const outcome = await attemptEmitClaim(cache, claimKey);
  if (outcome.status === "duplicate") {
    return { priorReceipt: outcome.receipt, claimKey: undefined };
  }
  return { priorReceipt: undefined, claimKey };
}
