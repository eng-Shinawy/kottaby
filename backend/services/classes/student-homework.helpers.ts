/**
 * Pure helpers for the teacher-scoped student homework history read.
 *
 * Co-locates the pagination clamp with the constants that back it so the
 * service flow stays a small set of bare functions (the established
 * bare-export module idiom of the classes-domain services). Nothing here
 * touches the database, opens a transaction, or logs — every function is
 * pure (or returns plain values).
 *
 * The clamp mirrors the parent-portal pagination contract verbatim:
 * `page >= 1`, `pageSize` clamped to `[1, MAX]` with a sane default; the
 * effective values are echoed back to the caller in the page payload so an
 * out-of-range page yields an empty `items` array next to the true
 * `totalCount` — never a fabricated window.
 */
import type { StudentHomeworkPageInput } from "@/backend/types";

/** Hard cap on the page size a teacher-scoped history read can request. */
const MAX_HOMEWORK_HISTORY_PAGE_SIZE = 50;

/** Default page size when the caller omits `pageSize` or supplies an out-of-range value. */
const DEFAULT_HOMEWORK_HISTORY_PAGE_SIZE = 25;

/** Default page number when the caller omits `page` or supplies an out-of-range value. */
const DEFAULT_HOMEWORK_HISTORY_PAGE = 1;

/**
 * Type guard — narrows `unknown` to a positive safe integer. Used by the
 * pagination clamp to validate caller-supplied `page` / `pageSize` values
 * without unsafe type assertions.
 */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Normalizes a caller-supplied pagination request into the effective
 * `(page, pageSize, offset)` triple the repository read consumes. Both
 * members are clamped (never thrown): a missing or non-positive `page`
 * resolves to the first page; a missing or out-of-range `pageSize`
 * resolves to the default. The effective values are echoed back to the
 * caller in the page payload — an out-of-range page yields an empty
 * `items` array next to the true `totalCount`, never a fabricated window.
 */
export function clampHomeworkHistoryPage(input: StudentHomeworkPageInput | undefined): {
  readonly page: number;
  readonly pageSize: number;
  readonly offset: number;
} {
  const rawPage = input?.page;
  const rawPageSize = input?.pageSize;
  const page = isPositiveSafeInteger(rawPage) ? rawPage : DEFAULT_HOMEWORK_HISTORY_PAGE;
  const pageSize =
    isPositiveSafeInteger(rawPageSize) && rawPageSize <= MAX_HOMEWORK_HISTORY_PAGE_SIZE
      ? rawPageSize
      : DEFAULT_HOMEWORK_HISTORY_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
