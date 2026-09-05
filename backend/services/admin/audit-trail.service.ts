/**
 * AuditTrailService — business-logic hub for the global admin audit-trail
 * read surface (`audit_logs` browse/filter/paginate).
 *
 * The trail is a PURE READ surface: it exposes the append-only `audit_logs`
 * table (joined to `users` for the acting account's current display name)
 * to admin actors, and performs ZERO writes of any kind — reads never
 * audit, so listing the trail can never pollute the trail itself.
 *
 * Disciplines enforced here:
 *  - Defense-in-depth BFLA: `assertActorAdmin` runs BEFORE any other work
 *    — anonymous callers (`actorId = 0`) receive `UnauthorizedError`,
 *    authenticated non-admins receive `ForbiddenError`. Denials emit
 *    ZERO audit rows and ZERO writes.
 *  - Closed-input validation (pre-DB): every filter member is structurally
 *    validated BEFORE any database contact — id-shaped filters must be
 *    positive safe integers, `entityType` is trimmed (empty-after-trim is
 *    treated as absent) and bounded by the column's varchar(100) ceiling,
 *    `actionType` is re-asserted against the canonical enum members, and
 *    the `from`/`to` window bounds must be valid `Date`s with `from`
 *    strictly before `to`. Malformed values reject with a localized
 *    `ValidationError` and never reach the database.
 *  - Pagination (pre-DB): `page` defaults to 1 and must be a positive
 *    integer; `pageSize` defaults to 25 and must be an integer within
 *    `1..100`. Violations reject with the same localized `ValidationError`.
 *  - Consistent read snapshot: the paired count + listing run inside ONE
 *    transaction — a fresh top-level transaction at the `repeatable read`
 *    isolation level when the service owns the transaction, or a nested
 *    execution joined to the caller's supplied transaction otherwise — so
 *    `totalCount` and `items` can never tear across a concurrent producer
 *    commit.
 *  - Honest pagination: an out-of-range page returns an empty `items`
 *    array with the unchanged, honest `totalCount` — never an error,
 *    never clamped.
 *  - Fail-closed enum coercion: raw stored `action_type` strings are
 *    mapped through the shared coercion helper at projection time; a
 *    corrupt stored value surfaces as a plain runtime error (masked to a
 *    generic internal error at the transport boundary) rather than an
 *    unsafe cast leaking raw database strings to clients.
 *  - Logging: the happy path logs NOTHING. Expected denials are logged
 *    exactly once each by the shared actor gate (ids + codes only — no
 *    filter payloads, no `details` content, no actor PII).
 */
import { db } from "@/backend/db";
import { type AuditTrailEntryRow, AuditTrailRepository, type NormalizedAuditTrailFilters } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ValidationError } from "@/backend/lib/errors";
import { assertActorAdmin, toAuditActionType } from "@/backend/services/admin/admin-gate.helpers";
import { isPositiveSafeInteger, resolvePageBounds } from "@/backend/services/admin/user-management.helpers";
import type {
  AdminAuditLogEntryReturnType,
  AdminAuditLogPageReturnType,
  AdminAuditTrailFiltersSubmitInput,
  DBTransaction,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The `audit_logs.entity_type` column is a `varchar(100)` — filter values
 * beyond this ceiling can never match a stored row and are rejected up
 * front instead of reaching the database.
 */
const MAX_ENTITY_TYPE_LENGTH = 100;

/**
 * Resolves the localized validation-failure error for this surface. Every
 * pre-DB rejection shares this single message source (no hardcoded copy,
 * no field-payload echo of the rejected input).
 */
function validationFailure(locale: string): ValidationError {
  return new ValidationError(getServerTranslations(locale).errorsTranslations.validation);
}

/**
 * Validates one `from`/`to` window bound: it must be a real `Date`
 * carrying a finite timestamp (`new Date("nope")` is a `Date` instance
 * whose `getTime()` is `NaN` — rejected here).
 */
function assertWindowBound(value: Date, locale: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw validationFailure(locale);
  }
  return value;
}

/**
 * Validates + normalizes one id-shaped filter member (`actorId` /
 * `entityId`): absent (`null`/`undefined`) drops out of the normalized
 * shape; present-but-malformed (non-integer, non-positive, or beyond the
 * safe-integer range) rejects before any database contact.
 */
function normalizeIdFilter(value: number | null | undefined, locale: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPositiveSafeInteger(value)) {
    throw validationFailure(locale);
  }
  return value;
}

/**
 * Validates + normalizes the `entityType` filter member: trimmed, bounded
 * by the column's varchar(100) ceiling, and dropped entirely when empty
 * after trim (treated as absent rather than as a never-matching literal).
 */
function normalizeEntityTypeFilter(value: string | null | undefined, locale: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_ENTITY_TYPE_LENGTH) {
    throw validationFailure(locale);
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Validates + normalizes the `actionType` filter member. Fail-closed
 * membership re-assertion: transport-typed enum values are re-checked
 * against the canonical member set so a wire-level forgery (or a
 * journey-layer mistake) can never bind a junk literal into the query.
 */
function normalizeActionTypeFilter(
  value: AuditActionType | null | undefined,
  locale: string
): AuditActionType | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Object.values(AuditActionType).includes(value)) {
    throw validationFailure(locale);
  }
  return value;
}

/**
 * Validates + normalizes the `from`/`to` window pair. Both bounds must be
 * valid `Date`s and, when BOTH are present, `from` must be strictly
 * before `to` — the half-open window semantics (`>= from`, `< to`) make
 * a degenerate or inverted window a guaranteed-empty (and likely
 * caller-bug) query, rejected up front. A one-sided window is valid and
 * leaves the other bound unbounded.
 */
function normalizeWindowBounds(
  from: Date | null | undefined,
  to: Date | null | undefined,
  locale: string
): { from?: Date; to?: Date } {
  const resolvedFrom = from === undefined || from === null ? undefined : assertWindowBound(from, locale);
  const resolvedTo = to === undefined || to === null ? undefined : assertWindowBound(to, locale);
  if (resolvedFrom !== undefined && resolvedTo !== undefined && resolvedFrom.getTime() >= resolvedTo.getTime()) {
    throw validationFailure(locale);
  }
  return { from: resolvedFrom, to: resolvedTo };
}

/**
 * Normalizes the transport-shape filter input into the repository's
 * null-stripped filter shape. Validation precedence is fixed and
 * load-bearing: id-shaped filters first, then `entityType`, then
 * `actionType`, then the time window — the sequential evaluation below
 * IS the precedence (first failure wins, all before any database
 * contact). Absent (`null`/`undefined`) members drop out of the
 * normalized shape entirely — the unfiltered trail is the fallback,
 * never an error — while present-but-malformed members reject.
 */
function normalizeTrailFilters(
  filters: AdminAuditTrailFiltersSubmitInput,
  locale: string
): NormalizedAuditTrailFilters {
  const actorId = normalizeIdFilter(filters.actorId, locale);
  const entityId = normalizeIdFilter(filters.entityId, locale);
  const entityType = normalizeEntityTypeFilter(filters.entityType, locale);
  const actionType = normalizeActionTypeFilter(filters.actionType, locale);
  const { from, to } = normalizeWindowBounds(filters.from, filters.to, locale);

  return { actorId, actionType, entityType, entityId, from, to };
}

/**
 * Runs the paired reads inside ONE consistent-snapshot transaction. When
 * the caller supplied a transaction, execution joins it as a nested
 * block (both reads share the caller's transaction and inherit its
 * isolation posture); otherwise a fresh top-level transaction is opened
 * at the `repeatable read` isolation level so the count and the listing
 * observe the same committed state even while other admins produce new
 * audit rows.
 */
async function readInSnapshot<T>(
  outerTx: DBTransaction | undefined,
  fn: (tx: DBTransaction) => Promise<T>
): Promise<T> {
  if (outerTx) {
    return outerTx.transaction(fn);
  }
  return db.transaction(fn, { isolationLevel: "repeatable read" });
}

/**
 * Maps one raw trail row to the canonical return entry. The raw stored
 * `action_type` string is coerced through the shared fail-closed helper;
 * a corrupt stored value throws a plain runtime error (never a domain
 * error code) — the transport boundary masks it to a generic internal
 * error instead of leaking the raw database string to clients.
 */
function mapTrailRow(row: AuditTrailEntryRow): AdminAuditLogEntryReturnType {
  const actionType = toAuditActionType(row.actionType);
  if (actionType === null) {
    // Fail-closed on a corrupt stored enum value — surfaces as a
    // resolver error rather than an unsafe cast.
    throw new Error(`Unexpected audit action type: ${row.actionType}`);
  }
  return {
    id: row.id,
    actionType,
    actorId: row.actorId,
    // The actor's CURRENT display name resolved via the `users` join —
    // documented as a live projection, not a point-in-time snapshot.
    actorName: row.actorName,
    entityType: row.entityType,
    entityId: row.entityId,
    details: row.details,
    createdAt: row.createdAt,
  };
}

export namespace AuditTrailService {
  /**
   * Lists the global audit trail by filter + page bounds, newest-first.
   *
   * Pipeline (fixed order): the admin actor gate runs FIRST (pre-DB for
   * everything else), then closed-input filter validation, then
   * pagination resolution, then the paired count + listing inside ONE
   * consistent-snapshot transaction, then row mapping. A rejection at any
   * pre-DB stage means zero database contact beyond the actor probe.
   *
   * Honest page semantics: `page`/`pageSize` are echoed back exactly as
   * resolved (defaults applied, no clamping); an out-of-range page yields
   * `{ items: [], totalCount, page, pageSize }` with the unchanged honest
   * count. `details` content is passed through verbatim and is never
   * parsed, filtered, or echoed into logs.
   *
   * Pure read: zero writes, zero audit rows, and the happy path logs
   * nothing. Denial logging is owned by the shared actor gate.
   *
   * @param filters  Filter input as copied field-by-field from the
   *     resolver (closed whitelist — nulls express "clear this filter").
   * @param page     1-based page number (`null`/`undefined` → 1).
   * @param pageSize Rows per page (`null`/`undefined` → 25; bound 1..100).
   * @param locale   Locale for the localized validation message.
   * @param actorId  The acting admin's user id (never client input).
   * @param outerTx  Optional caller transaction to join for the reads.
   * @returns One honest page of typed trail entries.
   */
  export async function listAuditTrail(
    filters: AdminAuditTrailFiltersSubmitInput,
    page: number | null | undefined,
    pageSize: number | null | undefined,
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminAuditLogPageReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const normalized = normalizeTrailFilters(filters, locale);
    const { resolvedPage, resolvedPageSize, offset } = resolvePageBounds(page ?? 1, pageSize ?? undefined, locale);

    const [pageRows, matchedCount] = await readInSnapshot(
      outerTx,
      async (tx): Promise<[AuditTrailEntryRow[], number]> => {
        const totalCount = await AuditTrailRepository.countEntries(normalized, tx);
        const rows = await AuditTrailRepository.listEntries(normalized, resolvedPageSize, offset, tx);
        return [rows, totalCount];
      }
    );

    const items = pageRows.map(row => mapTrailRow(row));

    return {
      items,
      totalCount: matchedCount,
      page: resolvedPage,
      pageSize: resolvedPageSize,
    };
  }
}
