/**
 * TeacherRepository matching-read implementation — the student-facing
 * on-demand matching read (`listMatchingCandidates`), extracted from
 * `teacher.repository.ts` following the sibling
 * `student.repository.directory.helpers.ts` extraction convention: the
 * public surface stays the `TeacherRepository` namespace (this module backs
 * the namespace's `listMatchingCandidates` method as a one-to-one
 * delegation target), and the two matching contracts
 * (`NormalizedTeacherMatchingFilters`, `TeacherMatchingRowType`) are
 * re-exported from `teacher.repository.ts` verbatim so their public import
 * path is unchanged.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - dynamic AND chains of scalar predicates — no prepared statements (no
 *    reuse win), no `inArray`; the finished `%…%` patterns arrive from the
 *    service's single escape point and are bound verbatim (never
 *    re-escaped or re-wrapped);
 *  - the executor is the caller's transaction when supplied (same snapshot
 *    as any surrounding writes), the global handle otherwise — the
 *    `isDBTransaction` guard here narrows the `DBQueryExecutor` union to
 *    its Drizzle-capable member first;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what an empty page means.
 */

import { and, desc, eq, gte, ilike, type SQL, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import type { DBQueryExecutor, DBTransaction } from "@/backend/types";

/**
 * Type guard — narrows `DBQueryExecutor` to `DBTransaction`. `DBTransaction`
 * (Drizzle's `PgAsyncTransaction`) exposes the `.select()` builder API; raw
 * `Pool` / `PoolClient` from `pg` do not. The presence of `.select`
 * therefore distinguishes the two at runtime without an unsafe cast.
 */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

/**
 * `NormalizedTeacherMatchingFilters` — repo-internal filter shape for the
 * student-facing matching read (`listMatchingCandidates`).
 *
 * The service layer normalizes the caller's validated browse input into this
 * structure before calling the repo:
 *  - `recitationPattern` / `subjectPattern` / `languagePattern` are
 *    quoted-token LIKE patterns AFTER `escapeLikeWildcards` has been applied
 *    AND after each has been wrapped as `%…%` — the service is the single
 *    escape point. The repo binds them directly to `ilike(column, pattern)`
 *    predicates, never re-escaping or re-wrapping. The quoted-token anchors
 *    make the match exact-token (the pattern `"hifz"` does not match a
 *    stored `"hifz_jadid"` member) while still riding the varchar index
 *    path of a substring scan.
 *  - `recitationPattern` / `subjectPattern` are `null` when the student
 *    browses without the corresponding narrowing choice (optional filters)
 *    — the predicate then drops out of the WHERE chain.
 *  - `languagePattern` is `null` when no language constraint applies
 *    (the Arabic-baseline caller browses without a language hard filter) —
 *    the predicate then drops out of the WHERE chain.
 *  - `namePattern` is the display-name search as a finished escaped
 *    `%…%` LIKE pattern built at the service's single escape point and
 *    bound verbatim (never re-escaped); `null` drops the predicate from
 *    the chain.
 *  - `minRating` is a bounds-validated finite rating floor — an honest
 *    SQL `>=` comparison, so an unrated teacher (NULL `average_rating`)
 *    is excluded whenever a floor is set; `null` drops the predicate.
 *  - `sort` selects the POST-tier ordering key (`buildTeacherMatchingOrderBy`);
 *    the country tier ALWAYS sorts first and the `id DESC` tiebreak last.
 *  - `studentCountryCode` / `studentCountryText` drive the soft country
 *    tiering (code first, legacy free-text fallback, neither → one tier).
 *    They are ordering inputs ONLY — no country predicate ever excludes a
 *    row.
 */
export interface NormalizedTeacherMatchingFilters {
  readonly recitationPattern: string | null;
  readonly subjectPattern: string | null;
  readonly languagePattern: string | null;
  readonly namePattern: string | null;
  readonly minRating: number | null;
  readonly sort: TeacherMatchingSort;
  readonly studentCountryCode: string | null;
  readonly studentCountryText: string | null;
}

/**
 * `TeacherMatchingRowType` — raw DB row shape returned by
 * `listMatchingCandidates` (teacher INNER JOIN users on the shared PK).
 * The JSON-in-varchar token payloads, the decimal rating, and the nullable
 * availability flag preserve their `| null` select types; the projection
 * layer parses them fail-closed at mapping time. Eligibility was already
 * decided in SQL against the RAW stored payloads, so a corrupt JSON payload
 * can narrow what a row DISPLAYS but never re-admit or drop the row here.
 */
export interface TeacherMatchingRowType {
  readonly id: number;
  readonly fullName: string;
  readonly country: string | null;
  readonly countryCode: string | null;
  readonly subjects: string | null;
  readonly recitations: string | null;
  readonly languages: string | null;
  readonly averageRating: string | null;
  readonly isOnline: boolean | null;
}

/**
 * Builds the ANDed WHERE chain for the matching read — the eligibility
 * baseline every returned row must satisfy:
 *  - the teacher is online AND certified (`eq(col, true)` is fail-closed:
 *    unknown availability is never shown);
 *  - the owning account is not governed — `is distinct from true` keeps the
 *    legacy NULL rows that a plain `eq(col, false)` would wrongly drop;
 *  - the teacher owns NO `session` row in the `started` state — a bulk
 *    correlated NOT EXISTS, the list-scale equivalent of the per-teacher
 *    in-session gate (same table, same status value); the composite
 *    `(teacher_id, status)` index serves it on the hot browse path. It
 *    composes WITH the online flag rather than trusting it: a row can
 *    carry a stale-true `is_online` while a session is still running;
 *  - the recitation and subject quoted-token patterns match when
 *    supplied (the subject vocabulary IS the session-intent vocabulary).
 * The recitation, subject, language, name-search, and minimum-rating
 * predicates join the chain only when a pattern/floor was resolved;
 * `null` means no constraint and leaves the chain unchanged. The rating
 * floor is the honest SQL `>=` — a NULL `average_rating` never satisfies
 * it, so setting a floor excludes the unrated by construction (never
 * `coalesce`d into a fabricated zero).
 */
function buildTeacherMatchingFilterChain(filters: NormalizedTeacherMatchingFilters): SQL {
  const chain = and(
    eq(teacher.isOnline, true),
    eq(teacher.isApproved, true),
    sql`${users.isDeleted} is distinct from true and ${users.suspended} is distinct from true and ${users.isBlocked} is distinct from true`,
    filters.recitationPattern === null ? undefined : ilike(teacher.recitations, filters.recitationPattern),
    filters.subjectPattern === null ? undefined : ilike(teacher.subjects, filters.subjectPattern),
    sql`not exists (select 1 from ${session} where ${session.teacherId} = ${teacher.id} and ${session.status} = ${SessionStatus.Started})`,
    filters.languagePattern === null ? undefined : ilike(teacher.languages, filters.languagePattern),
    filters.namePattern === null ? undefined : ilike(users.fullName, filters.namePattern),
    filters.minRating === null ? undefined : gte(teacher.averageRating, filters.minRating.toFixed(2))
  );
  return chain ?? sql`true`;
}

/**
 * Builds the country tier ordering fragment — a soft 0/1 bucket that sorts
 * same-country teachers ahead of the rest WITHOUT ever excluding a row:
 *  - a caller country CODE tier-matches `users.country_code` exactly;
 *  - legacy free-text falls back to a case-insensitive `country` match;
 *  - no country on the caller's account puts every candidate in ONE tier.
 * The tier precedes the rating in the ORDER BY, so a same-country teacher
 * outranks a better-rated foreign one.
 *
 * The no-country arm is a constant EXPRESSION, not a bare integer literal:
 * PostgreSQL reads a bare integer in ORDER BY as an output-column ordinal
 * (it would order by the first selected column instead of contributing a
 * constant tier key).
 */
function buildTeacherMatchingCountryTier(filters: NormalizedTeacherMatchingFilters): SQL {
  if (filters.studentCountryCode !== null) {
    return sql`case when ${users.countryCode} = ${filters.studentCountryCode} then 0 else 1 end`;
  }
  return filters.studentCountryText !== null
    ? sql`case when lower(${users.country}) = lower(${filters.studentCountryText}) then 0 else 1 end`
    : sql`1 = 1`;
}

/**
 * Post-tier sort-key builders — the enum-safety Record lookup (never a
 * `switch` over enum values). Each member builds the ONE ordering
 * fragment that follows the country tier:
 *  - `RATING_DESC` — `average_rating desc nulls last` (the honest-null
 *    default; byte-identical to the pre-sort-choice ordering);
 *  - `NAME_ASC` — `users.full_name asc` (alphabetical within a tier);
 *  - `NEWEST` — `id desc` as the key itself.
 */
const POST_TIER_SORT_KEY_BY_SORT: Record<TeacherMatchingSort, () => SQL> = {
  [TeacherMatchingSort.RatingDesc]: () => sql`${teacher.averageRating} desc nulls last`,
  [TeacherMatchingSort.NameAsc]: () => sql`${users.fullName} asc`,
  [TeacherMatchingSort.Newest]: () => desc(teacher.id),
};

/**
 * Builds the full ORDER BY key list for the matching read: the country
 * tier expression ALWAYS first (the soft same-country precedence, §3.7 of
 * the domain doc), then the caller-selected post-tier sort key, then the
 * deterministic `id DESC` tiebreak last (for `NEWEST` the tiebreak repeats
 * the key — an intentional no-op redundancy that keeps the shape total).
 *
 * All fragments are Drizzle expressions over columns and the bound tier
 * parameter — no string interpolation of caller data reaches the builder.
 */
function buildTeacherMatchingOrderBy(filters: NormalizedTeacherMatchingFilters, countryTier: SQL): SQL[] {
  return [sql`${countryTier} asc`, POST_TIER_SORT_KEY_BY_SORT[filters.sort](), desc(teacher.id)];
}

/**
 * Lists the student-facing matching candidates: `teacher` rows INNER
 * JOINed to their `users` accounts on the shared PK, filtered by the
 * eligibility chain plus whichever optional token-filter, name-search,
 * and minimum-rating predicates were resolved, ordered country-tier
 * first, then by the caller-selected post-tier sort key, and always
 * tiebroken by `id DESC` so consecutive pages never duplicate or drop a
 * row inserted mid-pagination.
 *
 * Runs the page query and the same-filter `count(*)` in one round-trip
 * pair so the caller can surface an honest `total` — an out-of-range
 * page yields an empty `rows` array with the unchanged count (never an
 * error, never clamped results).
 *
 * @returns The raw matching rows plus the unfiltered-by-page total (NOT
 *          the return type — the service layer maps rows →
 *          `TeacherMatchingItemReturnType`).
 */
export async function listMatchingCandidates(
  filters: NormalizedTeacherMatchingFilters,
  limit: number,
  offset: number,
  tx?: DBQueryExecutor
): Promise<{ rows: TeacherMatchingRowType[]; total: number }> {
  const where = buildTeacherMatchingFilterChain(filters);
  const countryTier = buildTeacherMatchingCountryTier(filters);
  const orderBy = buildTeacherMatchingOrderBy(filters, countryTier);
  const [rows, countRows] = await Promise.all([
    (tx && isDBTransaction(tx) ? tx : db)
      .select({
        id: teacher.id,
        fullName: users.fullName,
        country: users.country,
        countryCode: users.countryCode,
        subjects: teacher.subjects,
        recitations: teacher.recitations,
        languages: teacher.languages,
        averageRating: teacher.averageRating,
        isOnline: teacher.isOnline,
      })
      .from(teacher)
      .innerJoin(users, eq(users.id, teacher.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    (tx && isDBTransaction(tx) ? tx : db)
      .select({ count: sql<number>`count(*)::int`.as("count") })
      .from(teacher)
      .innerJoin(users, eq(users.id, teacher.id))
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}
