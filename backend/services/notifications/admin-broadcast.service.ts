/**
 * AdminBroadcastService — the composition core of the admin broadcast
 * surface. One admin-authored announcement becomes one first-class
 * `broadcasts` header row, one `system_broadcast` notification per resolved
 * recipient (each linked to its header through the related-entity pair),
 * exactly one audit row, and — only after the unit commits — one realtime
 * fan-out envelope carrying the full recipient list.
 *
 * The service is a pure COMPOSITOR: it never writes `notifications` rows
 * itself. The notification engine is consumed by reference (imported, never
 * edited, never bypassed) and remains the single writer of the notifications
 * table; the audience repository resolves recipients; the broadcast
 * repository persists the header; the shared audit writer persists the
 * trail. Every write shares ONE transaction: the header row, the batch
 * insert and the audit row commit or roll back together, and the fan-out
 * publish happens strictly after that commit.
 *
 * Flow (one public send entry point, `broadcast`):
 *  1. Shared admin gate — pre-transaction; both denial flavors write
 *     nothing and are logged by the gate itself (never re-logged here).
 *  2. Pre-DB validation — title bounds plus the audience coherence
 *     matrix (the `admin-broadcast.guards.ts` sibling), fail-closed with
 *     localized, documented error codes.
 *  3. Plan existence (plan cohorts) and cohort resolution through the
 *     audience repository (governance-filtered, de-duplicated, id ASC).
 *     Reads ride the caller's transaction when one is supplied.
 *  4. Empty / oversized cohort guards — both reject before ANY write.
 *  5. ONE transaction: the header row inserted FIRST (its nullable-unique
 *     idempotency key is the DB-durable replay arbiter — a caught 23505
 *     returns the earlier send's persisted count and writes nothing
 *     further), then the engine's batch emit carrying the header linkage,
 *     then exactly one audit row naming the header. An engine-reported
 *     replay after the header insert (a ghost claim residual) rolls the
 *     whole unit back — a header never commits without its notification
 *     rows.
 *  6. Post-commit fan-out publish — fresh emissions only.
 *  7. Return the persisted recipient count.
 *
 * File layout (the notification-engine sibling-module pattern): the
 * audience coherence matrix lives in `admin-broadcast.guards.ts`, the
 * read/stop lifecycle methods (list / detail / stop — surfaced below
 * through thin same-signature delegates so the public namespace API is
 * unchanged) live in `admin-broadcast-lifecycle.service.ts`, and the
 * constants + localized rejection primitive shared across the halves live
 * in `admin-broadcast.service.helpers.ts`.
 *
 * Security posture:
 *  - Input mapping is field-by-field into the engine's batch contract and
 *    the header insert — never a spread — so no transport-smuggled field
 *    can reach persistence.
 *  - The ONLY identity input is the verified actor id (resolved to a real
 *    admin row by the shared gate); recipients are derived server-side
 *    from the audience selector, so there is no per-identity surface.
 *  - Expected rejections log exactly one bounded `logger.logDomainError`
 *    each (code + entity + locale — never copy text, never recipient
 *    lists, never the raw idempotency key); happy paths, including
 *    replays, log NOTHING.
 */
import { BroadcastAudienceRepository, BroadcastRepository, PlanRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  type ValidatedAudienceSelector,
  validateAudienceCoherence,
} from "@/backend/services/notifications/admin-broadcast.guards";
import {
  AUDIT_ENTITY_TYPE,
  BROADCAST_RELATED_ENTITY_TYPE,
  rejectBroadcast,
} from "@/backend/services/notifications/admin-broadcast.service.helpers";
import { AdminBroadcastLifecycleService } from "@/backend/services/notifications/admin-broadcast-lifecycle.service";
import {
  NotificationEngine,
  type NotificationEngineCallOptions,
} from "@/backend/services/notifications/notification-engine.service";
import { resolveBroadcastClaimCache } from "@/backend/services/notifications/redis-claim-cache";
import type {
  AdminBroadcastDetailReturnType,
  AdminBroadcastListFilters,
  AdminBroadcastPageReturnType,
  BroadcastInsertType,
  BroadcastNotificationSubmitInput,
  BroadcastSelectType,
  DBTransaction,
  NotificationDeliveryReceipt,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Hard ceiling on one broadcast's resolved recipient set. A cohort above it
 * is rejected BEFORE any write: the cap keeps the engine's single batch
 * insert well under PostgreSQL's per-statement parameter ceiling and the
 * single fan-out envelope bounded.
 */
export const BROADCAST_MAX_RECIPIENTS = 5000;

/** `notifications.title` column bound (varchar(255)) — mirrors the engine's emit ceiling. */
const TITLE_MAX_LENGTH = 255;

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

/**
 * Builds the `broadcasts` header insert for one accepted broadcast —
 * field-by-field from the validated selector (never a spread of the raw
 * input): the audience snapshot carries EXACTLY the companion its kind
 * requires, the persisted recipient count, the verified sender, and the
 * caller-owned idempotency key (absent keys stay NULL — only key-declaring
 * sends participate in replay dedupe). The header's `body` column is
 * NOT NULL, so an absent long-form copy normalizes to the empty string —
 * the entry contract's non-nullable `body` reflects exactly that.
 */
function buildBroadcastHeaderInsert(
  title: string,
  body: string | null,
  selector: ValidatedAudienceSelector,
  recipientCount: number,
  sentById: number,
  idempotencyKey: string | undefined
): BroadcastInsertType {
  return {
    title,
    body: body ?? "",
    audienceType: selector.type,
    audienceRole: selector.type === BroadcastAudienceType.Role ? selector.role : null,
    audienceCountry: selector.type === BroadcastAudienceType.Country ? selector.country : null,
    audiencePlanId: selector.type === BroadcastAudienceType.Plan ? selector.planId : null,
    recipientCount,
    sentById,
    idempotencyKey,
  };
}

/**
 * The header-insert outcome of one send unit: either the freshly inserted
 * header row, or an idempotent replay of an earlier send (its persisted
 * recipient count is the result to return — nothing further is written).
 */
type HeaderInsertOutcome =
  | { readonly kind: "inserted"; readonly header: BroadcastSelectType }
  | { readonly kind: "replayed"; readonly recipientCount: number };

/**
 * Inserts the header row FIRST inside the caller's transaction and
 * arbitrates the DB-durable replay belt. The header's nullable-unique
 * idempotency key is the race-free replay arbiter: a caught 23505
 * (translated to `ConflictError` by the repository) means the key was
 * committed by a prior send — the earlier header is read back on the SAME
 * transaction and its persisted recipient count returned; nothing further
 * is emitted, audited, or published. A 23505 with NO discoverable header
 * (unreachable by construction — the unique index and the key travel
 * together) rethrows rather than inventing a count.
 *
 * The insert runs in its own nested savepoint so the caught conflict leaves
 * the surrounding transaction usable for the replay read.
 */
async function insertBroadcastHeaderOrReplay(
  insert: BroadcastInsertType,
  idempotencyKey: string | undefined,
  tx: DBTransaction
): Promise<HeaderInsertOutcome> {
  let header: BroadcastSelectType;
  try {
    header = await withTransaction(tx, txArg => BroadcastRepository.create(insert, txArg));
  } catch (error) {
    if (!(error instanceof ConflictError)) {
      throw error;
    }
    if (idempotencyKey === undefined) {
      throw error;
    }
    const existing = await BroadcastRepository.findByIdempotencyKey(idempotencyKey, tx);
    if (existing === null) {
      throw error;
    }
    return { kind: "replayed", recipientCount: existing.recipientCount };
  }
  return { kind: "inserted", header };
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

/** The fully-resolved inputs of one send unit (the transaction body's contract). */
interface BroadcastUnitParams {
  readonly title: string;
  readonly body: string | null;
  readonly selector: ValidatedAudienceSelector;
  readonly recipientIds: readonly number[];
  readonly actorId: number;
  readonly idempotencyKey: string | undefined;
  readonly locale: string;
  readonly engineOptions: NotificationEngineCallOptions;
}

/** The outcome of one send unit: a fresh emission, or an idempotent replay. */
type BroadcastUnitOutcome =
  | { readonly kind: "fresh"; readonly receipt: NotificationDeliveryReceipt }
  | { readonly kind: "replayed"; readonly recipientCount: number };

/**
 * The ONE-transaction body of a send: the header row inserted FIRST (the
 * DB-durable replay arbiter), the engine's batch emit (the single
 * notifications writer) carrying the header linkage, and exactly one audit
 * row naming the header. A keyed emit against a live cache is a REPLAY
 * exactly when the engine returned a stored receipt (no claim key
 * attached) — and a replay reported AFTER the header insert (a ghost claim
 * residual) rolls the whole unit back: a header never commits without its
 * notification rows.
 */
async function composeBroadcastUnit(params: BroadcastUnitParams, tx: DBTransaction): Promise<BroadcastUnitOutcome> {
  const headerInsert = buildBroadcastHeaderInsert(
    params.title,
    params.body,
    params.selector,
    params.recipientIds.length,
    params.actorId,
    params.idempotencyKey
  );

  const headerOutcome = await insertBroadcastHeaderOrReplay(headerInsert, params.idempotencyKey, tx);
  if (headerOutcome.kind === "replayed") {
    return { kind: "replayed", recipientCount: headerOutcome.recipientCount };
  }

  const emitReceipt = await NotificationEngine.emitForUsers(
    {
      userIds: [...params.recipientIds],
      type: NotificationType.SystemBroadcast,
      title: params.title,
      body: params.body,
      relatedEntityType: BROADCAST_RELATED_ENTITY_TYPE,
      relatedEntityId: headerOutcome.header.id,
      idempotencyKey: params.idempotencyKey,
    },
    params.locale,
    tx,
    params.engineOptions
  );

  const replayDetected =
    params.idempotencyKey !== undefined &&
    params.engineOptions.cache !== undefined &&
    emitReceipt.emitClaimKey === undefined;

  if (replayDetected) {
    logger.logDomainError("Admin broadcast rejected: engine replayed after the header insert (ghost claim residual)", {
      code: "BROADCAST_GHOST_CLAIM",
      entity: "notifications",
      locale: params.locale,
    });
    const tErrors = getServerTranslations(params.locale).errorsTranslations;
    throw new ConflictError("BROADCAST_GHOST_CLAIM", tErrors.broadcastGhostClaim);
  }

  await AuditService.createAuditLog(
    {
      actorId: params.actorId,
      actionType: AuditActionType.Create,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: headerOutcome.header.id,
      details: buildBroadcastAuditDetails(params.selector, emitReceipt.recipientUserIds.length),
    },
    tx
  );

  return { kind: "fresh", receipt: emitReceipt };
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

    // 5. The ONE atomic unit (header row, batch emit, audit row), then the
    //    post-commit fan-out for fresh emissions only.
    const outcome = await withTransaction(outerTx, tx =>
      composeBroadcastUnit(
        {
          title,
          body: input.body,
          selector,
          recipientIds,
          actorId,
          idempotencyKey,
          locale,
          engineOptions,
        },
        tx
      )
    );

    if (outcome.kind === "replayed") {
      return outcome.recipientCount;
    }
    await NotificationEngine.publishReceipts([outcome.receipt], locale, engineOptions);
    return outcome.receipt.recipientUserIds.length;
  }

  /**
   * Lists one page of the broadcast history, newest-first, behind the
   * shared admin gate — thin delegate to the lifecycle sibling module.
   * Contract: `admin-broadcast-lifecycle.service.ts` (`listBroadcasts`).
   */
  export async function listBroadcasts(
    filters: AdminBroadcastListFilters,
    page: number,
    pageSize: number | undefined,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminBroadcastPageReturnType> {
    return AdminBroadcastLifecycleService.listBroadcasts(filters, page, pageSize, actorId, locale, outerTx);
  }

  /**
   * Resolves the detail view payload for one broadcast (entry + live
   * delivered/read aggregates) — thin delegate to the lifecycle sibling
   * module. Contract: `admin-broadcast-lifecycle.service.ts`
   * (`broadcastDetail`).
   */
  export async function broadcastDetail(
    broadcastId: number,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminBroadcastDetailReturnType> {
    return AdminBroadcastLifecycleService.broadcastDetail(broadcastId, actorId, locale, outerTx);
  }

  /**
   * Stops an ACTIVE broadcast (one-way CAS transition, engine-mediated
   * recipient retraction, one Suspend audit row) — thin delegate to the
   * lifecycle sibling module. Contract: `admin-broadcast-lifecycle.service.ts`
   * (`stopBroadcast`).
   */
  export async function stopBroadcast(
    broadcastId: number,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<number> {
    return AdminBroadcastLifecycleService.stopBroadcast(broadcastId, actorId, locale, outerTx);
  }
}
