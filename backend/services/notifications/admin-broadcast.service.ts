/**
 * AdminBroadcastService — the composition core of the admin broadcast
 * surface. One admin-authored announcement becomes one `system_broadcast`
 * notification per resolved recipient, exactly one audit row, and — only
 * after the unit commits — one realtime fan-out envelope carrying the full
 * recipient list.
 *
 * The service is a pure COMPOSITOR: it never writes `notifications` rows
 * itself. The notification engine is consumed by reference (imported, never
 * edited, never bypassed) and remains the single writer of the notifications
 * table; the audience repository resolves recipients; the shared audit
 * writer persists the trail. Every write shares ONE transaction: the batch
 * insert and the audit row commit or roll back together, and the fan-out
 * publish happens strictly after that commit.
 *
 * Flow (one public entry point, `broadcast`):
 *  1. Shared admin gate — pre-transaction; both denial flavors write
 *     nothing and are logged by the gate itself (never re-logged here).
 *  2. Pre-DB validation — title bounds plus the audience coherence
 *     matrix, fail-closed with localized, documented error codes.
 *  3. Plan existence (plan cohorts) and cohort resolution through the
 *     audience repository (governance-filtered, de-duplicated, id ASC).
 *     Reads ride the caller's transaction when one is supplied.
 *  4. Empty / oversized cohort guards — both reject before ANY write.
 *  5. ONE transaction: the engine's batch emit plus exactly one audit
 *     row. A same-key replay is detected structurally (the engine hands
 *     back a stored receipt) and writes NOTHING.
 *  6. Post-commit fan-out publish — fresh emissions only.
 *  7. Return the persisted recipient count.
 *
 * Security posture:
 *  - Input mapping is field-by-field into the engine's batch contract —
 *    never a spread — so no transport-smuggled field can reach persistence.
 *  - The ONLY identity input is the verified actor id (resolved to a real
 *    admin row by the shared gate); recipients are derived server-side
 *    from the audience selector, so there is no per-identity surface.
 *  - Expected rejections log exactly one bounded `logger.logDomainError`
 *    each (code + entity + locale — never copy text, never recipient
 *    lists, never the raw idempotency key); happy paths, including
 *    replays, log NOTHING.
 */
import { BroadcastAudienceRepository, PlanRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import {
  BroadcastAudienceType,
  isBroadcastAudienceType,
} from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { toUserRole, type UserRole } from "@/backend/enum/users/user-role.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import {
  NotificationEngine,
  type NotificationEngineCallOptions,
} from "@/backend/services/notifications/notification-engine.service";
import { resolveBroadcastClaimCache } from "@/backend/services/notifications/redis-claim-cache";
import type { BroadcastAudienceSelector, BroadcastNotificationSubmitInput, DBTransaction } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Hard ceiling on one broadcast's resolved recipient set. A cohort above it
 * is rejected BEFORE any write: the cap keeps the engine's single batch
 * insert well under PostgreSQL's per-statement parameter ceiling and the
 * single fan-out envelope bounded.
 */
export const BROADCAST_MAX_RECIPIENTS = 5000;

/** `users.country` column bound (varchar(100)) — the country companion's ceiling. */
const COUNTRY_MAX_LENGTH = 100;

/** `notifications.title` column bound (varchar(255)) — mirrors the engine's emit ceiling. */
const TITLE_MAX_LENGTH = 255;

/** The audit entity label for every accepted broadcast (a broadcast has no single backing row). */
const AUDIT_ENTITY_TYPE = "notification_broadcast";

/**
 * The coherence-validated audience selector — the closed, per-kind normalized
 * shape that flows onward to cohort resolution and the audit metadata. Each
 * member carries EXACTLY the companion its kind requires (never a spread of
 * the raw input); the union is structurally assignable to the canonical
 * `BroadcastAudienceSelector` the repository consumes, while letting the
 * flow narrow each companion honestly (no type assertions).
 */
type ValidatedAudienceSelector =
  | { readonly type: BroadcastAudienceType.All }
  | { readonly type: BroadcastAudienceType.Role; readonly role: UserRole }
  | { readonly type: BroadcastAudienceType.Country; readonly country: string }
  | { readonly type: BroadcastAudienceType.Plan; readonly planId: number };

/** Wire-level "not provided" semantics: both absent and explicit null are absent. */
function isCompanionPresent<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/**
 * One bounded diagnostic + localized rejection for the broadcast surface's
 * expected `ValidationError` codes. The message is server-side diagnostics
 * only (codes and bounds — no copy text, no recipient data); the localized
 * user-facing string rides the thrown error.
 */
function rejectBroadcast(locale: string, code: string, diagnostic: string, localizedMessage: string): never {
  logger.logDomainError(diagnostic, { code, entity: "notifications", locale });
  throw new ValidationError(code, localizedMessage);
}

/**
 * Per-kind companion validation — `null` when the kind's coherence rule is
 * violated, otherwise the normalized companion-only selector. Kept as one
 * tiny validator per kind so each rule stays independently readable.
 *
 *  - `all`     — every companion absent;
 *  - `role`    — a recognized user role required, country/planId absent;
 *  - `country` — a trimmed, non-empty, ≤100 character country required,
 *                role/planId absent (the trimmed value is what resolves);
 *  - `plan`    — a positive safe integer planId required, role/country absent.
 */
function validateAllKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (
    isCompanionPresent(selector.role) ||
    isCompanionPresent(selector.country) ||
    isCompanionPresent(selector.planId)
  ) {
    return null;
  }
  return { type: BroadcastAudienceType.All };
}

function validateRoleKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (isCompanionPresent(selector.country) || isCompanionPresent(selector.planId)) {
    return null;
  }
  if (!isCompanionPresent(selector.role)) {
    return null;
  }
  const role = toUserRole(selector.role);
  if (role === null) {
    return null;
  }
  return { type: BroadcastAudienceType.Role, role };
}

function validateCountryKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (isCompanionPresent(selector.role) || isCompanionPresent(selector.planId)) {
    return null;
  }
  if (!isCompanionPresent(selector.country) || typeof selector.country !== "string") {
    return null;
  }
  const country = selector.country.trim();
  if (country.length === 0 || country.length > COUNTRY_MAX_LENGTH) {
    return null;
  }
  return { type: BroadcastAudienceType.Country, country };
}

function validatePlanKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (isCompanionPresent(selector.role) || isCompanionPresent(selector.country)) {
    return null;
  }
  if (!isPositiveSafeInt(selector.planId)) {
    return null;
  }
  return { type: BroadcastAudienceType.Plan, planId: selector.planId };
}

/**
 * Validates the audience selector against the closed coherence matrix and
 * returns the normalized companion-only selector. Any violation — including
 * a hostile non-member kind string or a role the role coercion rejects — is
 * one bounded log + one localized rejection.
 */
function validateAudienceCoherence(
  selector: BroadcastAudienceSelector,
  locale: string,
  audienceInvalidMessage: string
): ValidatedAudienceSelector {
  const fail = (): never =>
    rejectBroadcast(
      locale,
      "BROADCAST_AUDIENCE_INVALID",
      "Admin broadcast rejected: audience selector violates the coherence matrix",
      audienceInvalidMessage
    );

  if (!isBroadcastAudienceType(selector.type)) {
    return fail();
  }

  let validated: ValidatedAudienceSelector | null;
  switch (selector.type) {
    case BroadcastAudienceType.All: {
      validated = validateAllKind(selector);
      break;
    }
    case BroadcastAudienceType.Role: {
      validated = validateRoleKind(selector);
      break;
    }
    case BroadcastAudienceType.Country: {
      validated = validateCountryKind(selector);
      break;
    }
    case BroadcastAudienceType.Plan: {
      validated = validatePlanKind(selector);
      break;
    }
    default: {
      // Fail-closed arm for a runtime-hostile discriminant that evaded the
      // enum guard (TS enums are erased at runtime) — same posture as the
      // audience repository's unhandled-kind arm.
      validated = null;
    }
  }

  if (validated === null) {
    return fail();
  }
  return validated;
}

/**
 * Composes the audit metadata for one accepted broadcast, in the documented
 * key order — the cohort scope first, exactly the companion its kind
 * requires, and the persisted recipient count last — NEVER the copy text,
 * never recipient identifiers. The shared audit writer defensively caps the
 * serialized payload to its column bound.
 */
function buildBroadcastAuditDetails(selector: ValidatedAudienceSelector, recipientCount: number): string {
  const metadata: Record<string, unknown> = { scope: selector.type };
  if (selector.type === BroadcastAudienceType.Role) {
    metadata.role = selector.role;
  }
  if (selector.type === BroadcastAudienceType.Country) {
    metadata.country = selector.country;
  }
  if (selector.type === BroadcastAudienceType.Plan) {
    metadata.planId = selector.planId;
  }
  metadata.recipientCount = recipientCount;
  return JSON.stringify(metadata);
}

/**
 * Resolves the broadcast's recipient cohort: plan existence first on the
 * plan path (the admin-surface oracle ruling — a plan-miss discloses its
 * code here and ONLY here), then the governed, de-duplicated, id-ASC
 * cohort. Reads ride the caller's transaction when one is supplied.
 */
async function resolveBroadcastRecipients(
  selector: ValidatedAudienceSelector,
  locale: string,
  planNotFoundMessage: string,
  outerTx?: DBTransaction
): Promise<number[]> {
  if (selector.type === BroadcastAudienceType.Plan) {
    const planExists = await PlanRepository.existsById(selector.planId, outerTx);
    if (!planExists) {
      logger.logDomainError("Admin broadcast rejected: target plan does not exist", {
        code: "PLAN_NOT_FOUND",
        entity: "plans",
        entityId: selector.planId,
        locale,
      });
      throw new NotFoundError("PLAN", planNotFoundMessage);
    }
  }
  // Bound the read at cap+1: an over-cap cohort is detected by the truncated
  // length (5001 > BROADCAST_MAX_RECIPIENTS) without transferring the full
  // audience; cohorts within the cap resolve byte-identically to an
  // unbounded read (ORDER BY id ASC + LIMIT never changes membership there).
  return BroadcastAudienceRepository.resolveAudienceIds(selector, outerTx, BROADCAST_MAX_RECIPIENTS + 1);
}

/**
 * Cohort guards — both reject before ANY write: an empty resolution and a
 * resolution beyond the recipient cap are honest, localized rejections.
 */
function assertCohortSize(
  recipientIds: readonly number[],
  locale: string,
  emptyMessage: string,
  tooLargeMessage: string
): void {
  if (recipientIds.length === 0) {
    rejectBroadcast(
      locale,
      "BROADCAST_AUDIENCE_EMPTY",
      "Admin broadcast rejected: resolved cohort is empty",
      emptyMessage
    );
  }
  if (recipientIds.length > BROADCAST_MAX_RECIPIENTS) {
    rejectBroadcast(
      locale,
      "BROADCAST_AUDIENCE_TOO_LARGE",
      "Admin broadcast rejected: resolved cohort exceeds the recipient cap",
      tooLargeMessage
    );
  }
}

export namespace AdminBroadcastService {
  /**
   * Composes one admin broadcast end-to-end and returns the persisted
   * recipient count (the mutation's `Int!`).
   *
   * @param input          Admin-authored copy + closed audience selector;
   *                       mapped field-by-field (never spread) into the
   *                       engine's batch emit.
   * @param actorId        The verified caller (`ctx.user.id` — never input);
   *                       re-verified against a real admin row by the gate.
   * @param locale         Actor locale for localized rejections.
   * @param idempotencyKey Optional gateway-captured compose-session key
   *                       (propagation-only; never logged in raw form).
   * @param options        Injection seam `{ transport?, cache? }` passed
   *                       through to the engine; when omitted entirely the
   *                       production claim-cache default is resolved from
   *                       the environment (undefined cache = the engine's
   *                       documented fail-open posture).
   * @param outerTx        Optional caller-owned transaction (test/journey
   *                       seam). When supplied, reads ride it and the write
   *                       unit opens a SAVEPOINT on it; when absent the
   *                       service opens its own top-level transaction.
   */
  export async function broadcast(
    input: BroadcastNotificationSubmitInput,
    actorId: number,
    locale: string,
    idempotencyKey?: string,
    options?: NotificationEngineCallOptions,
    outerTx?: DBTransaction
  ): Promise<number> {
    const tErrors = getServerTranslations(locale).errorsTranslations;

    // 1. Defense-in-depth admin gate — pre-transaction, zero writes on
    //    denial. The gate logs its own denials; never re-logged here.
    await assertActorAdmin(actorId, locale, outerTx);

    // 2. Pre-DB validation — pure, fail-closed. The title is VALIDATED
    //    (non-empty after trim, within the engine's column ceiling) and
    //    passed through VERBATIM — validation is never transformation.
    const title = input.title;
    if (typeof title !== "string" || title.trim().length === 0 || title.length > TITLE_MAX_LENGTH) {
      rejectBroadcast(
        locale,
        "BROADCAST_TITLE_INVALID",
        "Admin broadcast rejected: title is empty after trim or exceeds the title ceiling",
        tErrors.broadcastTitleInvalid
      );
    }
    const selector = validateAudienceCoherence(input.audience, locale, tErrors.broadcastAudienceInvalid);

    // 3. Cohort resolution — plan existence first on the plan path, then
    //    the governed, de-duplicated, id-ASC cohort. Reads ride the
    //    caller's transaction when one is supplied.
    const recipientIds = await resolveBroadcastRecipients(selector, locale, tErrors.planCatalog.planNotFound, outerTx);

    // 4. Cohort guards — both reject before ANY write.
    assertCohortSize(recipientIds, locale, tErrors.broadcastAudienceEmpty, tErrors.broadcastAudienceTooLarge);

    // Production default: the env-resolved claim cache (undefined stays a
    // valid engine value — its documented fail-open posture).
    const engineOptions: NotificationEngineCallOptions = options ?? { cache: resolveBroadcastClaimCache() };

    // 5. ONE atomic unit: the engine's batch emit (the single notifications
    //    writer) + exactly one audit row. A keyed emit against a live cache
    //    is a REPLAY exactly when the engine returned a stored receipt (no
    //    claim key attached) — replays write zero audit rows.
    const { receipt, isReplay } = await withTransaction(outerTx, async tx => {
      const emitReceipt = await NotificationEngine.emitForUsers(
        {
          userIds: recipientIds,
          type: NotificationType.SystemBroadcast,
          title,
          body: input.body,
          relatedEntityType: null,
          relatedEntityId: null,
          idempotencyKey,
        },
        locale,
        tx,
        engineOptions
      );

      const replayDetected =
        idempotencyKey !== undefined && engineOptions.cache !== undefined && emitReceipt.emitClaimKey === undefined;

      if (!replayDetected) {
        await AuditService.createAuditLog(
          {
            actorId,
            actionType: AuditActionType.Create,
            entityType: AUDIT_ENTITY_TYPE,
            entityId: null,
            details: buildBroadcastAuditDetails(selector, emitReceipt.recipientUserIds.length),
          },
          tx
        );
      }

      return { receipt: emitReceipt, isReplay: replayDetected };
    });

    // 6. Post-commit fan-out — fresh emissions only, strictly after the
    //    unit above resolved successfully (publish-after-commit).
    if (!isReplay) {
      await NotificationEngine.publishReceipts([receipt], locale, engineOptions);
    }

    // 7. The persisted recipient count.
    return receipt.recipientUserIds.length;
  }
}
