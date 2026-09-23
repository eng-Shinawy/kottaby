/**
 * SessionDisputeNotificationService — the dispute notification waves of the
 * consumed (post-confirmation) dispute generation: the admin cohort wave
 * when a dispute opens, and the two-participant wave when the arbitration
 * decision lands. The held (pre-completion) dispute generation stays
 * notification-silent — the shipped session-lifecycle ruling — and this
 * service is only ever invoked from the consumed-generation flows, so a
 * held row can structurally never reach an emission.
 *
 * Recipient derivation:
 *  - the opened wave resolves the admin cohort SERVER-SIDE through the
 *    broadcast-audience repository's role arm (every governance-clean
 *    `admin` user, id-ascending) — no recipient id is ever caller-supplied;
 *    the only caller inputs are the session id and the dispute opener's
 *    id, and the opener is validated as the wave's attribution
 *    precondition (the admin-facing copy itself stays plain and factual —
 *    the disputes console renders the case);
 *  - the resolved wave emits to exactly the session's two participants.
 *    Their ids arrive from the arbitration flow's OWN guarded write (the
 *    row's persisted participants read back from the same transaction),
 *    never from client input.
 *
 * Receipt producer contract: every wave persists its rows through the
 * notification engine INSIDE the caller's transaction (the engine's
 * caller-tx path) and returns the UNPUBLISHED delivery receipts verbatim.
 * This module NEVER publishes — no transport, no `publishReceipts` call.
 * The transaction-owning caller (the arbitration flow) publishes strictly
 * AFTER its own commit via `NotificationEngine.publishReceipts`
 * (publish-after-commit: nothing is ever pushed for a rolled-back emit;
 * push failures degrade at the engine boundary, never fail the committed
 * domain write).
 *
 * Claim keys: `session:<sessionId>:dispute-opened` and
 * `session:<sessionId>:dispute-resolved` — the session id and the wave
 * kind ONLY, deterministic across retries per the admin session-governance
 * wave convention. A replayed wave therefore claims the same engine claim
 * identity instead of minting a second one (the engine folds the recipient
 * cohort into the hashed claim and fails open when no claim cache is
 * injected, so dedupe stays a delivery nicety, never a domain gate).
 *
 * Per-recipient locale: the engine stores copy verbatim and never
 * translates, so recipients are grouped by their persisted `users.locale`
 * (first-seen cohort order preserved; a row without a persisted locale
 * rides the platform default) and each cohort's single title/body pair is
 * composed in that cohort's own locale. A shared-locale cohort emits as
 * ONE engine batch — one receipt, one post-commit publish dispatch when
 * the caller publishes.
 *
 * All user-facing strings resolve through the compile-time translation
 * system; no module-level mutable state; the waves are internal seam
 * primitives — the owning arbitration flow gates WHO may trigger them.
 */
import { BroadcastAudienceRepository, UserRepository } from "@/backend/db/repo";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { DomainError, ValidationError } from "@/backend/lib/errors";
import { NotificationEngine } from "@/backend/services/notifications";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import type { DBTransaction, NotificationDeliveryReceipt, NotificationEmitBatchInput } from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The errors-namespace slice, typed once for this module's denial messages. */
type DisputeWaveErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/** The notifications-namespace slice the wave copy composes from. */
type NotificationsTranslationsSlice = ReturnType<typeof getServerTranslations>["notificationsTranslations"];

/** Composes one locale cohort's title/body pair from the notifications copy. */
type DisputeWaveCopyComposer = (tNotifications: NotificationsTranslationsSlice) => {
  readonly title: string;
  readonly body: string | null;
};

/** The polymorphic related-entity pointer every dispute wave rides. */
const SESSION_ENTITY_TYPE = "session";

/** The opened wave's deterministic emit-claim key (session id + wave kind only). */
function openedWaveClaimKey(sessionId: number): string {
  return `session:${sessionId}:dispute-opened`;
}

/** The resolved wave's deterministic emit-claim key (session id + wave kind only). */
function resolvedWaveClaimKey(sessionId: number): string {
  return `session:${sessionId}:dispute-resolved`;
}

/** Fail-closed id-shape guard for a wave's target ids, BEFORE any read. */
function assertWaveTargetId(value: number, t: DisputeWaveErrorsTranslations): void {
  if (!isPositiveSafeInt(value)) {
    throw new ValidationError(t.validation);
  }
}

/** The opened wave's copy — plain and factual, no participant names or reason content. */
function composeOpenedWaveCopy(tNotifications: NotificationsTranslationsSlice) {
  return {
    title: tNotifications.eventSessionDisputeOpenedTitle,
    body: tNotifications.eventSessionDisputeOpenedBody,
  };
}

/** The resolved wave's title — shared by all three outcomes. */
function composeResolvedWaveCopy(
  resolution: DisputeResolution,
  locale: string,
  tNotifications: NotificationsTranslationsSlice
) {
  return {
    title: tNotifications.eventSessionDisputeResolvedTitle,
    body: resolvedWaveBody(resolution, locale, tNotifications),
  };
}

/**
 * The resolved wave's body — the arbitration outcome the wave carries. The
 * held-family outcomes never reach the consumed wave (the arbitration flow
 * rejects them pre-DB), so a resolution that skips that guard fails closed
 * instead of emitting copy that names no outcome.
 */
function resolvedWaveBody(
  resolution: DisputeResolution,
  locale: string,
  tNotifications: NotificationsTranslationsSlice
): string {
  if (resolution === DisputeResolution.Refund) {
    return tNotifications.eventSessionDisputeResolvedRefundBody;
  }
  if (resolution === DisputeResolution.PartialRefund) {
    return tNotifications.eventSessionDisputeResolvedPartialRefundBody;
  }
  if (resolution === DisputeResolution.Uphold) {
    return tNotifications.eventSessionDisputeResolvedUpholdBody;
  }
  throw new DomainError("INTERNAL_SERVER_ERROR", getServerTranslations(locale).errorsTranslations.internalServerError);
}

/** One locale cohort's fully-composed, engine-ready emit — no I/O left but the engine call. */
interface DisputeWaveEmitPlan {
  readonly input: NotificationEmitBatchInput;
  readonly recipientLocale: string;
}

/**
 * Builds the wave's emit plans: recipients are grouped by their persisted
 * locale (first-seen cohort order preserved; a row without a persisted
 * locale rides the platform default) and each cohort's copy is composed in
 * that cohort's own locale under the wave's single deterministic claim key.
 */
async function planDisputeWave(
  sessionId: number,
  recipientIds: readonly number[],
  notificationType: NotificationType,
  idempotencyKey: string,
  composeCopy: DisputeWaveCopyComposer,
  tx: DBTransaction
): Promise<DisputeWaveEmitPlan[]> {
  const locales = await UserRepository.findLocalesByIds(recipientIds, tx);
  const cohorts: { locale: string; userIds: number[] }[] = [];
  for (const userId of recipientIds) {
    const locale: string = locales.get(userId) ?? defaultLocale;
    const cohort = cohorts.find(candidate => candidate.locale === locale);
    if (cohort) {
      cohort.userIds.push(userId);
    } else {
      cohorts.push({ locale, userIds: [userId] });
    }
  }
  return cohorts.map(cohort => {
    const { title, body } = composeCopy(getServerTranslations(cohort.locale).notificationsTranslations);
    return {
      recipientLocale: cohort.locale,
      input: {
        userIds: cohort.userIds,
        type: notificationType,
        title,
        body,
        relatedEntityType: SESSION_ENTITY_TYPE,
        relatedEntityId: sessionId,
        idempotencyKey,
      },
    } satisfies DisputeWaveEmitPlan;
  });
}

/**
 * Head-first sequential receipt walk over the composed emit plans (the
 * shared wave-machinery shape: every engine call happens ACROSS an await,
 * never inside a loop body). Caller-tx emissions return the engine's
 * UNPUBLISHED receipt verbatim; a contract breach — a bare row where the
 * receipt shape belongs — fails closed as a typed internal error.
 */
async function emitDisputeWaveReceiptsFrom(
  plans: readonly DisputeWaveEmitPlan[],
  index: number,
  tx: DBTransaction
): Promise<NotificationDeliveryReceipt[]> {
  const plan = plans.at(index);
  if (plan === undefined) {
    return [];
  }
  const result = await NotificationEngine.emitForUsers(plan.input, plan.recipientLocale, tx);
  if (!("notifications" in result)) {
    throw new DomainError(
      "INTERNAL_SERVER_ERROR",
      getServerTranslations(plan.recipientLocale).errorsTranslations.internalServerError
    );
  }
  const rest = await emitDisputeWaveReceiptsFrom(plans, index + 1, tx);
  return [result, ...rest];
}

/**
 * Emits one dispute wave on the caller's transaction: an empty recipient
 * cohort is an honest empty receipt list (a cohort that resolves to nobody
 * is not an error), and a non-empty cohort persists one engine batch per
 * locale group and returns the unpublished receipts in cohort order.
 */
async function emitDisputeWave(
  sessionId: number,
  recipientIds: readonly number[],
  notificationType: NotificationType,
  idempotencyKey: string,
  composeCopy: DisputeWaveCopyComposer,
  tx: DBTransaction
): Promise<NotificationDeliveryReceipt[]> {
  if (recipientIds.length === 0) {
    return [];
  }
  const plans = await planDisputeWave(sessionId, recipientIds, notificationType, idempotencyKey, composeCopy, tx);
  return emitDisputeWaveReceiptsFrom(plans, 0, tx);
}

export namespace SessionDisputeNotificationService {
  /**
   * The dispute-opened wave: one `session_dispute_opened` notification for
   * EVERY governance-clean admin, persisted inside the caller's
   * transaction. The admin cohort is resolved server-side through the
   * broadcast-audience repository's role arm — the caller supplies only the
   * session and the dispute opener, never a recipient list. The opener id
   * is the wave's attribution precondition (a wave is only ever emitted
   * for an attributed opener) and is fail-closed validated before any
   * read; the admin-facing copy stays plain and factual. A cohort that
   * resolves to nobody returns an empty receipt list — the wave is
   * audience-scoped, never a crash.
   *
   * @param sessionId  The disputed session the wave points at.
   * @param openerUserId  The student who opened the dispute (the
   *     arbitration flow's own validated caller id).
   * @param locale  Active request locale (localizes THIS module's own
   *     denial messages; recipient copy is composed per recipient).
   * @param tx  REQUIRED caller transaction — the receipts share the
   *     dispute's fate; publish-after-commit is the transaction owner's.
   * @returns The unpublished delivery receipts, one per locale cohort, in
   *     first-seen cohort order.
   */
  export async function notifyAdminsOfDisputeOpened(
    sessionId: number,
    openerUserId: number,
    locale: string,
    tx: DBTransaction
  ): Promise<readonly NotificationDeliveryReceipt[]> {
    const t = getServerTranslations(locale).errorsTranslations;
    assertWaveTargetId(sessionId, t);
    assertWaveTargetId(openerUserId, t);

    const adminIds = await BroadcastAudienceRepository.resolveAudienceIds(
      { type: BroadcastAudienceType.Role, role: UserRole.Admin },
      tx
    );
    return emitDisputeWave(
      sessionId,
      adminIds,
      NotificationType.SessionDisputeOpened,
      openedWaveClaimKey(sessionId),
      composeOpenedWaveCopy,
      tx
    );
  }

  /**
   * The dispute-resolved wave: one `session_dispute_resolved` notification
   * for each of the session's two participants, carrying the arbitration
   * outcome in the stored copy, persisted inside the caller's transaction.
   * The participant ids arrive from the arbitration flow's own guarded
   * write (the row's persisted participants), never from client input, and
   * are fail-closed validated before any read. A corrupted row that names
   * the same user twice fails closed at the engine's batch contract —
   * never a silent half-wave.
   *
   * @param sessionId  The arbitrated session the wave points at.
   * @param studentId  The session's student (from the arbitration write's
   *     own probe).
   * @param teacherId  The session's teacher (same probe).
   * @param resolution  The committed arbitration outcome (Refund |
   *     PartialRefund | Uphold) carried in the stored copy.
   * @param locale  Active request locale (localizes THIS module's own
   *     denial messages; recipient copy is composed per recipient).
   * @param tx  REQUIRED caller transaction — the receipts share the
   *     arbitration's fate; publish-after-commit is the transaction owner's.
   * @returns The unpublished delivery receipts, one per locale cohort, in
   *     first-seen cohort order (the student before the teacher when the
   *     two speak different locales).
   */
  export async function notifyParticipantsOfDisputeResolved(
    sessionId: number,
    studentId: number,
    teacherId: number,
    resolution: DisputeResolution,
    locale: string,
    tx: DBTransaction
  ): Promise<readonly NotificationDeliveryReceipt[]> {
    const t = getServerTranslations(locale).errorsTranslations;
    assertWaveTargetId(sessionId, t);
    assertWaveTargetId(studentId, t);
    assertWaveTargetId(teacherId, t);

    return emitDisputeWave(
      sessionId,
      [studentId, teacherId],
      NotificationType.SessionDisputeResolved,
      resolvedWaveClaimKey(sessionId),
      tNotifications => composeResolvedWaveCopy(resolution, locale, tNotifications),
      tx
    );
  }
}
