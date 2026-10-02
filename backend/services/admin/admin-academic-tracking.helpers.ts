/**
 * Admin academic tracking helpers — the pure attention-flag composer and
 * the pre-read pagination/id validation behind the admin academic
 * dashboard and drill-down surfaces.
 *
 * Everything here is side-effect-free computation over repository output
 * plus the caller's captured snapshot instant: no I/O, no reads, no
 * writes, no persistence (the attention flag is recomputed per request
 * and never stored). The validation helpers are the ONLY throwing members
 * — they reject before any database work happens, so a malformed
 * `page`/`pageSize`/`studentId` can never reach the repository layer.
 *
 * Localization: validation denials resolve their message through
 * `getServerTranslations(locale).errorsTranslations` (property access,
 * never key-concatenated lookup) — no hardcoded user-facing copy.
 */

import { ValidationError } from "@/backend/lib/errors";
import {
  NEEDS_ATTENTION_LOW_AVG_GRADE,
  NEEDS_ATTENTION_RECENT_WINDOW,
  NEEDS_ATTENTION_STALE_DAYS,
} from "@/backend/services/admin/admin-academic-tracking.constants";
import type {
  AdminAcademicAttentionFlagReturnType,
  AdminAcademicAttentionReason,
  AdminAcademicAttentionSignalSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Default page bound applied when the caller omits `page`. */
const DEFAULT_PAGE = 1;

/** Default page bound applied when the caller omits `pageSize`. */
const DEFAULT_PAGE_SIZE = 25;

/** Inclusive upper ceiling on `pageSize` — the directory pagination bound. */
const MAX_PAGE_SIZE = 100;

/** Milliseconds in one day — the staleness window arithmetic unit. */
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolves + validates the dashboard pagination bounds BEFORE any
 * database read. `page` must be an integer ≥ 1 (default 1 when absent);
 * `pageSize` must be an integer in `1..100` (default 25 when absent).
 * Violations throw a localized `ValidationError` and nothing is read.
 *
 * An out-of-range page that PASSES this guard (e.g. page 9 of 3) is not a
 * rejection: the listing returns empty `items` next to the honest `total`
 * — never an error, never a clamped window.
 *
 * @returns The effective bounds plus the SQL `offset` the repository
 *          listing reads from.
 */
export function resolveAcademicTrackingPageBounds(
  page: number | undefined | null,
  pageSize: number | undefined | null,
  locale: string
): { page: number; pageSize: number; offset: number } {
  const resolvedPage = page ?? DEFAULT_PAGE;
  const resolvedPageSize = pageSize ?? DEFAULT_PAGE_SIZE;
  const tErrors = getServerTranslations(locale).errorsTranslations;

  if (!Number.isInteger(resolvedPage) || resolvedPage < DEFAULT_PAGE) {
    throw new ValidationError(tErrors.validation);
  }
  if (!Number.isInteger(resolvedPageSize) || resolvedPageSize < 1 || resolvedPageSize > MAX_PAGE_SIZE) {
    throw new ValidationError(tErrors.validation);
  }

  return { page: resolvedPage, pageSize: resolvedPageSize, offset: (resolvedPage - 1) * resolvedPageSize };
}

/**
 * Validates the drill-down `studentId` — the surface's ONLY
 * client-supplied data-scoping argument — as a positive integer BEFORE
 * any database read. Malformed values (zero, negative, fractional, or
 * non-finite) throw a localized `ValidationError`; the caller's identity
 * always comes from the authenticated context, never from this argument.
 */
export function assertAcademicStudentId(studentId: number, locale: string): void {
  if (!Number.isInteger(studentId) || studentId < 1) {
    throw new ValidationError(getServerTranslations(locale).errorsTranslations.validation);
  }
}

/**
 * Composes the per-student attention flag from the student's attention
 * signal and the snapshot instant — the pure heart of the "students
 * needing attention" rules. Both reasons may co-occur on one student and
 * are reported in the canonical order (`lowGrade` first, `staleProgress`
 * second). A student with NO crossed thresholds has no flag object at all
 * (the enclosing field stays `null`), and a student absent from the
 * signals list is never flagged — absence is not evidence.
 *
 *  - `lowGrade`: the average of the student's newest graded Jadid grades
 *    (newest first, at most {@linkcode NEEDS_ATTENTION_RECENT_WINDOW}
 *    values) is strictly below {@linkcode NEEDS_ATTENTION_LOW_AVG_GRADE}.
 *    Fewer grades average over what exists; zero graded Jadid rows skip
 *    the arm entirely (absence of grades is not failure).
 *  - `staleProgress`: the student has at least one completed session AND
 *    no graded activity inside the staleness window. The anchor is the
 *    newest graded row's grade-write stamp, falling back to the newest
 *    assignment's creation stamp for never-graded students; an anchor of
 *    `null` (no homework rows at all) is trivially stale — zero graded
 *    rows have ever existed. Activity at exactly the boundary counts as
 *    inside the window (the flag fires only strictly beyond
 *    {@linkcode NEEDS_ATTENTION_STALE_DAYS} days).
 *
 * The signal's grade window is bounded HERE by the service constant (not
 * by caller arguments, and re-bounded even though the repository sizes
 * its window to match) so this module remains the single authority on the
 * threshold semantics.
 *
 * @param signal The student's per-request attention signal, or `undefined`
 *               when the student carried no signal row.
 * @param now    The single captured transaction timestamp every student on
 *               the snapshot is measured against.
 * @returns The flag carrying the crossed reasons, or `null` when the
 *          student is not flagged.
 */
export function composeAcademicAttentionFlag(
  signal: AdminAcademicAttentionSignalSelectType | undefined,
  now: Date
): AdminAcademicAttentionFlagReturnType | null {
  if (signal === undefined) {
    return null;
  }

  const reasons: AdminAcademicAttentionReason[] = [];

  const recentGrades = signal.recentGradedJadidGrades.slice(0, NEEDS_ATTENTION_RECENT_WINDOW);
  if (recentGrades.length > 0) {
    const gradeSum = recentGrades.reduce((sum, grade) => sum + grade, 0);
    if (gradeSum / recentGrades.length < NEEDS_ATTENTION_LOW_AVG_GRADE) {
      reasons.push("lowGrade");
    }
  }

  if (signal.completedSessionCount >= 1) {
    const lastActivityAt = signal.lastGradedHomeworkAt ?? signal.lastHomeworkAssignedAt;
    const windowStart = now.getTime() - NEEDS_ATTENTION_STALE_DAYS * MILLIS_PER_DAY;
    if (lastActivityAt === null || lastActivityAt.getTime() < windowStart) {
      reasons.push("staleProgress");
    }
  }

  return reasons.length === 0 ? null : { reasons };
}
