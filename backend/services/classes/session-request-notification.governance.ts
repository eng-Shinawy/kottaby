/**
 * Session-request notification wave emitters — the governance-wave
 * machinery (module extraction, behavior-identical): the engine
 * notification-type mapping, the recipient-locale copy composition, the
 * outgoing-teacher participant resolution, the per-recipient emit planning,
 * the head-first sequential receipt walk, and the wave-level delivery
 * entry point (`emitGovernanceWave`) for the three admin session-governance
 * waves (reschedule / cancel / teacher reassignment).
 *
 * Receipt producer contract: the receipts are UNPUBLISHED on the
 * caller-transaction path — the calling flow publishes strictly after its
 * own commit via `NotificationEngine.publishReceipts` (publish-after-commit
 * — nothing is ever pushed for a rolled-back emit). On the
 * transaction-less path the engine commits the row and publishes exactly
 * once internally; this module wraps the freshly inserted rows into the
 * receipt shape.
 *
 * Emit-claim key format (the raw key feeds the engine's hashed claim
 * identity, which additionally folds the recipient cohort): the one-shot
 * cancel wave claims `session:<sessionId>:<waveKind>`; the two RECURRING
 * kinds — rescheduled and teacherReassigned — fold the emit-time row
 * occurrence, `session:<sessionId>:<waveKind>:<updatedAt ISO>`, where the
 * stamp is the guarded mutation's own write (read back on the caller's
 * transaction at wave time). A second reschedule / re-reassignment of the
 * same session therefore claims a FRESH key inside the claim TTL instead
 * of deduping against the prior occurrence's still-live claim.
 *
 * Localization: the engine stores copy verbatim and NEVER translates, so
 * the per-recipient locale composition is THIS module's obligation: title
 * and body are composed in the RECIPIENT's persisted locale (falling back
 * to the platform default locale when the user row carries none), and that
 * same locale is handed to the engine.
 *
 * The public surface stays the `SessionRequestNotificationService`
 * namespace in `session-request-notification.service.ts` (the emitters own
 * the wave-context resolution and the caller-facing signatures). Nothing
 * in this module is part of the public API.
 */

import { UserRepository } from "@/backend/db/repo";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DomainError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { NotificationEngine, type NotificationEngineCallOptions } from "@/backend/services/notifications";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationEmitInput,
  SessionGovernanceWaveKind,
  SessionWaveContext,
  SessionWaveParticipantContext,
} from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Maps a governance wave kind onto the engine's closed notification-type
 * vocabulary: the cancel wave rides the dedicated cancellation type (its
 * feed label matches the event), while the reschedule and reassignment
 * waves ride the session-request envelope — the same session-domain wave
 * carrier every participant flow uses.
 */
function toGovernanceNotificationType(waveKind: SessionGovernanceWaveKind): NotificationType {
  return waveKind === "sessionGovernance.cancelled"
    ? NotificationType.SessionCancellation
    : NotificationType.SessionRequest;
}

/**
 * Composes a governance wave's title/body from the notifications namespace.
 * The copy is plain and factual — no participant names, no timing values,
 * no refund promises; the inbox links back to the session where the current
 * state is rendered. Exhaustive over the governance wave-kind union.
 */
function composeGovernanceWaveCopy(
  waveKind: SessionGovernanceWaveKind,
  tNotifications: ReturnType<typeof getServerTranslations>["notificationsTranslations"]
): { readonly title: string; readonly body: string } {
  switch (waveKind) {
    case "sessionGovernance.rescheduled":
      return {
        title: tNotifications.eventSessionGovernanceRescheduledTitle,
        body: tNotifications.eventSessionGovernanceRescheduledBody,
      };
    case "sessionGovernance.cancelled":
      return {
        title: tNotifications.eventSessionGovernanceCancelledTitle,
        body: tNotifications.eventSessionGovernanceCancelledBody,
      };
    case "sessionGovernance.teacherReassigned":
      return {
        title: tNotifications.eventSessionGovernanceTeacherReassignedTitle,
        body: tNotifications.eventSessionGovernanceTeacherReassignedBody,
      };
    default: {
      // Exhaustiveness guard — the wave-kind union makes this unreachable.
      const exhaustive: never = waveKind;
      throw new Error(`Unexpected governance wave kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Resolves one governance-wave participant that is NOT derivable from the
 * session row's CURRENT state (the outgoing teacher after a reassignment
 * swap): reads the user row for the persisted locale. A vanished row is a
 * broken-contract situation mid-mutation and fails closed — the wave is
 * all-or-nothing with the mutation that caused it.
 */
export async function resolveGovernanceParticipant(
  userId: number,
  locale: string,
  tx: DBTransaction | undefined
): Promise<SessionWaveParticipantContext> {
  const row = await UserRepository.findById(userId, tx);
  if (row === null) {
    logger.logDomainError("Session governance wave denied: recipient user row vanished", {
      code: "INTERNAL_SERVER_ERROR",
      entity: "session",
      entityId: userId,
      locale,
    });
    throw new DomainError(
      "INTERNAL_SERVER_ERROR",
      getServerTranslations(locale).errorsTranslations.internalServerError
    );
  }
  return { userId: row.id, fullName: row.fullName, locale: row.locale };
}

/** One recipient's fully-composed, locale-resolved emit — no I/O left but the engine call. */
interface GovernanceEmitPlan {
  readonly input: NotificationEmitInput;
  readonly recipientLocale: string;
  readonly recipientUserId: number;
}

/**
 * Builds one governance wave's emit-claim key (format contract in the
 * module docblock). The one-shot cancel wave claims the bare wave key; the
 * two RECURRING kinds fold the emit-time row occurrence (the session
 * row's `updatedAt` ISO — stamped by the guarded mutation that caused the
 * wave) so each mutation claims separately. A recurring wave on a row
 * with no audit stamp is a broken-contract situation mid-mutation and
 * fails closed — the wave is all-or-nothing with the mutation that caused
 * it.
 */
function governanceWaveClaimKey(wave: SessionWaveContext, waveKind: SessionGovernanceWaveKind): string {
  if (waveKind === "sessionGovernance.cancelled") {
    return `session:${wave.sessionId}:${waveKind}`;
  }
  const occurrence = wave.sessionUpdatedAt;
  if (occurrence === null) {
    logger.logDomainError("Session governance wave denied: session row carries no occurrence stamp", {
      code: "INTERNAL_SERVER_ERROR",
      entity: "session",
      entityId: wave.sessionId,
    });
    throw new DomainError(
      "INTERNAL_SERVER_ERROR",
      getServerTranslations(defaultLocale).errorsTranslations.internalServerError
    );
  }
  return `session:${wave.sessionId}:${waveKind}:${occurrence.toISOString()}`;
}

/**
 * Composes every recipient's emit plan synchronously (copy in the
 * RECIPIENT's persisted locale; the engine's claim recipe folds the
 * recipient cohort into the hashed claim identity, so one wave-level key
 * stays per-recipient deterministic).
 */
function planGovernanceWave(
  wave: SessionWaveContext,
  waveKind: SessionGovernanceWaveKind,
  recipients: readonly SessionWaveParticipantContext[]
): GovernanceEmitPlan[] {
  const type = toGovernanceNotificationType(waveKind);
  const idempotencyKey = governanceWaveClaimKey(wave, waveKind);
  return recipients.map(recipient => {
    const recipientLocale = recipient.locale ?? defaultLocale;
    const { title, body } = composeGovernanceWaveCopy(
      waveKind,
      getServerTranslations(recipientLocale).notificationsTranslations
    );
    return {
      input: {
        userId: recipient.userId,
        type,
        title,
        body,
        relatedEntityType: "session",
        relatedEntityId: wave.sessionId,
        idempotencyKey,
      },
      recipientLocale,
      recipientUserId: recipient.userId,
    } satisfies GovernanceEmitPlan;
  });
}

/**
 * Head-first sequential receipt walk over the composed emit plans (the
 * recursive-helper shape of the shared refund walk: every engine call
 * happens ACROSS an await, never inside a loop body). Head-first means the
 * CURRENT recipient's engine call resolves BEFORE the recursive rest walk
 * begins — plans[0] emits first, plans[last] last — while the returned
 * array still lists the receipts in recipient order (`[current, ...rest]`).
 * Caller-tx emissions return the engine's unpublished receipt verbatim;
 * transaction-less emissions normalize the engine's single-row return into
 * receipt shape.
 */
async function emitGovernanceReceiptsFrom(
  plans: readonly GovernanceEmitPlan[],
  index: number,
  tx: DBTransaction | undefined,
  options: NotificationEngineCallOptions | undefined
): Promise<NotificationDeliveryReceipt[]> {
  if (index >= plans.length) {
    return [];
  }
  const plan = plans[index];
  if (tx !== undefined) {
    // Emit the CURRENT plan first, then walk the rest (head-first).
    const result = await NotificationEngine.emitForUser(plan.input, plan.recipientLocale, tx, options);
    if (!("notifications" in result)) {
      throw new DomainError(
        "INTERNAL_SERVER_ERROR",
        getServerTranslations(plan.recipientLocale).errorsTranslations.internalServerError
      );
    }
    const rest = await emitGovernanceReceiptsFrom(plans, index + 1, tx, options);
    return [result, ...rest];
  }
  const result = await NotificationEngine.emitForUser(plan.input, plan.recipientLocale, undefined, options);
  const rest = await emitGovernanceReceiptsFrom(plans, index + 1, tx, options);
  if ("notifications" in result) {
    return [result, ...rest];
  }
  return [{ notifications: [result], recipientUserIds: [plan.recipientUserId] }, ...rest];
}

/**
 * Delivers one governance wave to EVERY recipient and returns the delivery
 * receipts in recipient order. See the module docblock: the receipts are
 * UNPUBLISHED on the caller-transaction path — the calling flow publishes
 * strictly after its own commit via `NotificationEngine.publishReceipts`.
 */
export async function emitGovernanceWave(
  wave: SessionWaveContext,
  waveKind: SessionGovernanceWaveKind,
  recipients: readonly SessionWaveParticipantContext[],
  tx: DBTransaction | undefined,
  options: NotificationEngineCallOptions | undefined
): Promise<NotificationDeliveryReceipt[]> {
  return emitGovernanceReceiptsFrom(planGovernanceWave(wave, waveKind, recipients), 0, tx, options);
}
