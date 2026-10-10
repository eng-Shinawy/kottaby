/**
 * SubscriptionAdmin read-surface helpers — the admin list flow's shared
 * runtime pieces (the sibling-helpers split keeps the service namespace
 * and the write-flow helpers file within their line budgets).
 *
 * Runtime only — no types are declared here; every shape lives in
 * `backend/types/` and is imported through `@/backend/types`.
 *
 * The page-level enrichment pass lives here because BOTH subscription
 * list producers consume it (`SubscriptionAdminService.listForAdmin` and
 * `SubscriptionPurchaseService.listOwn` — the latter through the
 * service's `enrichSubscriptionRows` delegation): ONE batch pass per
 * page replaces the per-row plan/count/peek reads, so a page costs a
 * constant number of queries regardless of its size.
 */

import { AuditTrailRepository } from "@/backend/db/repo/audit/audit-trail.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { MAX_INT4, SUBSCRIPTION_AUDIT_ENTITY_TYPE } from "@/backend/services/billing/subscription-admin.helpers";
import type {
  DBQueryExecutor,
  EnrichedSubscriptionReturnType,
  SubscriptionAuditTrailPeek,
  SubscriptionReturnType,
} from "@/backend/types";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * RAW-STRING-keyed member map for the `action_type` column's fail-closed
 * certification: the audit trail's `actionType` is a raw DB column (a
 * plain string), so the canonical member resolves by MAP LOOKUP — no
 * enum-to-string comparison, no type assertion, and an unverified literal
 * stays the honest `undefined` (each peek reader withholds it as `null`).
 */
export const AUDIT_ACTION_TYPE_MEMBER_BY_RAW: Readonly<Record<string, AuditActionType | undefined>> =
  Object.fromEntries(Object.values(AuditActionType).map(member => [member, member] as const));

/**
 * Coerces a wire `ID` into a STUDENT-OWNER user id for the admin read
 * surface (`adminStudentSubscriptions`). The strictness goes one notch
 * beyond the subscription-id twin: GraphQL preserves `ID` as a string,
 * and `Number()` lazily coerces non-decimal syntax ("1e0", "0x1", " 1")
 * into a valid integer — silently addressing a DIFFERENT owner than the
 * one named on the wire — so a string is accepted only in canonical
 * decimal form (the resolver-guard module's documented wire-id
 * discipline), while numeric input (direct service callers) must already
 * be a positive safe integer inside the int4 id range (`MAX_INT4` — the
 * column can never hold a larger value). Any malformed value maps onto
 * the canonical localized VALIDATION denial — never a silent mis-target,
 * never a 500.
 */
export function coerceUserId(rawId: string | number, tErrors: ErrorsLabels): number {
  let id: number;
  if (typeof rawId === "number") {
    id = rawId;
  } else if (/^[1-9]\d*$/.test(rawId)) {
    id = Number(rawId);
  } else {
    id = Number.NaN;
  }
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_INT4) {
    logger.logDomainError("Subscription admin list denied: user id failed strict numeric coercion", {
      code: "VALIDATION",
      entity: "user",
    });
    throw new ValidationError(tErrors.badRequest);
  }
  return id;
}

/**
 * The audit-trail entry counts for a PAGE of subscriptions — one grouped
 * repository read resolves every requested row's count, keyed by the
 * SAME canonical `entity_type` label the single-row count and every
 * admin mutation flow mint, so a page's badges can never disagree with
 * the trail the drawer opens. Every distinct requested id gets a map
 * entry; a row with no entries answers the honest `0` (never an error,
 * never clamped).
 *
 * @param subscriptionIds  The page's subscription ids — ids already
 *     present on caller-authorized rows, never client-supplied
 *     identifiers.
 * @returns One count per distinct requested id.
 */
export async function subscriptionAuditEntriesCountBatch(
  subscriptionIds: readonly number[]
): Promise<Map<number, number>> {
  return AuditTrailRepository.countEntriesByEntityIds(SUBSCRIPTION_AUDIT_ENTITY_TYPE, subscriptionIds);
}

/**
 * The trail TEASERS for a PAGE of subscriptions. One `DISTINCT ON`
 * repository read resolves every requested row's most recent entry (the
 * same `created_at DESC, id DESC` "latest" the single-row peek reads, so
 * the two can never disagree), and each raw row is certified fail-closed
 * against the canonical enum member set exactly like the single-row
 * peek: an uncertifiable literal would mean data corruption — it
 * surfaces as the honest `null` (never a junk value on the wire) plus
 * one bounded ids-only domain log. A row with no history answers
 * `null`.
 *
 * @param subscriptionIds  The page's subscription ids — ids already
 *     present on caller-authorized rows, never client-supplied
 *     identifiers.
 * @returns One peek (or the honest `null`) per distinct requested id.
 */
export async function subscriptionAuditTrailPeekBatch(
  subscriptionIds: readonly number[]
): Promise<Map<number, SubscriptionAuditTrailPeek | null>> {
  const latestById = await AuditTrailRepository.listLatestEntriesByEntityIds(
    SUBSCRIPTION_AUDIT_ENTITY_TYPE,
    subscriptionIds
  );
  const peekById = new Map<number, SubscriptionAuditTrailPeek | null>();
  for (const [subscriptionId, latest] of latestById) {
    if (latest === null) {
      peekById.set(subscriptionId, null);
      continue;
    }
    const certified = AUDIT_ACTION_TYPE_MEMBER_BY_RAW[latest.actionType];
    if (certified === undefined) {
      logger.logDomainError("Subscription audit peek withheld: uncertifiable action type in the trail", {
        code: "VALIDATION",
        subscriptionId,
      });
      peekById.set(subscriptionId, null);
      continue;
    }
    peekById.set(subscriptionId, { actionType: certified, at: latest.createdAt });
  }
  return peekById;
}

/**
 * Page-level enrichment for subscription list rows — ONE batch pass per
 * page: the page's DISTINCT plan ids go to one plan batch, and the page
 * row ids go to one audit-count batch plus one audit-peek batch — ≤3
 * extra queries for the whole page regardless of page size.
 *
 * The batch ids come ONLY from rows the caller was already authorized to
 * read (no client-supplied id enters any batch), an empty page enriches
 * nothing (zero batch reads), and the three batch reads run
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
  if (rows.length === 0) {
    return [];
  }
  const plansById = await PlanCatalogService.findByIds([...new Set(rows.map(row => row.planId))], locale, tx);
  const subscriptionIds = rows.map(row => row.id);
  const auditCounts = await subscriptionAuditEntriesCountBatch(subscriptionIds);
  const auditPeeks = await subscriptionAuditTrailPeekBatch(subscriptionIds);
  return rows.map(row =>
    Object.assign({}, row, {
      plan: plansById.get(row.planId) ?? null,
      auditEntriesCount: auditCounts.get(row.id) ?? 0,
      auditTrailPeek: auditPeeks.get(row.id) ?? null,
    })
  );
}
