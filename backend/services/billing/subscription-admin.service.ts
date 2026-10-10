/**
 * SubscriptionAdminService — admin-gated lifecycle operations on the
 * `subscriptions` root (the four admin lifecycle flows — extend, renew,
 * cancel, change plan — plus the admin read share this namespace).
 *
 * Every mutation mirrors the shipped billing admin surface: the acting
 * admin's id is a required parameter that is re-asserted against the
 * `users` table (defense in depth behind the GraphQL role scope) BEFORE
 * any write, the guarded single-statement transition plus its exactly-one
 * audit row share ONE `withTransaction` block (a rolled-back mutation
 * leaves no window shift and no audit row), and denials emit one bounded
 * `logger.logDomainError` with ids only — never student-identifying
 * data.
 *
 * Extend semantics: the new window end is computed SERVER-SIDE from the
 * row's stored `endDate` (a client can never dictate a target date).
 * Genuinely new extensions stack legitimately — each call re-reads the
 * row and extends from its current window — while an identical replay
 * that lost the guarded race surfaces an idempotent conflict instead of
 * a second shift.
 *
 * Renew semantics: the source row must be `expired` — the expiry sweep
 * owns the active → expired transition, so renewal is the recovery path
 * for a lapsed period (an active row takes extend; a pending row is
 * payment-owned). A fresh plan read supplies the period arithmetic and
 * the credit lane (fail-closed when the lane is not configured), the new
 * row opens at the renewal instant, and the owner's lane is credited the
 * plan's full session count. The idempotency claim
 * `subscription-admin:renew:<sourceId>` (minted under the reserved
 * server-owned namespace the purchase boundary refuses to carry) is
 * inserted before any result write — the flow's atomicity point: a
 * duplicate renew replays the first result through the claim's
 * subscription pointer instead of creating a second period, while a
 * committed claim that cannot resolve to a same-owner row (its result
 * row was deleted — the set-null FK) surfaces the localized
 * already-renewed conflict.
 *
 * Cancel semantics: the source row must be `active`, and the flip is
 * BALANCE-PRESERVING — no lane balance column is read or written anywhere
 * in the flow (deliberately asymmetric with the expiry sweep, which
 * zeroes). The optional free-text reason is the audit trail's only free
 * text: trimmed and bounded server-side before anything else runs. A
 * zero-row guarded flip is disambiguated by a fresh read — an
 * already-cancelled row is the idempotent replay conflict, a vanished row
 * the canonical not-found denial, any other state the localized
 * active-only deny.
 *
 * Plan-change semantics: the source row must be `active` and its TARGET
 * plan active, different, and same-lane (cross-lane migration is out of
 * scope). The proration is computed in exact BigInt minor units from the
 * student's CURRENT lane balance for the old lane (read under the owner
 * row's `FOR UPDATE` lock so the read→settle pair serializes with
 * concurrent lane debits). The
 * `subscription-admin:planChange:<sourceId>:<targetPlanId>` claim is the
 * flow's atomicity point — a duplicate REPLAYS the first
 * result — and the winning path flips the old row to `cancelled` through
 * the guarded transition, settles the owner's lane to the prepared exact
 * total (the target plan's full session count plus the computed carry on
 * the upgrade leg; the downgrade forfeits the remainder), opens the fresh
 * period, and writes exactly ONE `Override` audit row on the NEW row.
 *
 * List semantics: the admin read surface is READ-ONLY — one owner-scoped
 * query (`user_id` = the addressed id, newest first by the repository's
 * own `created_at DESC` ordering) mapped onto the canonical ReturnType,
 * followed by ONE page-level enrichment pass (`enrichSubscriptionRows`)
 * that attaches each row's plan, audit-entry count, and audit-trail peek
 * in ≤3 batch queries for the whole page; no writes, no audit rows. The
 * acting admin is re-asserted against the
 * `users` table BEFORE any read (defense in depth behind the GraphQL
 * role scope — zero reads on denial), the owner id is re-validated
 * through the strict numeric coercion (a malformed id is the canonical
 * localized VALIDATION denial, never a silent mis-target), and a
 * well-formed but unknown id is the indistinguishable empty list.
 */

import { AuditTrailRepository } from "@/backend/db/repo/audit/audit-trail.repository";
import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { SubscriptionPurchaseIdempotencyRepository } from "@/backend/db/repo/billing/subscription-purchase-idempotency.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, isPgUniqueViolation, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { MAX_INTERVAL_DAYS } from "@/backend/services/billing/plan-catalog.helpers";
import {
  buildSubscriptionAuditContract,
  MS_PER_DAY,
  normalizeCancelReason,
  readRenewalPlan,
  renewClaimKey,
  resolveCancelDenial,
  resolveRenewalReplayRow,
  SUBSCRIPTION_AUDIT_ENTITY_TYPE,
  toSubscriptionAdminDomainError,
  toSubscriptionAdminReturnType,
} from "@/backend/services/billing/subscription-admin.helpers";
import {
  AUDIT_ACTION_TYPE_MEMBER_BY_RAW,
  coerceUserId,
  enrichSubscriptionRows as enrichSubscriptionRowsImpl,
  subscriptionAuditEntriesCountBatch,
  subscriptionAuditTrailPeekBatch,
} from "@/backend/services/billing/subscription-admin-read.helpers";
import {
  insertRenewedSubscription,
  settleRenewalSideEffects,
} from "@/backend/services/billing/subscription-admin-settle.helpers";
import { changeSubscriptionPlanFlow } from "@/backend/services/billing/subscription-plan-change.helpers";
import type {
  CancelSubscriptionSubmitInput,
  ChangeSubscriptionPlanResult,
  ChangeSubscriptionPlanSubmitInput,
  DBQueryExecutor,
  DBTransaction,
  EnrichedSubscriptionReturnType,
  ExtendSubscriptionSubmitInput,
  RenewSubscriptionSubmitInput,
  SubscriptionAuditTrailPeek,
  SubscriptionPurchaseIdempotencySelectType,
  SubscriptionReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The active-status member, widened to a plain string: the read row's
 * `status` column is the raw pg-enum string union, so the guard compares
 * against the enum member's string identity — the vocabulary flows from
 * the enum, never from a bare literal (the session-lifecycle guard
 * idiom).
 */
const STATUS_ACTIVE: string = SubscriptionStatus.Active;

/**
 * The expired-status member, widened to a plain string: the same
 * read-row guard idiom as the active-status twin — renew is the
 * sweep-owned `expired` state's only writer recovery path.
 */
const STATUS_EXPIRED: string = SubscriptionStatus.Expired;

export namespace SubscriptionAdminService {
  /**
   * Extends an `active` subscription's validity window by a whole number
   * of days.
   *
   * Fail-closed sequence: the day count is validated pre-DB, the admin
   * gate re-asserts the actor's role with zero writes on denial, and one
   * transaction owns the locking read (`findByIdForUpdate` — the audit
   * pre-image's serialization), the guarded `extendActiveOnce` transition,
   * and the exactly-one audit row (`Update` on the `subscription` entity,
   * details `{ previousEndDate, newEndDate, addedDays }` — ISO strings
   * and an integer only). A row that is missing, not `active`, or
   * windowless denies with the localized active-only conflict; an
   * extension that would push the resulting validity window past the
   * catalog's interval ceiling denies with the localized validation
   * reject; a replay that lost the guarded race (the window moved
   * between this transaction's read and its write) surfaces the
   * idempotent conflict and mints nothing.
   *
   * @param input  The validated submit payload (subscription id + day
   *     count); the id arrives pre-coerced through the strict numeric
   *     parse, the day count is re-validated here.
   * @param actorId  The acting admin's user id (never client input).
   * @param locale  Locale for the localized denial messages.
   * @param tx  Optional caller transaction to join (test path:
   *     SAVEPOINT) — the whole flow participates in the caller's unit.
   * @returns The extended row in its canonical read shape.
   */
  export async function extendSubscription(
    input: ExtendSubscriptionSubmitInput,
    actorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<SubscriptionReturnType> {
    const tErrors = getServerTranslations(locale).errorsTranslations;

    // Pre-DB input validation — a fractional or non-positive day count is
    // a caller bug, never a database matter. Whole days only: the window
    // arithmetic multiplies this value into Date milliseconds.
    if (!Number.isInteger(input.days) || input.days < 1) {
      logger.logDomainError("Subscription extend denied: day count is not a positive whole number", {
        code: "VALIDATION",
        entity: "subscriptions",
        entityId: input.subscriptionId,
      });
      throw new ValidationError(tErrors.badRequest);
    }

    // Pre-arithmetic bounds — the window math multiplies this value into
    // Date milliseconds, so a count already past the catalog's interval
    // ceiling is rejected BEFORE the arithmetic (the integer gate above
    // already rejected every non-finite value — `Number.isInteger` is
    // false for NaN/±Infinity — so only the ceiling remains here; the
    // resulting-window guard below re-asserts the ceiling against the
    // row's actual anchor).
    if (input.days > MAX_INTERVAL_DAYS) {
      logger.logDomainError("Subscription extend denied: day count exceeds the interval ceiling", {
        code: "VALIDATION",
        entity: "subscriptions",
        entityId: input.subscriptionId,
      });
      throw new ValidationError(tErrors.subscriptionAdmin.prorationOverflow);
    }

    // Defense-in-depth BFLA gate — zero writes, zero audit rows on denial.
    await assertActorAdmin(actorId, locale, tx);

    try {
      return await withTransaction(tx, async scopedTx => {
        // The opening read takes the row's FOR UPDATE lock (held to the
        // transaction's end), so concurrent extends serialize read→write:
        // the audit's `previousEndDate` below is always the TRUE pre-image
        // of the winning write, never a stale READ COMMITTED snapshot.
        const subscription = await SubscriptionRepository.findByIdForUpdate(input.subscriptionId, scopedTx);
        if (subscription?.status !== STATUS_ACTIVE || subscription.endDate === null) {
          logger.logDomainError("Subscription extend denied: row missing, not active, or windowless", {
            code: "CONFLICT",
            entity: "subscriptions",
            entityId: input.subscriptionId,
          });
          throw new ConflictError(tErrors.subscriptionAdmin.notActive);
        }

        const previousEndDate = subscription.endDate;
        const newEndDate = new Date(previousEndDate.getTime() + input.days * MS_PER_DAY);

        // The resulting validity window stays inside the catalog's interval
        // ceiling, measured from the period's start (a legacy row without a
        // start stamp is measured from its current window end so the guard
        // can never silently pass an unbounded extension).
        const windowAnchor = subscription.startDate ?? previousEndDate;
        if (newEndDate.getTime() - windowAnchor.getTime() > MAX_INTERVAL_DAYS * MS_PER_DAY) {
          logger.logDomainError("Subscription extend denied: resulting window exceeds the interval ceiling", {
            code: "VALIDATION",
            entity: "subscriptions",
            entityId: input.subscriptionId,
          });
          throw new ValidationError(tErrors.subscriptionAdmin.prorationOverflow);
        }

        // The guarded single UPDATE is the write decision: its WHERE
        // predicate re-asserts `active` AND the read window end as the
        // fail-closed backstop behind the locking read — any caller whose
        // target was computed from a superseded window (or whose row has
        // since left `active`) matches zero rows here instead of shifting
        // the window twice.
        const extended = await SubscriptionRepository.extendActiveOnce(
          subscription.id,
          { previousEndDate, newEndDate },
          scopedTx
        );
        if (extended === null) {
          logger.logDomainError("Subscription extend denied: window moved concurrently (replay)", {
            code: "CONFLICT",
            entity: "subscriptions",
            entityId: subscription.id,
          });
          throw new ConflictError(tErrors.conflict);
        }

        await AuditService.createAuditLog(
          buildSubscriptionAuditContract(actorId, AuditActionType.Update, subscription.id, {
            previousEndDate: previousEndDate.toISOString(),
            newEndDate: newEndDate.toISOString(),
            addedDays: input.days,
          }),
          scopedTx
        );

        return toSubscriptionAdminReturnType(extended, tErrors);
      });
    } catch (error: unknown) {
      throw toSubscriptionAdminDomainError(error, tErrors);
    }
  }

  /**
   * Renews an `expired` subscription into a fresh active period.
   *
   * Fail-closed sequence: the admin gate re-asserts the actor's role
   * with zero writes on denial, the source row must exist and be
   * `expired` (the expiry sweep owns the active → expired transition —
   * active rows take extend, pending rows are payment-owned), and the
   * idempotency claim `renew:<sourceId>` is inserted inside the flow's
   * transaction BEFORE any result write, making the claim insert the
   * atomicity point for the whole renewal. A duplicate claim (23505)
   * resolves to a REPLAY: the claim's subscription pointer is loaded and
   * returned as the first result — no second period, no second credit,
   * no audit row. A committed claim that cannot resolve to a same-owner
   * row surfaces the localized already-renewed conflict instead. On the
   * winning path the fresh plan read supplies the period arithmetic and
   * the credit lane (fail-closed when the lane is not configured — the
   * transaction rolls the claim back with it), the fresh period + lane
   * credit + junction row + claim backfill commit together, and exactly
   * ONE audit row (`Create` on the `subscription` entity, details
   * `{ renewedFromSubscriptionId, planId, creditedSessions,
   * intervalDays }` — ids and integers only) shares the transaction's
   * fate.
   *
   * @param input  The validated submit payload (subscription id); the id
   *     arrives pre-coerced through the strict numeric parse.
   * @param actorId  The acting admin's user id (never client input).
   * @param locale  Locale for the localized denial messages.
   * @param tx  Optional caller transaction to join (test path:
   *     SAVEPOINT) — the whole flow participates in the caller's unit.
   * @returns The renewed row (or, on a replay, the first renewal's row)
   *     in its canonical read shape.
   */
  export async function renewSubscription(
    input: RenewSubscriptionSubmitInput,
    actorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<SubscriptionReturnType> {
    const tErrors = getServerTranslations(locale).errorsTranslations;

    // Defense-in-depth BFLA gate — zero writes, zero audit rows on denial.
    await assertActorAdmin(actorId, locale, tx);

    try {
      return await withTransaction(tx, async scopedTx => {
        // The source row is the renewal's premise: it must exist and be
        // `expired`. The status comparison rides the enum member's string
        // identity — never a bare literal.
        const source = await SubscriptionRepository.findById(input.subscriptionId, scopedTx);
        if (source?.status !== STATUS_EXPIRED) {
          logger.logDomainError("Subscription renew denied: source row missing or not expired", {
            code: "CONFLICT",
            entity: "subscriptions",
            entityId: input.subscriptionId,
          });
          throw new ConflictError(tErrors.subscriptionAdmin.notExpired);
        }

        // The idempotency claim — savepoint-bracketed so a duplicate key
        // poisons only the savepoint, keeping this transaction readable
        // for the replay lookup (the purchase flow's claim idiom). The
        // key is SERVER-CONSTRUCTED under the reserved `subscription-admin:`
        // namespace from the source row's id — the caller never supplies
        // claim material on this surface, and the purchase boundary
        // rejects client keys under the same prefix (no squatting).
        const claimKey = renewClaimKey(source.id);
        let claim: SubscriptionPurchaseIdempotencySelectType;
        try {
          claim = await scopedTx.transaction(claimTx =>
            SubscriptionPurchaseIdempotencyRepository.insertClaim(
              { idempotencyKey: claimKey, userId: source.userId },
              claimTx
            )
          );
        } catch (error: unknown) {
          if (!isPgUniqueViolation(error)) {
            throw error;
          }
          return toSubscriptionAdminReturnType(await resolveRenewalReplayRow(source, scopedTx, tErrors), tErrors);
        }

        const { plan, lane } = await readRenewalPlan(source, scopedTx, tErrors);

        const created = await insertRenewedSubscription(source, plan, scopedTx);
        await settleRenewalSideEffects(source, lane, plan.sessionCount, created, claim.id, tErrors, scopedTx);

        await AuditService.createAuditLog(
          buildSubscriptionAuditContract(actorId, AuditActionType.Create, created.id, {
            renewedFromSubscriptionId: source.id,
            planId: source.planId,
            creditedSessions: plan.sessionCount,
            intervalDays: plan.intervalDays,
          }),
          scopedTx
        );

        return toSubscriptionAdminReturnType(created, tErrors);
      });
    } catch (error: unknown) {
      throw toSubscriptionAdminDomainError(error, tErrors);
    }
  }

  /**
   * Cancels an `active` subscription WITHOUT touching any lane balance —
   * the balance-preserving deny path (deliberately asymmetric with the
   * expiry sweep, which zeroes).
   *
   * Fail-closed sequence: the optional free-text reason is trimmed and
   * length-bounded pre-DB (it reaches the audit trail only inside the
   * bound, and never enters a diagnostic log), the admin gate re-asserts
   * the actor's role with zero writes on denial, and one transaction owns
   * the guarded `cancelActiveOnce` transition plus the exactly-one audit
   * row (`Suspend` on the `subscription` entity, details
   * `{ fromStatus, toStatus, reason? }` — the reason is omitted entirely
   * when not supplied). A zero-row guarded write is disambiguated by a
   * fresh read on the same executor: a missing row denies with the
   * canonical not-found error, an already-cancelled row surfaces the
   * idempotent replay conflict (no second write, no second audit row),
   * and any other state denies with the localized active-only conflict —
   * all with zero writes. The guard lives entirely inside the UPDATE's
   * WHERE (no read-then-write premise): the disambiguation read runs only
   * after the write has already failed.
   *
   * @param input  The validated submit payload (subscription id + the
   *     optional reason); the id arrives pre-coerced through the strict
   *     numeric parse.
   * @param actorId  The acting admin's user id (never client input).
   * @param locale  Locale for the localized denial messages.
   * @param tx  Optional caller transaction to join (test path:
   *     SAVEPOINT) — the whole flow participates in the caller's unit.
   * @returns The cancelled row in its canonical read shape.
   */
  export async function cancelSubscription(
    input: CancelSubscriptionSubmitInput,
    actorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<SubscriptionReturnType> {
    const tErrors = getServerTranslations(locale).errorsTranslations;

    // Pre-DB input validation — the optional reason is normalized before
    // the gate or any write, so an overlong submit costs zero reads.
    const reason = normalizeCancelReason(input.reason, input.subscriptionId, tErrors);

    // Defense-in-depth BFLA gate — zero writes, zero audit rows on denial.
    await assertActorAdmin(actorId, locale, tx);

    try {
      return await withTransaction(tx, async scopedTx => {
        // The guarded single UPDATE is the write decision: its WHERE
        // predicate re-asserts `active` under the row lock, so a
        // concurrent writer (extend, plan change, sweep) or an identical
        // double-submit matches zero rows instead of flipping twice. The
        // statement patches ONLY status + updated_at — no lane balance
        // column exists anywhere in this flow.
        const cancelled = await SubscriptionRepository.cancelActiveOnce(input.subscriptionId, scopedTx);
        if (cancelled === null) {
          // Zero rows = replay, wrong state, or a missing row — the fresh
          // read disambiguates and the chosen denial mints nothing.
          const current = await SubscriptionRepository.findById(input.subscriptionId, scopedTx);
          resolveCancelDenial(input.subscriptionId, current, tErrors, "cancel");
        }

        // Exactly ONE audit row shares the transaction's fate. The
        // from/to statuses flow from the enum members (the guard pins the
        // from side); the reason is the trail's only free text.
        const auditDetails: Record<string, unknown> = {
          fromStatus: SubscriptionStatus.Active,
          toStatus: SubscriptionStatus.Cancelled,
        };
        if (reason !== undefined) {
          auditDetails.reason = reason;
        }
        await AuditService.createAuditLog(
          buildSubscriptionAuditContract(actorId, AuditActionType.Suspend, cancelled.id, auditDetails),
          scopedTx
        );

        return toSubscriptionAdminReturnType(cancelled, tErrors);
      });
    } catch (error: unknown) {
      throw toSubscriptionAdminDomainError(error, tErrors);
    }
  }

  /**
   * Changes an `active` subscription onto a different ACTIVE plan in the
   * SAME balance lane, with prorated balance settlement.
   *
   * Delegates to the plan-change flow module (the sibling-helpers split —
   * this namespace stays within its file budget): the flow module's
   * docblock carries the full semantics. In brief: the admin gate
   * re-asserts the actor's role with zero writes on denial; the source
   * row + plan pair is read in one round-trip behind the `active`
   * predicate (a missing / cancelled / moved-on row denies through the
   * guarded-cancel disambiguation ladder); the TARGET plan must be
   * active, different, and same-lane; the proration is computed in exact
   * BigInt minor units from the student's CURRENT lane balance read
   * inside the transaction; the
   * `subscription-admin:planChange:<sourceId>:<targetPlanId>` claim is
   * the flow's atomicity point (a duplicate REPLAYS the first
   * result through its subscription pointer); and the winning path flips
   * the old row to `cancelled` (guarded), settles the owner's lane to the
   * prepared exact total, opens the fresh period on the target plan,
   * inserts the junction row, backfills the claim, and writes exactly ONE
   * `Override` audit row on the NEW row — all sharing the transaction's
   * fate.
   *
   * @param input  The validated submit payload (subscription id + target
   *     plan id); both ids arrive pre-coerced through the strict numeric
   *     parses.
   * @param actorId  The acting admin's user id (never client input).
   * @param locale  Locale for the localized denial messages.
   * @param tx  Optional caller transaction to join (test path:
   *     SAVEPOINT) — the whole flow participates in the caller's unit.
   * @returns The NEW row (or, on a replay, the first change's row) in its
   *     canonical read shape plus the applied proration settlement (the
   *     plan-pair direction and this call's carry/forfeit — zeros on a
   *     replay, which moved nothing).
   */
  export async function changeSubscriptionPlan(
    input: ChangeSubscriptionPlanSubmitInput,
    actorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<ChangeSubscriptionPlanResult> {
    return changeSubscriptionPlanFlow(input, actorId, locale, tx);
  }

  /**
   * Lists one student-owner's subscriptions for the admin read surface —
   * READ-ONLY: no writes, no audit rows, one owner-scoped query followed by
   * ONE page-level enrichment pass.
   *
   * Fail-closed sequence: the admin gate re-asserts the actor's role
   * BEFORE any read (the GraphQL scope already enforced admin-only — the
   * gate is the defense in depth; a denial costs zero target reads and
   * zero audit rows), the owner id is re-validated through the strict
   * numeric coercion (the wire string was already decimal-coerced at the
   * resolver boundary through the same helper; direct service callers —
   * SSR, sibling services — bypass the resolver, so the boundary never
   * trusts its numeric parameter), and the read delegates to the
   * repository's owner-scoped listing: the `user_id` predicate IS the
   * BOLA boundary (only the addressed owner's rows come back — a
   * well-formed but unknown id is the indistinguishable empty list),
   * newest first by the repository's own `created_at DESC` ordering,
   * mapped onto the canonical ReturnType through the shared fail-closed
   * enum certification. The enrichment pass then attaches each row's
   * plan, audit-entry count, and audit-trail peek in ≤3 extra batch
   * queries for the WHOLE page (`enrichSubscriptionRows` — the ids it
   * batches come only from the already-authorized page rows).
   *
   * @param userId  The addressed student-owner's user id (the only
   *     client material on this surface).
   * @param actorId  The acting admin's user id (never client input).
   * @param locale  Locale for the localized denial messages.
   * @param tx  Optional caller transaction to join (test path:
   *     SAVEPOINT) — the gate's actor read, the owner-scoped read, and
   *     the plan batch share the caller's unit so they observe one
   *     snapshot (the audit batches are bare pool reads, exactly like
   *     their single-row twins).
   * @returns The owner's enriched rows, newest first; empty when the
   *     owner has none.
   */
  export async function listForAdmin(
    userId: number,
    actorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<EnrichedSubscriptionReturnType[]> {
    const tErrors = getServerTranslations(locale).errorsTranslations;

    // Defense-in-depth BFLA gate — re-asserts the actor's role BEFORE
    // any read, joining the caller's transaction when one is supplied so
    // the gate and the read observe the same snapshot.
    await assertActorAdmin(actorId, locale, tx);

    // Strict owner-id validation — a malformed id is the canonical
    // localized VALIDATION denial, never a 500.
    const ownerId = coerceUserId(userId, tErrors);

    const rows = await SubscriptionRepository.listByUserId(ownerId, tx);
    return enrichSubscriptionRows(
      rows.map(row => toSubscriptionAdminReturnType(row, tErrors)),
      locale,
      tx
    );
  }

  /**
   * The audit-trail entry count for ONE subscription — the admin drawer's
   * per-row trail-depth badge. A read-only delegation to the audit
   * repository's join-free count, keyed by the SAME canonical
   * `entity_type` label the admin mutation flows mint (`"subscription"`),
   * so the badge can never disagree with the trail the deep link opens.
   * A subscription with no entries answers the honest `0` (never an
   * error, never clamped) — the same contract as the trail's own count
   * surface.
   *
   * @param subscriptionId  The subscription row's id (the audit rows'
   *     entity id — int4-bounded by the column, no coercion needed).
   * @returns How many audit entries the trail holds for the row.
   */
  export async function auditEntriesCount(subscriptionId: number): Promise<number> {
    return AuditTrailRepository.countEntries({
      entityType: SUBSCRIPTION_AUDIT_ENTITY_TYPE,
      entityId: subscriptionId,
    });
  }

  /**
   * The subscription's trail TEASER — the most recent audit entry's
   * canonical action type + instant, or `null` when the trail holds no
   * entries for the row. One `limit: 1` repository read (the trail's own
   * `created_at DESC, id DESC` ordering guarantees the newest entry),
   * keyed by the SAME canonical entity-type label as the count above.
   *
   * The raw `action_type` column is certified fail-closed against the
   * canonical enum member set (the audit-trail service's own membership
   * re-assertion pattern): the trail only ever mints canonical members,
   * so an uncertifiable literal would mean data corruption — it surfaces
   * as the honest `null` (never a junk value on the wire) plus one
   * bounded ids-only domain log.
   *
   * @param subscriptionId  The subscription row's id (the audit rows'
   *     entity id).
   * @returns The newest peek, or `null` for a row with no history.
   */
  export async function auditTrailPeek(subscriptionId: number): Promise<SubscriptionAuditTrailPeek | null> {
    const rows = await AuditTrailRepository.listEntries(
      {
        entityType: SUBSCRIPTION_AUDIT_ENTITY_TYPE,
        entityId: subscriptionId,
      },
      1,
      0
    );
    const newest = rows[0];
    if (!newest) {
      return null;
    }
    // Membership re-assertion through the shared RAW-STRING-keyed member
    // map — an unverified literal stays the honest `undefined`.
    const certified = AUDIT_ACTION_TYPE_MEMBER_BY_RAW[newest.actionType];
    if (certified === undefined) {
      logger.logDomainError("Subscription audit peek withheld: uncertifiable action type in the trail", {
        code: "VALIDATION",
        subscriptionId,
        auditLogId: newest.id,
      });
      return null;
    }
    return { actionType: certified, at: newest.createdAt };
  }

  /**
   * The audit-trail entry counts for a PAGE of subscriptions — the batch
   * twin of `auditEntriesCount`. One grouped repository read resolves every
   * requested row's count, keyed by the SAME canonical `entity_type` label
   * the single-row method and every admin mutation flow mint, so a page's
   * badges can never disagree with the trail the drawer opens. Every
   * distinct requested id gets a map entry; a row with no entries answers
   * the honest `0` (never an error, never clamped).
   *
   * @param subscriptionIds  The page's subscription ids — ids already
   *     present on caller-authorized rows, never client-supplied
   *     identifiers.
   * @returns One count per distinct requested id.
   */
  export async function auditEntriesCountBatch(subscriptionIds: readonly number[]): Promise<Map<number, number>> {
    return subscriptionAuditEntriesCountBatch(subscriptionIds);
  }

  /**
   * The trail TEASERS for a PAGE of subscriptions — the batch twin of
   * `auditTrailPeek`. One `DISTINCT ON` repository read resolves every
   * requested row's most recent entry (the same `created_at DESC, id DESC`
   * "latest" the single-row peek reads, so the two can never disagree),
   * and each raw row is certified fail-closed against the canonical enum
   * member set exactly like the single-row peek: an uncertifiable literal
   * would mean data corruption — it surfaces as the honest `null` (never
   * a junk value on the wire) plus one bounded ids-only domain log. A row
   * with no history answers `null`.
   *
   * @param subscriptionIds  The page's subscription ids — ids already
   *     present on caller-authorized rows, never client-supplied
   *     identifiers.
   * @returns One peek (or the honest `null`) per distinct requested id.
   */
  export async function auditTrailPeekBatch(
    subscriptionIds: readonly number[]
  ): Promise<Map<number, SubscriptionAuditTrailPeek | null>> {
    return subscriptionAuditTrailPeekBatch(subscriptionIds);
  }

  /**
   * Page-level enrichment for subscription list rows — ONE batch pass per
   * page: the page's DISTINCT plan ids go to one plan batch, and the page
   * row ids go to one audit-count batch plus one audit-peek batch — ≤3
   * extra queries for the whole page regardless of page size. Both list
   * producers (`listForAdmin` here, `SubscriptionPurchaseService.listOwn`)
   * route through this single pass so every `StudentSubscription` row
   * carries its `plan`, `auditEntriesCount`, and `auditTrailPeek` before
   * the field resolvers run.
   *
   * The batch ids come ONLY from rows the caller was already authorized
   * to read (no client-supplied id enters any batch), an empty page
   * enriches nothing (zero batch reads), and the three batch reads run
   * SEQUENTIALLY so a caller-supplied transaction client never pipelines
   * concurrent statements. The plan batch joins the caller's transaction
   * when one is supplied; the audit batches are bare pool reads, exactly
   * like their single-row twins (the enrichment reads plan/audit rows
   * AFTER the page rows are fetched — a benign read-read window, its
   * staleness bounded by the page query itself). Rows are enriched onto
   * COPIES via `Object.assign` — the source rows are never mutated, and a
   * missing plan enriches the honest `null` value, never an absent key.
   *
   * @param rows  The already-authorized, already-mapped page rows.
   * @param locale  Optional request locale (tolerated by the plan batch
   *     for symmetry with the producers' signatures).
   * @param tx  Optional transaction or query executor — propagated to
   *     the plan batch so a caller-owned atomic flow stays atomic.
   * @returns The enriched row copies, in the caller's order.
   */
  export async function enrichSubscriptionRows(
    rows: readonly SubscriptionReturnType[],
    locale?: string,
    tx?: DBQueryExecutor
  ): Promise<EnrichedSubscriptionReturnType[]> {
    return enrichSubscriptionRowsImpl(rows, locale, tx);
  }
}
