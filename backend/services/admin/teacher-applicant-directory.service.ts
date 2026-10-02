/**
 * AdminApplicantDirectoryService — business-logic hub for the
 * `adminTeacherApplicants` admin directory surface (paginated listing of
 * `applicants` pipeline rows joined to their `users` accounts — the
 * teacher-certification queue).
 *
 * Single listing operation: `list` — filter normalization + pagination
 * bounds + row→item projection over `ApplicantRepository.listDirectory`,
 * fetched in parallel with `ApplicantRepository.statusCounts` (the
 * search-aware / status-independent per-status aggregate that powers the
 * queue's quick-filter chips). The `exportAll` operation reuses the same
 * filter normalization + row→item projection, bounded to the first
 * `EXPORT_MAX_ROWS` (1000) filtered rows (NO pagination arguments) with
 * the honest `truncated` cap flag.
 *
 * Disciplines enforced here (mirroring `AdminTeacherDirectoryService`):
 *  - Defense-in-depth BFLA: `assertActorAdmin` is the FIRST statement —
 *    anonymous callers (`actorId = 0`) receive `UnauthorizedError`;
 *    authenticated non-admins receive `ForbiddenError`. Pure read: denial
 *    and success paths both emit ZERO audit rows and perform ZERO writes
 *    (certification actions belong to the admin user-detail surface).
 *  - Search sanitization boundary: the free-text search term is trimmed,
 *    clamped to a 100-char ceiling, escaped via the canonical
 *    `escapeLikeWildcards` helper AND wrapped as `%…%` BEFORE the repo sees
 *    it — the repo binds the final pattern directly to its `ilike`
 *    predicates (one canonical escape point, one binding point).
 *  - Status vocabulary: the varchar `applicants.status` column has NO
 *    pgEnum, so the allow-list (`pending` | `in_evaluation` | `failed` |
 *    `passed`, via the canonical `isApplicantStatus` guard) is enforced
 *    HERE — any other value rejects with a localized `VALIDATION` error
 *    BEFORE any DB read. Absent status filters drop out.
 *  - Pagination bounds: `page >= 1`, `pageSize in 1..100` (default 25) via
 *    the shared `resolvePageBounds` helper — out-of-range values reject
 *    with a localized `VALIDATION` error BEFORE any DB read. An
 *    out-of-range page (e.g. page 999 on a 10-page queue) returns
 *    `{ items: [], total, page, pageSize, pageCount }` honestly — never an
 *    error, never clamped.
 *  - `pageCount` is the ceiling division of `total` over the resolved
 *    `pageSize` (an empty queue yields `0`).
 *  - Logging: expected rejections surface through the shared admin gate's
 *    `logger.logDomainError` (ids + codes only — no PII); this service adds
 *    no logging of its own. NEVER `console.*`.
 *  - i18n: validation messages resolve through
 *    `getServerTranslations(locale).errorsTranslations` (property access
 *    only, never `t('key')` string-concatenated lookup).
 */
import { ApplicantRepository } from "@/backend/db/repo";
import type { NormalizedAdminApplicantFilters } from "@/backend/db/repo/teachers/applicant.repository";
import { isApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { ValidationError } from "@/backend/lib/errors";
import { assertActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import { buildExportEnvelope, EXPORT_MAX_ROWS } from "@/backend/services/admin/directory-export.helpers";
import { mapApplicantDirectoryRow } from "@/backend/services/admin/teacher-applicant-directory.mappers";
import { resolvePageBounds } from "@/backend/services/admin/user-management.query.helpers";
import type {
  AdminApplicantExportEnvelopeReturnType,
  AdminApplicantFiltersSubmitInput,
  AdminApplicantPageReturnType,
  DBTransaction,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Upper bound on the free-text search term length — longer input clamps. */
const MAX_SEARCH_LENGTH = 100;

/**
 * Normalizes a transport-shape filter input into the repo-internal
 * `NormalizedAdminApplicantFilters` shape. Empty / whitespace-only search
 * drops out (the queue falls back to the unfiltered listing rather than
 * erroring); a longer term clamps to the 100-char ceiling BEFORE the
 * LIKE-escape + `%…%`-wrap. An absent status passes through as `null` (the
 * repo skips it in the WHERE chain); a present-but-invalid status REJECTS
 * with a localized `VALIDATION` error — the fail-closed vocabulary gate for
 * the enum-less varchar column.
 */
function normalizeFilters(filters: AdminApplicantFiltersSubmitInput, locale: string): NormalizedAdminApplicantFilters {
  let searchPattern: string | null = null;
  const trimmedSearch = filters.search?.trim();
  if (trimmedSearch) {
    searchPattern = `%${escapeLikeWildcards(trimmedSearch.slice(0, MAX_SEARCH_LENGTH))}%`;
  }
  let status: NormalizedAdminApplicantFilters["status"] = null;
  if (filters.status !== null && filters.status !== undefined) {
    if (!isApplicantStatus(filters.status)) {
      throw new ValidationError(getServerTranslations(locale).errorsTranslations.validation);
    }
    status = filters.status;
  }
  return { searchPattern, status };
}

export namespace AdminApplicantDirectoryService {
  /**
   * Lists the applicant queue by filter + page bounds.
   *
   * Pre-DB pagination bounds: `page >= 1`, `pageSize in 1..100`, default
   * `pageSize = 25`. Out-of-range values reject with `VALIDATION`. An
   * out-of-range page returns `{ items: [], total, … }` honestly — never
   * an error, never clamped.
   *
   * The per-status `statusCounts` aggregate runs in the SAME `Promise.all`
   * as the listing (one round-trip pair on the caller's executor). The
   * normalized `status` filter is deliberately NOT forwarded to the
   * counts: they are search-aware but status-filter-independent so the
   * quick-filter chips keep describing the whole searched pipeline while a
   * status filter narrows the page items.
   */
  export async function list(
    filters: AdminApplicantFiltersSubmitInput,
    page: number,
    pageSize: number | undefined,
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminApplicantPageReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const { resolvedPage, resolvedPageSize, offset } = resolvePageBounds(page, pageSize, locale);
    const normalized = normalizeFilters(filters, locale);
    const [directory, statusCounts] = await Promise.all([
      ApplicantRepository.listDirectory(normalized, resolvedPageSize, offset, outerTx),
      // normalized.status is deliberately NOT passed — see the doc block.
      ApplicantRepository.statusCounts({ searchPattern: normalized.searchPattern }, outerTx),
    ]);

    const items = directory.rows.map(row => mapApplicantDirectoryRow(row));

    return {
      items,
      total: directory.total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      pageCount: Math.ceil(directory.total / resolvedPageSize),
      statusCounts,
    };
  }

  /**
   * Exports the applicant queue by filter — the first `EXPORT_MAX_ROWS`
   * (1000) filtered rows in the listing's default ordering (newest account
   * first), with NO pagination arguments.
   *
   * Reuses `ApplicantRepository.listDirectory` verbatim (`limit =
   * EXPORT_MAX_ROWS`, `offset = 0`): the repo's `{ rows, total }` pair
   * supplies the envelope for free — `total` is the FULL filtered row
   * count (the count the listing would report across all pages) and
   * `truncated` is the honest cap flag. Filter normalization is the SAME
   * code path as `list` — including the status-vocabulary gate (invalid
   * `status` values reject with a localized `VALIDATION` error BEFORE any
   * DB read) — so an export can never see a row the listing cannot. The
   * `statusCounts` aggregate is a page-envelope affordance and is NOT part
   * of the export payload.
   */
  export async function exportAll(
    filters: AdminApplicantFiltersSubmitInput,
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminApplicantExportEnvelopeReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const normalized = normalizeFilters(filters, locale);
    const { rows, total } = await ApplicantRepository.listDirectory(normalized, EXPORT_MAX_ROWS, 0, outerTx);

    return buildExportEnvelope(
      rows.map(row => mapApplicantDirectoryRow(row)),
      total
    );
  }
}
