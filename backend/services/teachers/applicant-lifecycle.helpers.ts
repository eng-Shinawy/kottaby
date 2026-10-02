/**
 * Applicant-lifecycle service helpers — the module-private pure units and
 * the applicant-outcome notification emitter, extracted verbatim from
 * `applicant-lifecycle.service.ts` (size-budget split, zero behavior
 * change: same logic, same order of operations, same error handling).
 *
 * The service module re-exports the two public pure functions
 * (`expandCooldownTemplate`, `deriveCooldownState`) so every importer of
 * `applicant-lifecycle.service` keeps its exact import surface.
 */
import { UserRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ApplicantCooldownState } from "@/backend/enum/teachers/applicant-cooldown-state.enum";
import { AdminApplicantOverrideAction } from "@/backend/enum/teachers/applicant-override-action.enum";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  NotificationEngine,
  type NotificationEngineCallOptions,
} from "@/backend/services/notifications/notification-engine.service";
import type {
  ApplicantCooldownExtensionAudit,
  ApplicantOverrideAudit,
  AuditLogWriteContract,
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationReturnType,
} from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/**
 * Entity label passed to `NotFoundError` — the code is auto-generated as
 * `${entity}_NOT_FOUND` → `APPLICANT_NOT_FOUND` (entity name, NOT the full
 * code, per docs/graphql/domain-error-extensions-code.md rule 3).
 */
export const APPLICANT_ENTITY = "APPLICANT";

/**
 * The polymorphic `related_entity_type` pointer persisted on every
 * applicant-outcome notification — the plain table pointer convention
 * (session emitters persist `"session"`; this domain points at the
 * applicants row the decision landed on).
 */
const APPLICANT_OUTCOME_RELATED_ENTITY_TYPE = "applicants";

/**
 * Resolves the request locale into a BCP-47 tag for ICU formatting.
 *
 * The app ships exactly two locales ("ar" | "en" — `shared/locale/AppLocale.ts`);
 * `getServerTranslations` resolves every OTHER input to the default locale
 * `"ar"`. This helper applies the SAME fallback so an interpolated
 * timestamp always lands in the language of the message template it is
 * embedded into (byte-consistent with `resolveLocale` in
 * `shared/locale/server.ts`: only exact `"en"` selects English).
 */
function resolveLocaleTag(locale: string): "ar" | "en" {
  return locale === "en" ? "en" : "ar";
}

/**
 * Assertion-free narrowing of the engine's emit union (the
 * `parent-link-request.helpers` precedent): the IN-TX branch of
 * `emitForUser` always resolves to the delivery receipt — the row variant
 * is the own-transaction convenience path this service never observes
 * (it always hands the engine its caller's transaction).
 */
function isApplicantDeliveryReceipt(
  value: NotificationDeliveryReceipt | NotificationReturnType
): value is NotificationDeliveryReceipt {
  return "recipientUserIds" in value;
}

/**
 * Emits the applicant-outcome notification for one applied override — the
 * WHOLE recipient-notification unit (locale resolve → copy compose →
 * in-tx emit → receipt narrow) carved out so the override orchestrator
 * stays a readable three-arm flow.
 *
 * The emit is persist-first on the caller's transaction: a rollback of the
 * override takes the notification with it. The publish-after-commit step
 * is NOT this helper's job — it belongs to the caller's post-commit
 * boundary, which needs the returned receipt + locale.
 *
 * @returns The delivery receipt plus the recipient locale the copy was
 *     composed from (the publish needs both).
 */
export async function emitApplicantOutcomeNotification(
  applicantId: number,
  action: AdminApplicantOverrideAction,
  cooldownDays: number | null,
  tx: DBTransaction,
  options?: NotificationEngineCallOptions
): Promise<{ receipt: NotificationDeliveryReceipt; recipientLocale: string }> {
  // The recipient locale is the APPLICANT's persisted locale (never the
  // acting admin's), resolved inside the SAME transaction.
  const recipientLocales = await UserRepository.findLocalesByIds([applicantId], tx);
  const recipientLocale = recipientLocales.get(applicantId) ?? defaultLocale;
  const recipientCopy = getServerTranslations(recipientLocale).notificationsTranslations;
  const notificationCopy = composeApplicantOverrideNotificationCopy(
    action,
    action === AdminApplicantOverrideAction.Reject ? cooldownDays : null,
    recipientCopy
  );

  // No idempotency key: each applied override is a distinct logical event
  // (the parent-link respond precedent).
  const emitted = await NotificationEngine.emitForUser(
    {
      userId: applicantId,
      type: NotificationType.ApplicantOutcome,
      title: notificationCopy.title,
      body: notificationCopy.body,
      relatedEntityType: APPLICANT_OUTCOME_RELATED_ENTITY_TYPE,
      relatedEntityId: applicantId,
    },
    recipientLocale,
    tx,
    options
  );
  if (!isApplicantDeliveryReceipt(emitted)) {
    throw new Error(
      "ApplicantLifecycleService.overrideApplicantEvaluation: in-tx emit returned a row instead of the receipt"
    );
  }

  return { receipt: emitted, recipientLocale };
}

/**
 * Composes the recipient-facing title/body pair for one override direction
 * from the RECIPIENT's translation slice. The copy carries the direction
 * only — never the admin identity, never evaluation scores or reason
 * content (the session-governance plain-factual-copy discipline): the
 * applicant's own surfaces own any detailed review path.
 *
 * The reject direction consumes the ALREADY-VALIDATED day window (the
 * bounds check runs inside the override transaction before this composer
 * is reached) — a missing window at compose time is an internal invariant
 * violation, not a user-facing error, so it fails closed with a thrown
 * invariant message instead of fabricating a count.
 */
function composeApplicantOverrideNotificationCopy(
  action: AdminApplicantOverrideAction,
  cooldownDays: number | null,
  copy: NotificationsLabels
): { title: string; body: string } {
  if (action === AdminApplicantOverrideAction.Certify) {
    return {
      title: copy.eventApplicantOverrideCertifiedTitle,
      body: copy.eventApplicantOverrideCertifiedBody,
    };
  }
  if (action === AdminApplicantOverrideAction.Reject) {
    if (cooldownDays === null) {
      throw new Error("ApplicantLifecycleService: reject-direction notification copy requires a validated day window");
    }
    return {
      title: copy.eventApplicantOverrideRejectedTitle,
      body: copy.eventApplicantOverrideRejectedBody(cooldownDays),
    };
  }
  return {
    title: copy.eventApplicantOverrideReEvaluationTitle,
    body: copy.eventApplicantOverrideReEvaluationBody,
  };
}

/**
 * Module-private server-side cooldown-timestamp formatters.
 *
 * Deterministic by construction: fixed UTC timeZone + fixed component set +
 * forced 24-hour clock ⇒ the same instant renders byte-identically in every
 * environment (host time zone cannot make a test flaky). Digit shape and
 * month order follow the runtime's ICU data: Arabic-Indic digits under
 * `"ar"`, Latin digits under `"en"`.
 *
 * Rationale: no shared server-side date-util exists yet; this table keeps
 * the single server-side consumer self-contained instead of scattering
 * ad-hoc `toLocaleString` calls.
 */
const COOLDOWN_FORMATTERS = {
  ar: new Intl.DateTimeFormat("ar", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }),
  en: new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }),
} as const;

/**
 * Milliseconds per day — converts an extension's day count into the instant
 * arithmetic the cooldown write performs. Module-private by design: the
 * shared evaluation-rubric constants ship day COUNTS only, never a
 * millisecond conversion.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Sentinel pre-epoch instant — collapses a NULL stored cooldown onto the
 * captured `now` when an extension selects its base instant (extending an
 * applicant whose cooldown has expired or was never stamped starts a fresh
 * window from today).
 */
export const EPOCH_PAST = new Date(0);

/** Lowest extension length an admin may request (days) — mirrors the platform's account-governance window floor. */
export const COOLDOWN_EXTENSION_MIN_DAYS = 1;

/** Highest extension length an admin may request (days) — mirrors the platform's account-governance window ceiling. */
export const COOLDOWN_EXTENSION_MAX_DAYS = 3650;

/**
 * Formats a cooldown-expiry instant for embedding into the localized
 * `{cooldownUntil}` message slot.
 */
function formatCooldownExpiry(cooldownUntil: Date, locale: string): string {
  const formatter = COOLDOWN_FORMATTERS[resolveLocaleTag(locale)];
  return formatter.format(cooldownUntil);
}

/**
 * Expands the single ICU `{cooldownUntil}` placeholder of a translated
 * cooldown template. The repo has NO runtime ICU expander yet — consumers
 * interpolate via simple typed replacement; the placeholder NAME is pinned
 * identical across ar/en by the locale parity suites, so a bare `replace`
 * cannot leave residue behind. Shared by every cooldown-copy composer in
 * the domain (the purchase guard below and the evaluation-outcome
 * notification) so the rendered instant keeps ONE format.
 */
export function expandCooldownTemplate(template: string, cooldownUntil: Date, locale: string): string {
  return template.replace("{cooldownUntil}", formatCooldownExpiry(cooldownUntil, locale));
}

/**
 * Pure compute — derives the cooldown read-model state from the stored
 * cooldown instant against ONE captured `now`. The active predicate is the
 * strict `cooldownUntil > now` boundary shared with the purchase guard: a
 * cooldown expiring exactly at the captured instant has already expired and
 * no longer gates. Exported so every cooldown-state projection in the
 * service layer (the self profile below and the admin applicant snapshot)
 * keeps this ONE boundary instead of re-deriving it.
 */
export function deriveCooldownState(cooldownUntil: Date | null, now: Date): ApplicantCooldownState {
  if (cooldownUntil === null) {
    return ApplicantCooldownState.None;
  }
  return cooldownUntil > now ? ApplicantCooldownState.Active : ApplicantCooldownState.Expired;
}

/**
 * Logs and throws the terminal certified rejection — the shared shape of
 * BOTH certified arms (the guard read and the guarded-write miss after a
 * concurrent certification).
 */
export function denyAlreadyCertified(applicantId: number, locale: string, message: string): never {
  logger.logDomainError("Cooldown extension denied: already certified", {
    code: "APPLICANT_ALREADY_CERTIFIED",
    entity: "applicants",
    entityId: applicantId,
    locale,
  });
  throw new ValidationError("APPLICANT_ALREADY_CERTIFIED", message);
}

/**
 * Composes the cooldown-extension audit contract: the changed field NAME, the
 * old/new expiry instants and the requested length — never contact PII,
 * credentials, or token values. Composition lives with the service (the
 * audit writer only persists a fully composed contract verbatim).
 */
export function composeCooldownExtensionAudit(
  actorId: number,
  applicantId: number,
  oldExpiry: Date | null,
  newExpiry: Date,
  additionalDays: number
): AuditLogWriteContract {
  const details: ApplicantCooldownExtensionAudit = {
    field: "cooldown_until",
    from: oldExpiry === null ? null : oldExpiry.toISOString(),
    to: newExpiry.toISOString(),
    additionalDays,
  };
  return {
    actorId,
    actionType: AuditActionType.Adjust,
    entityType: "applicant",
    entityId: applicantId,
    details: JSON.stringify(details),
  };
}

/**
 * Composes the evaluation-override audit contract: the override DIRECTION,
 * the changed field NAME and the old/new values (status vocabulary or ISO
 * instants), plus the stamped cooldown members on the reject direction —
 * never contact PII, credentials, or token values. Composition lives with
 * the service (the audit writer only persists a fully composed contract
 * verbatim); the persisted row's `action_type` is ALWAYS `Override`.
 */
export function composeOverrideAudit(
  actorId: number,
  applicantId: number,
  details: ApplicantOverrideAudit
): AuditLogWriteContract {
  return {
    actorId,
    actionType: AuditActionType.Override,
    entityType: "applicant",
    entityId: applicantId,
    details: JSON.stringify(details),
  };
}
