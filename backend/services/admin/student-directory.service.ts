/**
 * AdminStudentDirectoryService — business-logic hub for the `adminStudents`
 * admin directory surface (paginated listing of `students` role-child rows
 * joined to their `users` accounts, with the linked parent's display
 * identity resolved via a left join).
 *
 * Operations:
 *  - `list` — filter normalization + pagination bounds + row→item
 *    projection over `StudentRepository.listDirectory`.
 *  - `exportAll` — the same filter normalization + row→item projection,
 *    bounded to the first `EXPORT_MAX_ROWS` (1000) filtered rows in the
 *    listing's default ordering (NO pagination arguments): the envelope
 *    reports the FULL filtered `total` alongside `truncated` (`total >
 *    rows.length`) so callers can warn that the payload is a bounded
 *    window rather than the whole directory.
 *
 * Disciplines enforced here (mirroring `AdminUserManagementService`):
 *  - Defense-in-depth BFLA: `assertActorAdmin` is the FIRST statement —
 *    anonymous callers (`actorId = 0`) receive `UnauthorizedError`;
 *    authenticated non-admins receive `ForbiddenError`. Pure read: denial
 *    and success paths both emit ZERO audit rows and perform ZERO writes.
 *  - Search sanitization boundary: the free-text search term is trimmed,
 *    clamped to a 100-char ceiling, escaped via the canonical
 *    `escapeLikeWildcards` helper AND wrapped as `%…%` BEFORE the repo sees
 *    it — the repo binds the final pattern directly to its `ilike`
 *    predicates (one canonical escape point, one binding point).
 *  - Pagination bounds: `page >= 1`, `pageSize in 1..100` (default 25) via
 *    the shared `resolvePageBounds` helper — out-of-range values reject
 *    with a localized `VALIDATION` error BEFORE any DB read. An
 *    out-of-range page (e.g. page 999 on a 10-page directory) returns
 *    `{ items: [], total, page, pageSize, pageCount }` honestly — never an
 *    error, never clamped.
 *  - `pageCount` is the ceiling division of `total` over the resolved
 *    `pageSize` (an empty directory yields `0`).
 *  - Logging: expected rejections surface through the shared admin gate's
 *    `logger.logDomainError` (ids + codes only — no PII); this service adds
 *    no logging of its own. NEVER `console.*`.
 *  - i18n: pagination validation messages resolve through
 *    `getServerTranslations(locale).errorsTranslations` (property access
 *    only, never `t('key')` string-concatenated lookup).
 */
import { StudentRepository } from "@/backend/db/repo";
import type { NormalizedAdminStudentFilters } from "@/backend/db/repo/students/student.repository";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { assertActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import { buildExportEnvelope, EXPORT_MAX_ROWS } from "@/backend/services/admin/directory-export.helpers";
import { mapStudentDirectoryRow } from "@/backend/services/admin/student-directory.mappers";
import { resolvePageBounds } from "@/backend/services/admin/user-management.query.helpers";
import type {
  AdminStudentExportEnvelopeReturnType,
  AdminStudentFiltersSubmitInput,
  AdminStudentPageReturnType,
  DBTransaction,
} from "@/backend/types";

/** Upper bound on the free-text search term length — longer input clamps. */
const MAX_SEARCH_LENGTH = 100;

/**
 * Normalizes a transport-shape filter input into the repo-internal
 * `NormalizedAdminStudentFilters` shape. Empty / whitespace-only search
 * drops out (the directory falls back to the unfiltered listing rather
 * than erroring); a longer term clamps to the 100-char ceiling BEFORE the
 * LIKE-escape + `%…%`-wrap. `language` is trimmed (the repo matches it
 * case-insensitively as an exact value); empty becomes `null`.
 * `hasParent` passes through as `null` when absent (the repo skips it in
 * the WHERE chain).
 */
function normalizeFilters(filters: AdminStudentFiltersSubmitInput): NormalizedAdminStudentFilters {
  let searchPattern: string | null = null;
  const trimmedSearch = filters.search?.trim();
  if (trimmedSearch) {
    searchPattern = `%${escapeLikeWildcards(trimmedSearch.slice(0, MAX_SEARCH_LENGTH))}%`;
  }
  let language: string | null = null;
  const trimmedLanguage = filters.language?.trim();
  if (trimmedLanguage) {
    language = trimmedLanguage;
  }
  return {
    searchPattern,
    hasParent: filters.hasParent ?? null,
    language,
  };
}

export namespace AdminStudentDirectoryService {
  /**
   * Lists the student directory by filter + page bounds.
   *
   * Pre-DB pagination bounds: `page >= 1`, `pageSize in 1..100`, default
   * `pageSize = 25`. Out-of-range values reject with `VALIDATION`. An
   * out-of-range page returns `{ items: [], total, … }` honestly — never
   * an error, never clamped.
   */
  export async function list(
    filters: AdminStudentFiltersSubmitInput,
    page: number,
    pageSize: number | undefined,
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminStudentPageReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const { resolvedPage, resolvedPageSize, offset } = resolvePageBounds(page, pageSize, locale);
    const normalized = normalizeFilters(filters);
    const { rows, total } = await StudentRepository.listDirectory(normalized, resolvedPageSize, offset, outerTx);

    const items = rows.map(row => mapStudentDirectoryRow(row));

    return {
      items,
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      pageCount: Math.ceil(total / resolvedPageSize),
    };
  }

  /**
   * Exports the student directory by filter — the first `EXPORT_MAX_ROWS`
   * (1000) filtered rows in the listing's default ordering (newest account
   * first), with NO pagination arguments.
   *
   * Reuses `StudentRepository.listDirectory` verbatim (`limit =
   * EXPORT_MAX_ROWS`, `offset = 0`): the repo's `{ rows, total }` pair
   * supplies the envelope for free — `total` is the FULL filtered row
   * count (the count the listing would report across all pages) and
   * `truncated` is the honest cap flag. Filter normalization is the SAME
   * code path as `list` (search trim + 100-char clamp + LIKE-escape +
   * `%…%`-wrap), so an export can never see a row the listing cannot.
   */
  export async function exportAll(
    filters: AdminStudentFiltersSubmitInput,
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminStudentExportEnvelopeReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const normalized = normalizeFilters(filters);
    const { rows, total } = await StudentRepository.listDirectory(normalized, EXPORT_MAX_ROWS, 0, outerTx);

    return buildExportEnvelope(
      rows.map(row => mapStudentDirectoryRow(row)),
      total
    );
  }
}
