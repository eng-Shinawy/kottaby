/**
 * Session-request notification wave emitters — the internal engine-facing
 * library for the six session-request lifecycle waves (one teacher-facing
 * request wave, five student-facing outcome waves).
 *
 * Recipient derivation: the ONLY caller input is the session id. Both
 * participants resolve server-side from the persisted session row inside the
 * caller's transaction through the repository's joined read, so no caller can
 * smuggle or redirect a recipient identity. Every persisted row is written
 * exclusively through the notification engine (single-writer rule).
 *
 * Receipt producer contract: every emitter returns the engine's delivery
 * receipt VERBATIM and NEVER publishes. A caller that hands in its own
 * transaction owns the commit; it publishes afterwards via
 * `NotificationEngine.publishReceipts` strictly AFTER its own transaction has
 * committed (publish-after-commit — nothing is ever pushed for a rolled-back
 * emit). On the transaction-less path the engine commits the row, stores the
 * claim receipt, and publishes exactly once internally; this module then wraps
 * the freshly inserted row into the receipt shape.
 *
 * Authorization: these emitters are internal primitives — they perform NO
 * role/permission gating of their own. The owning session-intake /
 * accept-decline flow gates who may trigger a wave before calling in.
 *
 * Localization: the engine stores copy verbatim and NEVER translates, so the
 * per-recipient locale composition is THIS module's obligation: title and body
 * are composed in the RECIPIENT's persisted locale (falling back to the
 * platform default locale when the user row carries none), and that same
 * locale is handed to the engine.
 */
import { SessionRepository } from "@/backend/db/repo";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { NotificationEngine, type NotificationEngineCallOptions } from "@/backend/services/notifications";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import {
  type DBTransaction,
  isSessionIntent,
  type NotificationDeliveryReceipt,
  type NotificationEmitInput,
  type SessionRequestWaveKind,
  type SessionWaveContext,
  type SessionWaveParticipantContext,
} from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Fail-closed participant resolution: validates the session id BEFORE any
 * database read, loads the joined wave context, and maps the stored intent
 * through the canonical guard. A missing row rejects with `SESSION_NOT_FOUND`;
 * a non-member (or null) stored intent fails closed with
 * `SESSION_INTENT_CORRUPT` — each with exactly one bounded domain log.
 */
async function resolveWaveContext(
  sessionId: number,
  locale: string,
  tx: DBTransaction | undefined
): Promise<SessionWaveContext> {
  const tErrors = getServerTranslations(locale).errorsTranslations;

  if (!isPositiveSafeInt(sessionId)) {
    throw new ValidationError(tErrors.validation);
  }

  const row = await SessionRepository.findWaveContextById(sessionId, tx);
  if (row === null) {
    logger.logDomainError("Session not found for notification wave", {
      code: "SESSION_NOT_FOUND",
      entity: "session",
      entityId: sessionId,
      locale,
    });
    throw new NotFoundError("SESSION", tErrors.sessionNotFound);
  }

  if (row.intent === null || !isSessionIntent(row.intent)) {
    logger.logDomainError("Session intent corrupt for notification wave", {
      code: "SESSION_INTENT_CORRUPT",
      entity: "session",
      entityId: sessionId,
      locale,
    });
    throw new ValidationError("SESSION_INTENT_CORRUPT", tErrors.sessionIntentCorrupt);
  }

  return {
    sessionId: row.sessionId,
    intent: row.intent,
    student: { userId: row.studentUserId, fullName: row.studentFullName, locale: row.studentLocale },
    teacher: { userId: row.teacherUserId, fullName: row.teacherFullName, locale: row.teacherLocale },
  };
}

/** Localized intent label — exhaustive over every SessionIntent member. */
function resolveIntentLabel(
  intent: SessionIntent,
  tNotifications: ReturnType<typeof getServerTranslations>["notificationsTranslations"]
): string {
  switch (intent) {
    case SessionIntent.Hifz:
      return tNotifications.intentHifz;
    case SessionIntent.Tajweed:
      return tNotifications.intentTajweed;
    case SessionIntent.Evaluation:
      return tNotifications.intentEvaluation;
    default: {
      // Exhaustiveness guard — the enum union makes this unreachable.
      const exhaustive: never = intent;
      throw new Error(`Unexpected session intent: ${String(exhaustive)}`);
    }
  }
}

/**
 * Composes the wave's title/body from the notifications namespace in the
 * recipient's locale. The counterparty's display name is the only participant
 * detail that ever appears in copy (plus the intent label on the request
 * wave).
 */
function composeWaveCopy(
  waveKind: SessionRequestWaveKind,
  wave: SessionWaveContext,
  counterparty: SessionWaveParticipantContext,
  tNotifications: ReturnType<typeof getServerTranslations>["notificationsTranslations"]
): { readonly title: string; readonly body: string } {
  switch (waveKind) {
    case "teacher_request":
      return {
        title: tNotifications.eventSessionRequestTitle,
        body: tNotifications.eventSessionRequestBody(
          counterparty.fullName,
          resolveIntentLabel(wave.intent, tNotifications)
        ),
      };
    case "outcome_accepted":
      return {
        title: tNotifications.eventSessionAcceptedTitle,
        body: tNotifications.eventSessionAcceptedBody(counterparty.fullName),
      };
    case "outcome_declined":
      return {
        title: tNotifications.eventSessionDeclinedTitle,
        body: tNotifications.eventSessionDeclinedBody(counterparty.fullName),
      };
    case "outcome_auto_rejected":
      return {
        title: tNotifications.eventSessionAutoRejectedTitle,
        body: tNotifications.eventSessionAutoRejectedBody(counterparty.fullName),
      };
    case "outcome_queued":
      return {
        title: tNotifications.eventSessionQueuedTitle,
        body: tNotifications.eventSessionQueuedBody(counterparty.fullName),
      };
    case "outcome_alternatives_offered":
      return {
        title: tNotifications.eventSessionAlternativesOfferedTitle,
        body: tNotifications.eventSessionAlternativesOfferedBody(counterparty.fullName),
      };
    default: {
      // Exhaustiveness guard — the wave-kind union makes this unreachable.
      const exhaustive: never = waveKind;
      throw new Error(`Unexpected wave kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Delivers one wave through the engine and returns its delivery receipt.
 *
 * Caller-tx: the engine persists inside the caller's transaction and returns
 * the unpublished receipt (its shape is contract-pinned; any deviation is an
 * engine breach surfaced as a typed internal error) — this module NEVER
 * publishes on that path. Transaction-less: the engine commits and publishes
 * exactly once on its own; a replay resolves to the stored prior receipt,
 * while a fresh emission returns the inserted row wrapped into receipt shape.
 */
async function emitWave(
  sessionId: number,
  waveKind: SessionRequestWaveKind,
  recipientSide: "student" | "teacher",
  locale: string,
  tx: DBTransaction | undefined,
  options: NotificationEngineCallOptions | undefined
): Promise<NotificationDeliveryReceipt> {
  const wave = await resolveWaveContext(sessionId, locale, tx);
  const recipient = recipientSide === "teacher" ? wave.teacher : wave.student;
  const counterparty = recipientSide === "teacher" ? wave.student : wave.teacher;
  const recipientLocale = recipient.locale ?? defaultLocale;
  const { title, body } = composeWaveCopy(
    waveKind,
    wave,
    counterparty,
    getServerTranslations(recipientLocale).notificationsTranslations
  );

  const input: NotificationEmitInput = {
    userId: recipient.userId,
    type: NotificationType.SessionRequest,
    title,
    body,
    relatedEntityType: "session",
    relatedEntityId: sessionId,
    idempotencyKey: `session:${sessionId}:${waveKind}`,
  };

  if (tx !== undefined) {
    const result = await NotificationEngine.emitForUser(input, recipientLocale, tx, options);
    if (!("notifications" in result)) {
      throw new DomainError(
        "INTERNAL_SERVER_ERROR",
        getServerTranslations(locale).errorsTranslations.internalServerError
      );
    }
    return result;
  }

  const result = await NotificationEngine.emitForUser(input, recipientLocale, undefined, options);
  if ("notifications" in result) {
    return result;
  }
  return { notifications: [result], recipientUserIds: [recipient.userId] };
}

export namespace SessionRequestNotificationService {
  /** Teacher-facing wave: a student requested a session. */
  export async function notifyTeacherOfSessionRequest(
    sessionId: number,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationDeliveryReceipt> {
    return emitWave(sessionId, "teacher_request", "teacher", locale, tx, options);
  }

  /** Student-facing wave: the teacher accepted the request. */
  export async function notifyStudentOfSessionAccepted(
    sessionId: number,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationDeliveryReceipt> {
    return emitWave(sessionId, "outcome_accepted", "student", locale, tx, options);
  }

  /** Student-facing wave: the teacher declined the request. */
  export async function notifyStudentOfSessionDeclined(
    sessionId: number,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationDeliveryReceipt> {
    return emitWave(sessionId, "outcome_declined", "student", locale, tx, options);
  }

  /** Student-facing wave: the request was auto-rejected by the teacher's preference. */
  export async function notifyStudentOfSessionAutoRejected(
    sessionId: number,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationDeliveryReceipt> {
    return emitWave(sessionId, "outcome_auto_rejected", "student", locale, tx, options);
  }

  /** Student-facing wave: the request was queued for the teacher. */
  export async function notifyStudentOfSessionQueued(
    sessionId: number,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationDeliveryReceipt> {
    return emitWave(sessionId, "outcome_queued", "student", locale, tx, options);
  }

  /** Student-facing wave: alternative teachers were offered. */
  export async function notifyStudentOfAlternativesOffered(
    sessionId: number,
    locale: string,
    tx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<NotificationDeliveryReceipt> {
    return emitWave(sessionId, "outcome_alternatives_offered", "student", locale, tx, options);
  }
}
