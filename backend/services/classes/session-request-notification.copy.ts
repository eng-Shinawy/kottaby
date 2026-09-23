/**
 * Session-request wave copy composition — the pure, locale-driven title/body
 * composition for the request-intake and completion-handshake waves,
 * extracted verbatim (behavior-identical max-lines refactor) from the
 * `session-request-notification.service.ts` hub.
 *
 * Localization contract (unchanged): the engine stores copy verbatim and
 * NEVER translates, so the per-recipient locale composition is the calling
 * hub's obligation — the translations object passed in must already be
 * composed in the RECIPIENT's persisted locale.
 */
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import type { SessionRequestWaveKind, SessionWaveContext, SessionWaveParticipantContext } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

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
export function composeWaveCopy(
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
    case "completion_prompt":
      return {
        title: tNotifications.eventSessionCompletionPromptTitle,
        body: tNotifications.eventSessionCompletionPromptBody(counterparty.fullName),
      };
    case "completion_auto_cancelled":
      return {
        title: tNotifications.eventSessionAutoCancelledTitle,
        body: tNotifications.eventSessionAutoCancelledBody(counterparty.fullName),
      };
    default: {
      // Exhaustiveness guard — the wave-kind union makes this unreachable.
      const exhaustive: never = waveKind;
      throw new Error(`Unexpected wave kind: ${String(exhaustive)}`);
    }
  }
}
