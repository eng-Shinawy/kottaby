/**
 * TeacherRepository filter-chain helpers — the module-private WHERE-chain
 * builders shared by the teacher repository's listing reads, extracted to
 * keep `teacher.repository.ts` under the oxlint `max-lines` budget
 * (backend/db/repo/AGENTS.md: one namespace per repository file; helpers
 * ride sibling `*.repository.*.helpers.ts` modules like the session repo's
 * `session.repository.helpers.ts`).
 *
 * These builders are pure Drizzle `sql` composition — no execution, no
 * business logic, no permission checks (repository-layer discipline per
 * `backend/db/repo/AGENTS.md`). They are consumed ONLY by
 * `teacher.repository.ts`; the filter-shape types stay in the repository
 * module (the service layer imports them from there).
 *
 * Binding discipline (both chains): every filter value reaches the query
 * as a Drizzle-bound parameter — patterns arrive pre-escaped and pre-wrapped
 * from the service (the single escape point), and are bound verbatim via
 * `ilike`; no string interpolation of caller data, no re-escaping.
 */
import { and, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type {
  NormalizedAdminTeacherFilters,
  NormalizedTeacherMatchingFilters,
} from "@/backend/db/repo/teachers/teacher.repository";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";

/**
 * Builds the ANDed WHERE chain from the normalized teacher-directory
 * filters. Absent or null members are skipped (the directory falls back to
 * the unfiltered listing rather than erroring). The `searchPattern` is
 * bound directly to two `ilike` predicates — one over the user's full
 * name, one over the email — joined by `OR` so a single search term
 * matches either column. No string interpolation; the pattern is
 * Drizzle-parameterized.
 */
export function buildTeacherDirectoryFilterChain(filters: NormalizedAdminTeacherFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.searchPattern) {
    conditions.push(
      or(ilike(users.fullName, filters.searchPattern), ilike(users.email, filters.searchPattern)) ?? sql`false`
    );
  }
  if (filters.isApproved !== null && filters.isApproved !== undefined) {
    conditions.push(eq(teacher.isApproved, filters.isApproved));
  }
  if (filters.isOnline !== null && filters.isOnline !== undefined) {
    conditions.push(eq(teacher.isOnline, filters.isOnline));
  }
  if (filters.isEvaluator !== null && filters.isEvaluator !== undefined) {
    conditions.push(eq(teacher.isEvaluator, filters.isEvaluator));
  }
  if (conditions.length === 0) {
    return undefined;
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return and(...conditions) ?? sql`true`;
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
 *  - the recitation and subject quoted-token patterns match (the subject
 *    vocabulary IS the session-intent vocabulary).
 * The language predicate joins the chain only when a pattern was resolved;
 * `null` means no language constraint and leaves the chain unchanged.
 */
export function buildTeacherMatchingFilterChain(filters: NormalizedTeacherMatchingFilters): SQL {
  const chain = and(
    eq(teacher.isOnline, true),
    eq(teacher.isApproved, true),
    sql`${users.isDeleted} is distinct from true and ${users.suspended} is distinct from true and ${users.isBlocked} is distinct from true`,
    ilike(teacher.recitations, filters.recitationPattern),
    ilike(teacher.subjects, filters.subjectPattern),
    sql`not exists (select 1 from ${session} where ${session.teacherId} = ${teacher.id} and ${session.status} = ${SessionStatus.Started})`,
    filters.languagePattern === null ? undefined : ilike(teacher.languages, filters.languagePattern)
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
export function buildTeacherMatchingCountryTier(filters: NormalizedTeacherMatchingFilters): SQL {
  if (filters.studentCountryCode !== null) {
    return sql`case when ${users.countryCode} = ${filters.studentCountryCode} then 0 else 1 end`;
  }
  return filters.studentCountryText !== null
    ? sql`case when lower(${users.country}) = lower(${filters.studentCountryText}) then 0 else 1 end`
    : sql`1 = 1`;
}
