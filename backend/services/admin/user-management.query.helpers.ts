/**
 * Admin user-management QUERY-INPUT helpers — pure bounds resolvers and
 * filter normalization extracted VERBATIM from
 * `user-management.helpers.ts` (behavior-identical extraction; zero logic
 * change) so each module stays within the repo's `max-lines` lint tier.
 * These helpers own the read-path input discipline shared by
 * `AdminUserManagementService.listDirectory`, `.getUserActivity`, and
 * `.getCountryBreakdown`:
 *  - pagination bounds REJECT out-of-range values with `VALIDATION`
 *    (write-path strictness at the read boundary),
 *  - activity/facet `limit` values CLAMP (read-path leniency — a bounded
 *    read surface never errors on an out-of-range cap),
 *  - filter normalization drops empty/unknown members instead of erroring
 *    (the forgiving read rule) and escapes the `search` substring before
 *    the repo ever sees it.
 */
import type { NormalizedAdminUserFilters } from "@/backend/db/repo/admin/admin-user.repository";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { ValidationError } from "@/backend/lib/errors";
import { isPositiveSafeInteger } from "@/backend/services/admin/user-management.helpers";
import type { AdminUserFiltersSubmitInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Pagination bounds — out-of-range values reject with `VALIDATION`. */
const MIN_PAGE = 1;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** Activity-timeline bounds — out-of-range `limit` values clamp (read path, never errors). */
const MIN_ACTIVITY_LIMIT = 1;
const MAX_ACTIVITY_LIMIT = 50;
const DEFAULT_ACTIVITY_LIMIT = 10;

/** Country-breakdown facet bounds — same clamp-first read-path discipline. */
const MIN_COUNTRY_BREAKDOWN_LIMIT = 1;
const MAX_COUNTRY_BREAKDOWN_LIMIT = 12;
const DEFAULT_COUNTRY_BREAKDOWN_LIMIT = 6;

/**
 * Resolves + validates the directory pagination bounds. Out-of-range
 * values reject with `VALIDATION` (localized); valid input returns the
 * resolved page / pageSize / SQL offset triple.
 */
export function resolvePageBounds(
  page: number,
  pageSize: number | undefined,
  locale: string
): { resolvedPage: number; resolvedPageSize: number; offset: number } {
  const tErrors = getServerTranslations(locale).errorsTranslations;

  const resolvedPage = page;
  if (!isPositiveSafeInteger(resolvedPage) || resolvedPage < MIN_PAGE) {
    throw new ValidationError(tErrors.validation);
  }
  const resolvedPageSize = pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(resolvedPageSize) || resolvedPageSize < MIN_PAGE_SIZE || resolvedPageSize > MAX_PAGE_SIZE) {
    throw new ValidationError(tErrors.validation);
  }

  return { resolvedPage, resolvedPageSize, offset: (resolvedPage - 1) * resolvedPageSize };
}

/**
 * Resolves the activity-timeline `limit`. Clamp-first: `undefined`/`null`/
 * non-finite → default; every finite value truncates then clamps into
 * 1..50. An explicit 0 reads as "minimum" (1), never as "unbounded".
 */
export function resolveActivityLimit(limit?: number | null): number {
  const rawLimit = limit ?? DEFAULT_ACTIVITY_LIMIT;
  const truncated = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_ACTIVITY_LIMIT;
  return Math.min(Math.max(truncated, MIN_ACTIVITY_LIMIT), MAX_ACTIVITY_LIMIT);
}

/**
 * Resolves the country-breakdown facet's `limit`. Clamp-first, mirroring
 * `resolveActivityLimit`: `undefined`/`null`/non-finite → default (6);
 * every finite value truncates then clamps into 1..12. An explicit 0
 * reads as "minimum" (1), never as "unbounded".
 */
export function resolveCountryBreakdownLimit(limit?: number | null): number {
  const rawLimit = limit ?? DEFAULT_COUNTRY_BREAKDOWN_LIMIT;
  const truncated = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_COUNTRY_BREAKDOWN_LIMIT;
  return Math.min(Math.max(truncated, MIN_COUNTRY_BREAKDOWN_LIMIT), MAX_COUNTRY_BREAKDOWN_LIMIT);
}

/**
 * Normalizes a transport-shape filter input into the repo-internal
 * `NormalizedAdminUserFilters` shape. Drops empty / null / unknown
 * members (the directory falls back to the unfiltered listing rather
 * than erroring). The `search` substring is escaped via
 * `escapeLikeWildcards` and wrapped as `%…%` BEFORE being passed to the
 * repo — the repo receives the final escaped + wrapped pattern and
 * binds it directly to its `ilike(column, pattern)` predicate. The two
 * applicant-lifecycle members are enum members already validated at the
 * GraphQL input boundary, so they pass through unchanged (absent →
 * undefined → dropped by the WHERE-chain builder per the forgiving
 * read rule).
 */
export function normalizeFilters(filters: AdminUserFiltersSubmitInput): NormalizedAdminUserFilters {
  const role = filters.role ?? undefined;
  const governance = filters.governance ?? undefined;
  const country = filters.country ?? undefined;
  const applicantStatus = filters.applicantStatus ?? undefined;
  const cooldownState = filters.cooldownState ?? undefined;
  // Boolean narrow: only an EXPLICIT `true` survives (null/false/undefined
  // all drop out per the forgiving read rule — a tampered `false` can never
  // accidentally express "absent" semantics; both read the same).
  const cooldownExpiringSoon = filters.cooldownExpiringSoon === true ? true : undefined;
  let searchPattern: string | undefined;
  if (filters.search && filters.search.trim().length > 0) {
    const escaped = escapeLikeWildcards(filters.search.trim());
    searchPattern = `%${escaped}%`;
  }
  return {
    role,
    governance,
    country,
    searchPattern,
    applicantStatus,
    cooldownState,
    cooldownExpiringSoon,
  };
}
