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
 *  4. `extendApplicantCooldown` — the admin cooldown-extension primitive.
 *     Computes the new expiry from the stored instant (or the captured now
 *     when none is in force), writes it through the guarded
 *     `extendCooldownOnce` UPDATE and appends exactly ONE audit row, all
 *     inside ONE transaction, then returns the re-shaped profile.
 *  5. `overrideApplicantEvaluation` — the admin override of an applicant's
 *     automated evaluation result (docs/planning/TICKETS.md "Admin Override
 *     of Evaluation Results"). One transaction per application:
 *     `certify` composes the SAME insert-or-elevate teacher arm the rubric
 *     pass finalization uses and finalizes the applicant (`passed`, cooldown
 *     cleared); `reject` demotes the teacher row (best-effort), flips the
 *     applicant to `failed` with a stamped cooldown through the guarded
 *     `overrideRejectOnce`; `grant_re_evaluation` clears an active cooldown
 *     through the guarded `clearCooldownOnce` (status untouched). Each
 *     application appends exactly ONE audit row (`action_type='override'`)
 *     and emits ONE `applicant_outcome` notification to the applicant —
 *     persisted inside the SAME transaction in the applicant's persisted
 *     locale, with the realtime publish deferred past the commit boundary
 *     this call owns.
 *     The override SUPERSEDES the automated algorithm; the two-source split
 *     still holds for the override's OWN writes — the override never touches
 *     the `users` table directly, and the teacher-row demote is the ONLY
 *     teacher-table write (reject only). The certify direction additionally
 *     composes the conversion seam: a previously converted (failed →
 *     student) applicant has their `teacher` role restored through the
 *     shared `ApplicantConversionService.restoreTeacherRole` guarded flip
 *     on the override's transaction (a silent no-op for a never-converted
 *     applicant).
 *
 * Disciplines enforced here:
 *  - Captured-now: wall clock is read ONCE per invocation; every cooldown
 *    comparison is pure compute against that single instant.
 *  - Duration-agnostic cooldown math — no hardcoded 30d/90d windows
 *    (cooldown durations belong to the write side, which this service is not).
 *  - Logging: `logger.logDomainError` fires ONLY on the enumerated expected
 *    domain rejections (missing-row guard/reapplication/extension misses,
 *    active-cooldown block, already-certified blocks) and on the post-commit
 *    cooldown-extension event. Every other happy path — including
 *    the profile `null` answer and the whole of `getMyApplicantProfile` —
 *    emits NOTHING. Unexpected internals bubble up unswallowed to the
 *    GraphQL masking boundary.
 *  - Writes are confined to the delegated re-application increment, the
 *    admin cooldown extension (+ its audit row), and the admin evaluation
 *    override (+ its audit row); no locks; no governance-field contact and
 *    no `users`-table write apart from the certification restore path —
 *    the cooldown decision reads `applicants.cooldown_until` ONLY, every
 *    cooldown write touches only that column, and the override's
 *    teacher-table writes are the insert-or-elevate certify arm and the
 *    reject-direction demotion. The restore flips a previously converted
 *    applicant's role back to `teacher` via the shared conversion service
 *    (`ApplicantConversionService.restoreTeacherRole`) on the override's
 *    own transaction.
 *  - All user-facing strings resolve through
 *    `getServerTranslations(locale)` (one-arg bundle + property access);
 *    no hardcoded messages, no `console.*`.
 */
import { ApplicantRepository } from "@/backend/db/repo";
import { AdminApplicantOverrideAction } from "@/backend/enum/teachers/applicant-override-action.enum";
import { ApplicantStatus, isApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActiveActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  NotificationEngine,
  type NotificationEngineCallOptions,
} from "@/backend/services/notifications/notification-engine.service";
import {
  APPLICANT_ENTITY,
  COOLDOWN_EXTENSION_MAX_DAYS,
  COOLDOWN_EXTENSION_MIN_DAYS,
  composeCooldownExtensionAudit,
  composeOverrideAudit,
  denyAlreadyCertified,
  deriveCooldownState,
  EPOCH_PAST,
  emitApplicantOutcomeNotification,
  expandCooldownTemplate,
  MS_PER_DAY,
} from "@/backend/services/teachers/applicant-lifecycle.helpers";
import {
  applyCertifyOverride,
  applyGrantReEvaluationOverride,
  applyRejectOverride,
  type OverrideArmContext,
} from "@/backend/services/teachers/applicant-lifecycle.override-arms";
import type {
  ApplicantOverrideAudit,
  ApplicantProfileReturnType,
  ApplicantSelectType,
  DBTransaction,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Re-exports — the two public pure functions live in
 * `./applicant-lifecycle.helpers` (size-budget split, zero behavior
 * change); re-exported here so every importer of
 * `applicant-lifecycle.service` (including the `@/backend/services` barrel)
 * keeps its exact import surface.
 */
export { deriveCooldownState, expandCooldownTemplate } from "@/backend/services/teachers/applicant-lifecycle.helpers";

export namespace ApplicantLifecycleService {
  /**
   * Shapes an applicant profile. GraphQL callers: `myApplicantProfile` is
   * self-scope (the userId comes exclusively from the resolver-derived
   * `ctx.user.id`), and the admin cooldown-extension pipeline re-shapes its
   * post-write read through this same shaper inside its transaction — there
   * the id is the extension's service-validated applicant id (admin-gated
   * upstream; the self surface itself never accepts a client-supplied id).
   *
   * Pure read-and-compute: ONE `findByUserId` read, then a single captured
   * `now` drives every derivation (the cooldown boolean, the purchasability
   * flag, and the explicit cooldown-state enumeration).
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
    // The explicit enumeration rides the SAME captured instant, so it can
    // never drift from the boolean it mirrors.
    const cooldownState = deriveCooldownState(row.cooldownUntil, now);

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
      cooldownState,
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

  /**
   * Admin cooldown-extension primitive. Computes the new expiry as
   * `max(currentCooldownUntil, now) + additionalDays` — the stored instant is
   * honored verbatim while still in force, an expired or absent one re-arms
   * from the captured `now`, so the extension can only LENGTHEN a cooldown,
   * never shorten it. The write goes through the guarded
   * `extendCooldownOnce` UPDATE and appends exactly ONE audit row via
   * `AuditService.createAuditLog`, both inside ONE transaction — the audit
   * row shares the write's commit/rollback fate. Writes ONLY the applicant
   * cooldown instant: the account row's governance fields are never touched
   * from here (the documented two-source split — the `users` table is not
   * imported into this module).
   *
   * `actorId` is the verified caller identity handed over by the admin
   * resolver (its session user id — never a client-supplied field); it lands
   * in the audit row as the acting admin. The defense-in-depth BFLA gate
   * (strict active-admin actor assertion, mirroring the sibling governance
   * pipeline) runs FIRST — an anonymous, missing, non-admin, or governed
   * actor is denied with zero writes and zero audit rows before the bounds
   * validation and before any applicant-row contact. The bounds check runs
   * before any further database contact.
   *
   * @param outerTx  Optional caller transaction — as the FINAL parameter, the
   *     composition seam: when provided the write + audit join it (savepoint
   *     semantics); otherwise a fresh top-level transaction is opened.
   * @throws UnauthorizedError  the actor id is the anonymous sentinel — the
   *     actor gate runs before any other work (localized).
   * @throws ForbiddenError    the actor id does not resolve to a real,
   *     admin-role, non-governed user (localized).
   * @throws ValidationError  code `APPLICANT_COOLDOWN_EXTENSION_INVALID`
   *     when `additionalDays` is not an integer in [1, 3650] (localized).
   * @throws NotFoundError    code `APPLICANT_NOT_FOUND` when no applicants
   *     row exists (localized).
   * @throws ValidationError  code `APPLICANT_ALREADY_CERTIFIED` when the
   *     stored status is `passed` — certification is terminal, there is no
   *     cooldown left to extend (localized). A certification that lands
   *     between the guard read and the guarded write collapses onto the same
   *     typed rejection (the write matched zero rows) instead of an illegal
   *     extension.
   * @returns The re-shaped profile (post-extension expiry + derived state).
   */
  export async function extendApplicantCooldown(
    applicantId: number,
    additionalDays: number,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<ApplicantProfileReturnType> {
    // Defense-in-depth BFLA gate FIRST — authorization precedes validation
    // and every database contact. Anonymous callers receive the
    // unauthenticated class; a missing, non-admin, or governed actor receives
    // the forbidden class. Both denials perform zero writes and mint zero
    // audit rows (the gate runs before the extension transaction opens).
    await assertActiveActorAdmin(actorId, locale, outerTx);

    // Bounds validation NEXT — client input is rejected before any further
    // database contact.
    if (
      !Number.isInteger(additionalDays) ||
      additionalDays < COOLDOWN_EXTENSION_MIN_DAYS ||
      additionalDays > COOLDOWN_EXTENSION_MAX_DAYS
    ) {
      throw new ValidationError(
        "APPLICANT_COOLDOWN_EXTENSION_INVALID",
        getServerTranslations(locale).errorsTranslations.applicantCooldownExtensionInvalid
      );
    }

    const t = getServerTranslations(locale).errorsTranslations;

    const extension = await withTransaction(outerTx, async tx => {
      // Status guard + old expiry from ONE authoritative read.
      const row = await ApplicantRepository.findByUserId(applicantId, tx);
      if (!row) {
        logger.logDomainError("Cooldown extension denied: applicant profile missing", {
          code: "APPLICANT_NOT_FOUND",
          entity: "applicants",
          entityId: applicantId,
          locale,
        });
        throw new NotFoundError(APPLICANT_ENTITY, t.applicantNotFound);
      }

      // Certification is terminal — a certified applicant has no cooldown
      // left to extend.
      if (row.status === ApplicantStatus.Passed) {
        denyAlreadyCertified(applicantId, locale, t.applicantAlreadyCertified);
      }

      // Captured-now discipline — one instant joins the base selection. The
      // stored cooldown is honored verbatim while still in force; an expired
      // or absent one collapses onto `now` via the pre-epoch sentinel (fresh
      // window from today) — the extension can only lengthen, never shorten.
      const now = new Date();
      const base = row.cooldownUntil ?? EPOCH_PAST;
      const newExpiry = new Date(Math.max(base.getTime(), now.getTime()) + additionalDays * MS_PER_DAY);

      // Guarded write — the eligible pre-states are re-evaluated atomically
      // at write time, so a concurrent certification collapses onto the typed
      // certified rejection instead of an illegal extension.
      const updated = await ApplicantRepository.extendCooldownOnce(applicantId, newExpiry, tx);
      if (!updated) {
        denyAlreadyCertified(applicantId, locale, t.applicantAlreadyCertified);
      }

      // Audit trail — exactly ONE row, same transaction, field NAMES +
      // instants only.
      await AuditService.createAuditLog(
        composeCooldownExtensionAudit(actorId, applicantId, row.cooldownUntil, newExpiry, additionalDays),
        tx
      );

      // The shaper re-reads through the SAME transaction, so the returned
      // profile reflects the extension it just committed to. Its null answer
      // cannot occur here (the guarded write just matched this row) — the
      // fail-closed arm keeps the non-null return contract instead of
      // widening it.
      const profile = await getMyApplicantProfile(applicantId, locale, tx);
      if (profile === null) {
        logger.logDomainError("Cooldown extension: post-write profile read missed", {
          code: "APPLICANT_NOT_FOUND",
          entity: "applicants",
          entityId: applicantId,
          locale,
        });
        throw new NotFoundError(APPLICANT_ENTITY, t.applicantNotFound);
      }

      return { profile, oldExpiry: row.cooldownUntil, newExpiry };
    });

    // Post-commit domain event — the extension is observable in the log even
    // when no caller inspects the audit trail. The structured context carries
    // the machine-readable `code` member (the universal DomainErrorContext
    // convention) so log consumers keying on `code` see this event like any
    // other; the payload stays entity ids + instants only — never PII.
    logger.logDomainError("APPLICANT_COOLDOWN_EXTENDED", {
      code: "APPLICANT_COOLDOWN_EXTENDED",
      applicantId,
      additionalDays,
      oldExpiry: extension.oldExpiry === null ? null : extension.oldExpiry.toISOString(),
      newExpiry: extension.newExpiry.toISOString(),
    });

    return extension.profile;
  }

  /**
   * Admin override of an applicant's automated evaluation result — the
   * manual certification / rejection / re-evaluation grant of
   * docs/planning/TICKETS.md "Admin Override of Evaluation Results". The
   * override SUPERSEDES the automated algorithm: it re-uses the exact
   * write primitives the rubric finalization composes (insert-or-elevate
   * teacher arm, guarded status transitions) but is NOT a second verdict
   * writer — it composes them, and every application appends exactly ONE
   * audit row with `action_type='override'` in the SAME transaction.
   *
   * Per-direction semantics:
   *  - `certify`  — a non-`passed` applicant is certified: the teacher row
   *    is inserted directly certified (`is_approved=true`,
   *    `is_evaluator=false`) on a nested savepoint, or — on a duplicate
   *    (`23505` — a pre-existing row) — the locked row is ELEVATED with its
   *    OWN evaluator flag (a blind `false` would demote a pre-existing
   *    evaluator), exactly the `finalizeRubricPass` composition; the
   *    applicant is then finalized (`passed`, cooldown cleared) via
   *    `finalizeOnCertification`, and a previously converted (failed →
   *    student) applicant has their `teacher` role restored through the
   *    shared conversion helper on the SAME transaction (the guarded
   *    `student` → `teacher` flip — a silent no-op for a never-converted
   *    applicant; the historical `students` row is untouched).
   *  - `reject`   — a `passed` applicant is manually rejected: the teacher
   *    row is demoted (`is_approved=false` — the ONLY teacher-table write,
   *    best-effort: a missing/already-unapproved row is a no-op), the
   *    applicant flips to `failed` with the caller-requested cooldown
   *    stamped through the guarded `overrideRejectOnce` (a concurrent
   *    certification that won the race collapses onto the typed certified
   *    rejection), and the audit details carry the stamped instant + the
   *    requested length. `cooldownDays` is validated ONLY on this
   *    direction (the `adminSetUserSuspended`-period precedent) and is
   *    IGNORED on the other two.
   *  - `grant_re_evaluation` — an ACTIVE cooldown is lifted so the
   *    applicant may re-purchase verification without waiting for expiry:
   *    `clearCooldownOnce` NULLs the instant (status untouched); an
   *    applicant without a stamped cooldown is a typed denial.
   *
   * The defense-in-depth BFLA gate (strict active-admin actor assertion)
   * runs FIRST — an anonymous, missing, non-admin, or governed actor is
   * denied with zero writes and zero audit rows before any other work.
   *
   * @param applicantId  The target applicant's id (service-validated
   *     upstream by the admin resolver's positive-id guard).
   * @param action  The override direction (wire enum member).
   * @param cooldownDays  The reject-direction cooldown length in whole days
   *     (`1..3650` integer; `null`/ignored on the other directions).
   * @param actorId  The verified caller identity handed over by the admin
   *     resolver (its session user id — never a client-supplied field); it
   *     lands in the audit row as the acting admin.
   * @param outerTx  Optional caller transaction — the composition seam:
   *     when provided the writes + audit join it (savepoint semantics);
   *     otherwise a fresh top-level transaction is opened.
   * @param options  Optional notification-engine call options (the realtime
   *     fanout transport + the idempotency claim cache, threaded from the
   *     GraphQL context by the caller per the parent-link precedent).
   * @throws UnauthorizedError  the actor id is the anonymous sentinel — the
   *     actor gate runs before any other work (localized).
   * @throws ForbiddenError    the actor id does not resolve to a real,
   *     admin-role, non-governed user (localized).
   * @throws NotFoundError    code `APPLICANT_NOT_FOUND` when no applicants
   *     row exists (localized).
   * @throws ValidationError  code `APPLICANT_ALREADY_CERTIFIED` when the
   *     stored status is `passed` on the certify / grant directions, or
   *     when a concurrent certification wins between the guard read and
   *     the guarded write on ANY direction (localized).
   * @throws ValidationError  code `APPLICANT_OVERRIDE_NOT_PASSED` when a
   *     reject targets a non-`passed` applicant (localized).
   * @throws ValidationError  code `APPLICANT_OVERRIDE_COOLDOWN_INVALID`
   *     when the reject-direction `cooldownDays` is not an integer in
   *     [1, 3650] (localized).
   * @throws ValidationError  code `APPLICANT_NO_ACTIVE_COOLDOWN` when a
   *     grant targets an applicant with no stamped cooldown (localized).
   * @throws ConflictError    code `APPLICANT_ALREADY_FINALIZED` when the
   *     certify-direction finalize matches zero rows (practically
   *     unreachable post-guard — the fail-closed arm mirrors the rubric
   *     path; localized).
   * @returns The re-shaped post-override profile (plus the guard-read
   *     prior status / cooldown the audit `from` values were composed
   *     from).
   *
   * Recipient notification: EVERY applied override emits ONE
   * `applicant_outcome` notification to the applicant — persisted INSIDE
   * the same transaction (a rollback of the override takes the
   * notification with it), composed in the applicant's persisted locale,
   * and published to the realtime channel only after the commit boundary
   * this call owns (a caller-owned transaction publishes after ITS commit
   * — nothing is ever pushed for a rolled-back emit).
   */
  export async function overrideApplicantEvaluation(
    applicantId: number,
    action: AdminApplicantOverrideAction,
    cooldownDays: number | null,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<ApplicantProfileReturnType> {
    // Defense-in-depth BFLA gate FIRST — authorization precedes validation
    // and every database contact. Both denial classes perform zero writes
    // and mint zero audit rows (the gate runs before the override
    // transaction opens).
    await assertActiveActorAdmin(actorId, locale, outerTx);

    const t = getServerTranslations(locale).errorsTranslations;

    const override = await withTransaction(outerTx, async tx => {
      // Guard read — the prior status / cooldown the audit `from` values
      // compose from (the same ONE authoritative read the extension uses).
      const row = await ApplicantRepository.findByUserId(applicantId, tx);
      if (!row) {
        logger.logDomainError("Applicant override denied: applicant profile missing", {
          code: "APPLICANT_NOT_FOUND",
          entity: "applicants",
          entityId: applicantId,
          locale,
        });
        throw new NotFoundError(APPLICANT_ENTITY, t.applicantNotFound);
      }

      // Guard-validate the raw varchar against the canonical enum BEFORE it
      // feeds the direction arms (the profile-shaper discipline — corrupted
      // rows fail closed instead of reaching a write).
      if (!isApplicantStatus(row.status)) {
        throw new ValidationError("APPLICANT_STATUS_CORRUPT", t.applicantStatusCorrupt);
      }

      // The three direction arms each run their own pre-write guards,
      // apply their guarded writes, and return the audit `details` they
      // composed. The dispatch is the ONLY branchwork the orchestrator
      // keeps — every arm's complexity lives with its write unit.
      const armContext: OverrideArmContext = { tx, applicantId, locale, t };
      let details: ApplicantOverrideAudit;
      if (action === AdminApplicantOverrideAction.Certify) {
        details = await applyCertifyOverride(armContext, row.status);
      } else if (action === AdminApplicantOverrideAction.Reject) {
        details = await applyRejectOverride(armContext, row.status, cooldownDays);
      } else {
        details = await applyGrantReEvaluationOverride(armContext, row.status, row.cooldownUntil);
      }

      // Audit trail — exactly ONE row per applied override, same
      // transaction, action_type='override', field NAMES + values only.
      await AuditService.createAuditLog(composeOverrideAudit(actorId, applicantId, details), tx);

      // Recipient notification — ONE `applicant_outcome` row to the
      // applicant, composed in THEIR persisted locale and persisted
      // through the engine's in-tx branch (a rollback of the override
      // takes the notification with it). The copy carries the direction
      // only — never the admin identity, never evaluation content.
      const { receipt: emitted, recipientLocale } = await emitApplicantOutcomeNotification(
        applicantId,
        action,
        cooldownDays,
        tx,
        options
      );

      // The shaper re-reads through the SAME transaction, so the returned
      // profile reflects the override it just committed to. Its null answer
      // cannot occur here (the guarded writes just matched this row) — the
      // fail-closed arm keeps the non-null return contract instead of
      // widening it.
      const profile = await getMyApplicantProfile(applicantId, locale, tx);
      if (profile === null) {
        logger.logDomainError("Applicant override: post-write profile read missed", {
          code: "APPLICANT_NOT_FOUND",
          entity: "applicants",
          entityId: applicantId,
          locale,
        });
        throw new NotFoundError(APPLICANT_ENTITY, t.applicantNotFound);
      }

      return { profile, oldStatus: row.status, oldCooldown: row.cooldownUntil, receipt: emitted, recipientLocale };
    });

    // Post-commit realtime publish — ONLY when this call owned the commit
    // (the parent-link precedent): a caller-owned transaction publishes
    // after ITS commit via `NotificationEngine.publishReceipts`, so
    // nothing is ever pushed for a rolled-back emit.
    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts([override.receipt], override.recipientLocale, options);
    }

    // Post-commit domain event — the override is observable in the log even
    // when no caller inspects the audit trail. The structured context carries
    // the machine-readable `code` member (the universal DomainErrorContext
    // convention) so log consumers keying on `code` see this event like any
    // other; the payload stays entity ids + the direction only — never PII.
    logger.logDomainError("APPLICANT_OVERRIDE_APPLIED", {
      code: "APPLICANT_OVERRIDE_APPLIED",
      applicantId,
      action,
      actorId,
    });

    return override.profile;
  }
}
