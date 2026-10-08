/**
 * TeacherMatchingService — the student-facing on-demand matching browse.
 *
 * Responsibilities:
 *  - `browseAvailableTeachers` — ONE public method resolving the caller's
 *    own profile (country pair + languages), validating the per-browse
 *    choices (optional recitation and intent narrowing filters, name
 *    search, minimum rating, sort), normalizing every match token, and
 *    delegating the filtered/sorted read to
 *    `TeacherRepository.listMatchingCandidates`. The pipeline
 *    priorities: Qira'ah certification, session subject, and language
 *    fluency are HARD filters when supplied (language is a HARD filter
 *    for non-Arabic speakers only; recitation, subject, the name
 *    search, and the rating floor are OPTIONAL hard filters — `null`
 *    drops the predicate), and country is a SOFT ordering tier that never
 *    excludes (the chosen sort keys only the post-tier order; rating is
 *    the default sort key). Zero matches is a valid browse state (an
 *    honest empty page).
 *
 * Disciplines enforced here:
 *  - Caller identity is the authenticated user id ONLY: the input carries
 *    no ids of any kind, and the caller's own `users` + `students` rows
 *    are resolved here (a caller without a `students` row — teacher,
 *    parent, admin — is a caller-miss denial, not an empty result).
 *  - Validation BEFORE any database work: a non-null recitation token is
 *    checked against the shared catalog, a non-null intent against the
 *    student browse vocabulary (the staff-driven evaluation flow is
 *    never a browse intent; `null` skips both probes and means "no
 *    constraint"), the sort against the `TeacherMatchingSort` member
 *    set, and the pagination bounds through the canonical bounds
 *    resolver. A malformed choice denies with the localized
 *    `ValidationError` and touches zero rows.
 *  - Language resolution: the caller's own profile languages resolve to
 *    at most ONE hard-filter token (primary first, then the secondary).
 *    An absent language or an Arabic-baseline token applies NO language
 *    filter (Arabic is the shared lingua franca of Quran teaching); a
 *    non-Arabic token filters fluency fail-closed — teachers with no
 *    recorded fluency are never shown to a language-filtered caller. A
 *    token that is empty after normalization, over the length cap, or
 *    carrying a quote or backslash rejects BEFORE any pattern is built.
 *  - One escape point: each match token is enum-validated or
 *    character-gated first, then wrapped in JSON quotes (the quoted-token
 *    anchor that keeps `"hifz"` from matching `"hifz_jadid"`), escaped
 *    through `escapeLikeWildcards`, and wrapped in `%…%`. The repository
 *    binds the finished patterns verbatim and never re-escapes.
 *  - Fail-closed projection: raw row payloads map through the shared
 *    teacher-profile parsers, so a corrupt stored payload degrades only
 *    its own field (empty arrays, null rating) and never fails the page.
 *  - Pure read: the method opens no transaction of its own — the caller's
 *    executor is joined when supplied, the global handle otherwise — and
 *    every returned item is projected member-by-member, never spread.
 *  - Snapshot semantics: a browse is a POINT-IN-TIME read. Availability,
 *    certification, session state, and ratings can change the moment the
 *    query returns; the session-request flow MUST re-assert the chosen
 *    teacher's availability (`is_online` + `is_approved`) under its own
 *    locking transaction before booking. This read never holds locks and
 *    never substitutes for that re-assertion.
 *  - Logging: the happy path emits NOTHING. Each caller-miss denial emits
 *    exactly ONE bounded `logger.logDomainError` entry carrying
 *    `{ code, entity, entityId, locale }` only — never PII, never the
 *    submitted choices. All denial copy resolves through
 *    `getServerTranslations(locale).errorsTranslations` (the one-arg
 *    bundle + property access); no hardcoded messages, and the console
 *    is never touched.
 */

import {
  type NormalizedTeacherMatchingFilters,
  StudentRepository,
  type TeacherMatchingRowType,
  TeacherRepository,
  UserRepository,
} from "@/backend/db/repo";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { resolvePageBounds } from "@/backend/services/admin/user-management.query.helpers";
import {
  parseAverageRating,
  parseSubjectsJson,
  parseTeacherLanguages,
  parseTeacherRecitations,
} from "@/backend/services/teachers/teacher-profile.mappers";
import type {
  DBQueryExecutor,
  StudentSelectType,
  TeacherMatchingIntent,
  TeacherMatchingItemReturnType,
  TeacherMatchingPageReturnType,
  TeacherMatchingStudentContext,
  TeacherMatchingSubmitInput,
  UserSelectType,
} from "@/backend/types";
import { isRecitationReading } from "@/shared/constants/recitation-reading.enum";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Arabic-baseline tokens — a caller whose resolved language normalizes to
 * one of these browses WITHOUT a language hard filter. Arabic is the
 * platform's default teaching language, so fluency beyond it is optional
 * for the Arabic-baseline caller and mandatory for everyone else.
 */
const ARABIC_LANGUAGE_TOKENS: ReadonlySet<string> = new Set(["arabic", "ar", "عربي", "العربية"]);

/**
 * Maximum normalized language-token length. The cap sits below the
 * `students` free-text column width and keeps the quoted-token pattern a
 * bounded, index-friendly literal.
 */
const MAX_LANGUAGE_TOKEN_LENGTH = 50;

/**
 * The student browse intent vocabulary. The staff-driven evaluation flow
 * is NOT a browse intent — a browse must name the subject the student
 * wants to study (hifz or tajweed). Typed over the WIRE vocabulary
 * (`SessionIntent`) so the exported narrowing guard below can probe any
 * client-supplied intent before it is trusted as a browse choice.
 */
const INTENT_TOKENS: ReadonlySet<SessionIntent> = new Set([SessionIntent.Hifz, SessionIntent.Tajweed]);

/**
 * The browse sort vocabulary — a Set probe over the `TeacherMatchingSort`
 * members (the enum-safety lookup discipline). A transport value outside
 * the member set denies before any pattern is built; an honest member
 * flows through as the post-tier ordering choice.
 */
const SORT_TOKENS: ReadonlySet<TeacherMatchingSort> = new Set([
  TeacherMatchingSort.RatingDesc,
  TeacherMatchingSort.NameAsc,
  TeacherMatchingSort.Newest,
]);

/**
 * Maximum normalized name-search length. The cap keeps the plain
 * `%…%` substring pattern a bounded, index-friendly literal (mirrors the
 * language-token cap discipline).
 */
const MAX_SEARCH_LENGTH = 80;

/**
 * Type guard — narrows a wire `SessionIntent` to the student browse
 * vocabulary (`hifz` | `tajweed`). The staff-driven evaluation flow is
 * never a browse intent, so a client-supplied `evaluation` value is not a
 * browse choice. The GraphQL resolver uses this belt for TypeScript
 * narrowing (its localized denial is unreachable for honest clients — the
 * UI offers only the two browse intents); the service re-validates every
 * submission against the same set (defense-in-depth), so the guard can
 * never widen what the pipeline accepts.
 */
export function isBrowseIntent(value: SessionIntent): value is TeacherMatchingIntent {
  return INTENT_TOKENS.has(value);
}

/**
 * Field-by-field assembly of the caller's matching context from the two
 * resolved rows. The country pair drives the soft ordering tier, the
 * profile languages drive the language resolution — and nothing else is
 * carried forward (the raw rows never reach the query builder).
 */
function toStudentContext(caller: UserSelectType, student: StudentSelectType): TeacherMatchingStudentContext {
  return {
    primaryLanguage: student.primaryLanguage,
    anotherLanguage: student.anotherLanguage,
    countryCode: caller.countryCode,
    country: caller.country,
  };
}

/**
 * Resolves the caller's profile languages to the browse's language-filter
 * token, or `null` when NO language filter applies. The primary language
 * wins over the secondary; the raw token is trimmed and lowercased before
 * any comparison, and a token that is empty after normalization, over the
 * length cap, or carrying a quote or backslash rejects with the localized
 * `ValidationError` — the character gate runs BEFORE the pattern builder
 * ever sees the token. An Arabic-baseline token (or an entirely absent
 * profile) returns `null`: no fluency constraint is applied.
 *
 * @returns The normalized non-Arabic token to hard-filter on, or `null`
 *     when the browse must not constrain fluency.
 */
function resolveRequestedLanguage(
  primaryLanguage: string | null,
  anotherLanguage: string | null,
  denialMessage: string
): string | null {
  const rawToken = primaryLanguage ?? anotherLanguage;
  if (rawToken === null) {
    return null;
  }

  const normalized = rawToken.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_LANGUAGE_TOKEN_LENGTH ||
    normalized.includes('"') ||
    normalized.includes("\\")
  ) {
    throw new ValidationError(denialMessage);
  }

  return ARABIC_LANGUAGE_TOKENS.has(normalized) ? null : normalized;
}

/**
 * Builds the finished quoted-token match pattern for one validated or
 * gated token — the pipeline's SINGLE escape point. The token is wrapped
 * in JSON quotes first (the token-boundary anchor that keeps `"hifz"`
 * from matching `"hifz_jadid"` in a JSON-array payload), escaped for the
 * LIKE engine, and wrapped in `%…%`. The repository binds the finished
 * pattern verbatim and never re-escapes.
 */
function quotedTokenPattern(token: string): string {
  const quoted = `"${token}"`;
  return `%${escapeLikeWildcards(quoted)}%`;
}

/**
 * Resolves the student's name-search choice into the finished
 * `%…%` LIKE pattern for the display-name column, or `null` when no
 * search applies. The raw value is trimmed; an empty remainder is "no
 * search"; a remainder over the length cap denies with the localized
 * `ValidationError`.
 *
 * Unlike the token patterns there is NO JSON quoting: `users.full_name`
 * is a plain varchar — a free-text SUBSTRING match is the contract, and
 * the quoted-token anchor that separates JSON-array members would only
 * narrow the match dishonestly. `escapeLikeWildcards` still runs (the
 * single escape point) so a caller's `%`/`_`/`\` match literally.
 *
 * @returns The escaped `%…%` pattern bound verbatim by the repository,
 *     or `null` when the browse carries no name constraint.
 */
function resolveNameSearchPattern(search: string | null, denialMessage: string): string | null {
  if (search === null) {
    return null;
  }
  const trimmed = search.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_SEARCH_LENGTH) {
    throw new ValidationError(denialMessage);
  }
  return `%${escapeLikeWildcards(trimmed)}%`;
}

/**
 * Resolves the student's minimum-rating choice, or `null` when no floor
 * applies. The floor must be a finite number within the rating scale
 * (`0..5` — the same clamp the cached-rating write enforces at the
 * database); anything else (NaN/±Infinity, out of bounds) denies with the
 * localized `ValidationError` before any database work.
 *
 * The floor is applied as an HONEST SQL `>=` comparison downstream: a
 * NULL `average_rating` never satisfies it, so a floor excludes unrated
 * teachers by construction — the explicit product choice, never a
 * `coalesce` into a fabricated zero.
 *
 * @returns The validated floor, or `null` when the browse is unbounded.
 */
function resolveMinRating(minRating: number | null, denialMessage: string): number | null {
  if (minRating === null) {
    return null;
  }
  if (!Number.isFinite(minRating) || minRating < 0 || minRating > 5) {
    throw new ValidationError(denialMessage);
  }
  return minRating;
}

/**
 * Fail-closed projection of one raw matching row into the closed
 * student-facing card. The JSON-in-varchar payload columns map through
 * the shared teacher-profile parsers (a corrupt payload degrades its own
 * field to an empty array), the decimal rating parses to its float value
 * (unrated stays an honest `null`), and a missing availability flag reads
 * as `false`. The function never spreads the raw row; only the nine
 * whitelisted members are mapped.
 */
function toMatchingItem(row: TeacherMatchingRowType): TeacherMatchingItemReturnType {
  return {
    id: row.id,
    fullName: row.fullName,
    country: row.country,
    countryCode: row.countryCode,
    subjects: parseSubjectsJson(row.subjects),
    recitations: parseTeacherRecitations(row.recitations),
    languages: parseTeacherLanguages(row.languages),
    averageRating: parseAverageRating(row.averageRating),
    isOnline: row.isOnline ?? false,
  };
}

export namespace TeacherMatchingService {
  /**
   * Browses the teachers eligible for an instant session, filtered and
   * sorted by the matching pipeline.
   *
   * Ordered contract:
   *  1. A non-null recitation choice is validated against the shared
   *     catalog and a non-null intent against the student browse
   *     vocabulary (a `null` on either means "no constraint" and skips
   *     its probe), and the sort against the `TeacherMatchingSort`
   *     member set — a malformed choice denies with the localized
   *     `ValidationError` before any database work.
   *  2. Pagination bounds resolve through the canonical bounds resolver
   *     (explicit `null` inputs restore the defaults).
   *  3. The caller's own `users` row then `students` row resolve by the
   *     authenticated id only; either miss denies with the localized
   *     caller-miss `NotFoundError` (a teacher/parent/admin user has no
   *     `students` row and must learn nothing else).
   *  4. The language filter token resolves from the caller's own profile
   *     (primary first, then the secondary; Arabic baseline applies no
   *     filter).
   *  5. The optional name search (plain substring — escaped at this single
   *     point, no JSON quoting on a non-JSON column) and the optional
   *     minimum-rating floor (finite, 0..5; an honest SQL `>=` that
   *     excludes the unrated when set) resolve into their filter members.
   *  6. The finished quoted-token patterns are built — escaped at this
   *     single point — for the supplied narrowing filters only (a `null`
   *     recitation or intent resolves to a `null` pattern and its
   *     predicate drops out of the chain), and the repository read
   *     returns the eligible page ordered country-tier first (ALWAYS),
   *     then the chosen post-tier sort key (`sort`; rating desc nulls
   *     last by default), then the deterministic id tiebreak.
   *  7. Rows project through the fail-closed parsers into the closed
   *     nine-field card; an empty eligible set returns an honest empty
   *     page, never an error.
   *
   * The happy path emits NOTHING. Each caller-miss denial emits exactly
   * ONE bounded `logger.logDomainError` entry carrying
   * `{ code, entity, entityId, locale }` only.
   *
   * @param studentUserId  The browsing student's id (shared PK with
   *     `users.id`; at the API boundary it is the authenticated caller's
   *     id, never a client-supplied argument).
   * @param input  The per-browse choices: the nullable recitation and
   *     intent narrowing filters (`null` drops the predicate), the
   *     nullable page/pageSize pair (`null` restores the defaults), the
   *     nullable name search / minimum-rating floor, and the post-tier
   *     sort choice (the wire default is `RATING_DESC`).
   * @param locale  Active request locale (for the localized denial copy).
   * @param tx  Optional outer executor. The browse is a pure read: when
   *     supplied it runs on the caller's executor (same snapshot as any
   *     surrounding work), otherwise on the global handle. No transaction
   *     is ever opened here.
   * @returns The ordered page envelope: the projected teacher cards, the
   *     unfiltered-by-page honest `total`, the resolved page bounds, and
   *     `pageCount = Math.ceil(total / pageSize)` (zero for an empty set).
   */
  export async function browseAvailableTeachers(
    studentUserId: number,
    input: TeacherMatchingSubmitInput,
    locale: string,
    tx?: DBQueryExecutor
  ): Promise<TeacherMatchingPageReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    if (input.recitation !== null && !isRecitationReading(input.recitation)) {
      throw new ValidationError(t.validation);
    }
    if (input.intent !== null && !INTENT_TOKENS.has(input.intent)) {
      throw new ValidationError(t.validation);
    }
    if (!SORT_TOKENS.has(input.sort)) {
      throw new ValidationError(t.validation);
    }

    const { resolvedPage, resolvedPageSize, offset } = resolvePageBounds(
      input.page ?? 1,
      input.pageSize ?? undefined,
      locale
    );

    const caller = await UserRepository.findById(studentUserId, tx);
    if (caller === null) {
      logger.logDomainError("Matching browse denied: no user record for caller", {
        code: "STUDENT_NOT_FOUND",
        entity: "students",
        entityId: studentUserId,
        locale,
      });
      throw new NotFoundError("STUDENT", t.studentHandshakeNotFound);
    }

    const student = await StudentRepository.findById(studentUserId, tx);
    if (student === null) {
      logger.logDomainError("Matching browse denied: no student record for caller", {
        code: "STUDENT_NOT_FOUND",
        entity: "students",
        entityId: studentUserId,
        locale,
      });
      throw new NotFoundError("STUDENT", t.studentHandshakeNotFound);
    }

    const context = toStudentContext(caller, student);
    const requestedLanguage = resolveRequestedLanguage(context.primaryLanguage, context.anotherLanguage, t.validation);

    // Enum-validated / character-gated tokens only — the patterns are
    // built at the single escape point and bound by the repository
    // verbatim (never re-escaped downstream). A `null` recitation or
    // intent resolves to a `null` pattern and its predicate drops out of
    // the WHERE chain. The name search and the rating floor resolve
    // through their own pure validators; `sort` is already a probed
    // enum member (the post-tier ordering key).
    const filters: NormalizedTeacherMatchingFilters = {
      recitationPattern: input.recitation === null ? null : quotedTokenPattern(input.recitation),
      subjectPattern: input.intent === null ? null : quotedTokenPattern(input.intent),
      languagePattern: requestedLanguage === null ? null : quotedTokenPattern(requestedLanguage),
      namePattern: resolveNameSearchPattern(input.search, t.validation),
      minRating: resolveMinRating(input.minRating, t.validation),
      sort: input.sort,
      studentCountryCode: context.countryCode,
      studentCountryText: context.country,
    };

    const { rows, total } = await TeacherRepository.listMatchingCandidates(filters, resolvedPageSize, offset, tx);

    return {
      items: rows.map(toMatchingItem),
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      pageCount: Math.ceil(total / resolvedPageSize),
    };
  }
}
