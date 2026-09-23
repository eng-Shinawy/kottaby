/**
 * ApplicantLifecycleService — business-logic hub for the teacher-applicant
 * lifecycle domain.
 *
 * Responsibilities:
 *  1. `getMyApplicantProfile` — shape the canonical closed
 *     `ApplicantProfileReturnType` from ONE repository read plus pure
 *     compute. A missing applicants row answers `null` for BOTH
 *     never-applied and already-certified users — the SAME null answer, no
 *     distinction ever leaks to callers (no-oracle guarantee).
 *  2. `assertCanPurchaseVerification` — pure read + compute guard for
 *     buying verification sessions. Rejects with a localized
 *     `NotFoundError` (`APPLICANT_NOT_FOUND`) on a missing row, a
 *     localized custom-code `ValidationError` (`APPLICANT_COOLDOWN_ACTIVE`)
 *     while a cooldown is active, and a localized custom-code
 *     `ValidationError` (`APPLICANT_ALREADY_CERTIFIED`) once the applicant
 *     is certified (`passed` — no verification purchase exists for it).
 *     The cooldown decision reads
 *     `applicants.cooldown_until` ONLY — never `users.suspended` or any
 *     governance field.
 *  3. `recordReapplication` — delegates the single atomic attempt-increment
 *     to `ApplicantRepository.recordVerificationAttempt` and maps its
 *     `null` miss onto a localized `NotFoundError` (the returned updated row
 *     feeds downstream audit-log use).
 *
 * Disciplines enforced here:
 *  - Captured-now: wall clock is read ONCE per invocation; every cooldown
 *    comparison is pure compute against that single instant.
 *  - Duration-agnostic cooldown math — no hardcoded 30d/90d windows
 *    (cooldown durations belong to the write side, which this service is not).
 *  - Logging: `logger.logDomainError` fires ONLY on the enumerated expected
 *    domain rejections (missing-row guard/reapplication misses, active-
 *    cooldown block, already-certified block). Every happy path — including
 *    the profile `null` answer and the whole of `getMyApplicantProfile` —
 *    emits NOTHING. Unexpected internals bubble up unswallowed to the
 *    GraphQL masking boundary.
 *  - Zero writes outside the delegated re-application increment; no locks;
 *    no teacher-table or governance-field contact.
 *  - All user-facing strings resolve through
 *    `getServerTranslations(locale)` (one-arg bundle + property access);
 *    no hardcoded messages, no `console.*`.
 */
import { ApplicantRepository } from "@/backend/db/repo";
import { ApplicantStatus, isApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { ApplicantProfileReturnType, ApplicantSelectType, DBTransaction } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Entity label passed to `NotFoundError` — the code is auto-generated as
 * `${entity}_NOT_FOUND` → `APPLICANT_NOT_FOUND` (entity name, NOT the full
 * code, per docs/graphql/domain-error-extensions-code.md rule 3).
 */
const APPLICANT_ENTITY = "APPLICANT";

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

export namespace ApplicantLifecycleService {
  /**
   * Shapes the caller's own applicant profile (self-scope; the userId comes
   * exclusively from the resolver-derived `ctx.user.id`).
   *
   * Pure read-and-compute: ONE `findByUserId` read, then a single captured
   * `now` drives both derivations.
   *
   * @returns The canonical closed profile shape, or `null` when no
   *     applicants row exists (never-applicant and certified share the one
   *     null answer — no-oracle guarantee).
   * @throws ValidationError  with code `APPLICANT_STATUS_CORRUPT` when the
   *     stored varchar status fails `isApplicantStatus` — fail closed, the
   *     row is never interpreted loosely.
   */
  export async function getMyApplicantProfile(
    userId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<ApplicantProfileReturnType | null> {
    const t = getServerTranslations(locale);

    // Single authoritative read — everything below is compute-only.
    const row = await ApplicantRepository.findByUserId(userId, tx);
    if (!row) {
      // Certified / never-applicant — the SAME null answer.
      return null;
    }

    // Guard-validate the raw varchar against the canonical enum BEFORE any
    // value carries the ReturnType (fail closed — corrupted rows must not
    // fall back to any lenient interpretation).
    if (!isApplicantStatus(row.status)) {
      throw new ValidationError("APPLICANT_STATUS_CORRUPT", t.errorsTranslations.applicantStatusCorrupt);
    }

    // Captured-now discipline — one instant governs every derivation below.
    const now = new Date();
    const cooldownActive = row.cooldownUntil !== null && row.cooldownUntil > now;
    const canPurchaseVerification = !cooldownActive && row.status !== ApplicantStatus.Passed;

    return {
      id: row.id,
      status: row.status,
      // The column carries `default(0)` without NOT NULL, so $inferSelect
      // widens it to number | null while the canonical ReturnType demands a
      // plain number — normalize NULL back to the schema default instead of
      // inventing a sentinel or widening the closed shape.
      verificationAttempts: row.verificationAttempts ?? 0,
      lastAttemptAt: row.lastAttemptAt,
      cooldownUntil: row.cooldownUntil,
      cooldownActive,
      canPurchaseVerification,
    };
  }

  /**
   * Cooldown guard for purchasing verification sessions: a
   * cooldown must have fully expired before any purchase may proceed.
   *
   * Reads `applicants.cooldown_until` via the same single `findByUserId`
   * read pattern and compares STRICTLY (`cooldownUntil > capturedNow`) — a
   * cooldown that expires exactly NOW no longer blocks (strict boundary).
   * Duration-agnostic: whatever instant the write side stored is honored verbatim.
   *
   * This guard performs NO writes and introduces NO lock; TOCTOU is
   * resolved upstream by the purchase flow owning its transaction.
   *
   * @throws NotFoundError    code `APPLICANT_NOT_FOUND` when no applicants
   *     row exists (localized).
   * @throws ValidationError  code `APPLICANT_COOLDOWN_ACTIVE` with the
   *     localized template expanded around the formatted expiry timestamp.
   * @throws ValidationError  code `APPLICANT_ALREADY_CERTIFIED` when the
   *     stored status is `passed` — certification is terminal for the
   *     purchase surface (localized).
   *     Resolves silently otherwise — the happy path emits NOTHING.
   */
  export async function assertCanPurchaseVerification(
    userId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<void> {
    const t = getServerTranslations(locale).errorsTranslations;

    const row = await ApplicantRepository.findByUserId(userId, tx);
    if (!row) {
      logger.logDomainError("Verification purchase denied: applicant profile missing", {
        code: "APPLICANT_NOT_FOUND",
        entity: "applicants",
        entityId: userId,
        locale,
      });
      throw new NotFoundError(APPLICANT_ENTITY, t.applicantNotFound);
    }

    // Captured now — evaluated once, after the read.
    const now = new Date();
    const cooldownUntil = row.cooldownUntil;
    if (cooldownUntil !== null && cooldownUntil > now) {
      const message = expandCooldownTemplate(t.applicantCooldownActive, cooldownUntil, locale);
      logger.logDomainError("Verification purchase denied: re-application cooldown active", {
        code: "APPLICANT_COOLDOWN_ACTIVE",
        entity: "applicants",
        entityId: userId,
        locale,
      });
      throw new ValidationError("APPLICANT_COOLDOWN_ACTIVE", message);
    }

    // Certification is terminal for the purchase surface: a `passed`
    // applicant has no verification left to buy, regardless of cooldown
    // state (checked after the cooldown arm so the time-gated deny wins —
    // it carries the re-apply moment the applicant actually needs).
    if (row.status === ApplicantStatus.Passed) {
      logger.logDomainError("Verification purchase denied: already certified", {
        code: "APPLICANT_ALREADY_CERTIFIED",
        entity: "applicants",
        entityId: userId,
        locale,
      });
      throw new ValidationError("APPLICANT_ALREADY_CERTIFIED", t.applicantAlreadyCertified);
    }
    // Eligible — deliberate silent no-op.
  }

  /**
   * Records one verification re-application attempt by delegating the ATOMIC
   * DB-side increment to `ApplicantRepository.recordVerificationAttempt`
   * (single statement, no application-level read-modify-write).
   *
   * @param tx  Optional transaction — propagated verbatim so a caller-owned
   *     atomic flow stays atomic.
   * @returns The post-update audit row for downstream audit-log use.
   * @throws NotFoundError  code `APPLICANT_NOT_FOUND` when the delegate
   *     reports a miss (zero rows matched).
   */
  export async function recordReapplication(
    userId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<ApplicantSelectType> {
    const t = getServerTranslations(locale).errorsTranslations;

    const row = await ApplicantRepository.recordVerificationAttempt(userId, tx);
    if (!row) {
      logger.logDomainError("Re-application rejected: applicant profile missing", {
        code: "APPLICANT_NOT_FOUND",
        entity: "applicants",
        entityId: userId,
        locale,
      });
      throw new NotFoundError(APPLICANT_ENTITY, t.applicantNotFound);
    }
    return row;
  }
}
