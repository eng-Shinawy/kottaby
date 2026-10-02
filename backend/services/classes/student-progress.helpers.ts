/**
 * Student-progress helpers — the pure computation layer behind
 * `student-progress.service.ts`: the honest zero payload, the
 * pointer-position recovery rule, the single floor-percentage definition,
 * and the one structured skip-log shape shared by every increment no-op.
 *
 * Mirrors the sibling `lesson.helpers.ts` convention: consumed directly by
 * the sibling service via the sibling path — helpers stay out of the
 * domain barrel because they are service-internal. No I/O happens here
 * beyond the structured log; the service owns orchestration, persistence,
 * and authorization.
 */

import { logger } from "@/backend/lib/logger";
import type { LessonReturnType, ProgressSelectType, StudentProgressReturnType } from "@/backend/types";

/**
 * Composes the honest zero payload: `hasProgress: false`, every lesson
 * field null, zeroed counters. When the governing plan is known (an active
 * tajweed-lane subscription resolved) its id and title populate the plan
 * fields and `totalLessons` carries the plan's real lesson count — a
 * missing plan or an empty curriculum keeps the zeroed shape. Never
 * fabricates a position or a percentage.
 */
export function emptyProgress(
  studentId: number,
  plan?: { id: number; title: string | null } | null,
  totalLessons?: number
): StudentProgressReturnType {
  return {
    hasProgress: false,
    studentId,
    planId: plan?.id ?? null,
    planTitle: plan?.title ?? null,
    totalLessons: totalLessons ?? 0,
    currentLessonId: null,
    currentLessonTitle: null,
    currentLessonPosition: null,
    lessonsCompleted: 0,
    completionPercent: 0,
    isOnFinalLesson: false,
  };
}

/**
 * Resolves the pointer row's zero-based index in the plan's `id ASC`
 * lesson list. A null row, a null lesson reference, or a lesson that no
 * longer belongs to the list recovers to index 0 — the caller reads that
 * recovery as "positioned on the first lesson, pre-completion" (display)
 * or as the re-anchor precondition (increment), never as an error.
 */
export function computePosition(lessons: readonly LessonReturnType[], row: ProgressSelectType | null): { idx: number } {
  if (row?.lessonId == null) {
    return { idx: 0 };
  }
  const idx = lessons.findIndex(lesson => lesson.id === row.lessonId);
  return { idx: idx === -1 ? 0 : idx };
}

/**
 * The single floor-percentage definition shared by the read payload and
 * the journey expectations: `floor(lessonsCompleted * 100 / totalLessons)`,
 * and `0` for an empty curriculum (never a fabricated ratio).
 */
export function computePercent(lessonsCompleted: number, totalLessons: number): number {
  return totalLessons === 0 ? 0 : Math.floor((lessonsCompleted * 100) / totalLessons);
}

/**
 * The ONE logging shape for every increment no-op and re-anchor: exactly
 * one structured domain log carrying the machine reason plus the
 * session/student identity (ids only — never lesson rows or user fields).
 * System-log wording; no locale, never user-facing copy.
 */
export function logSkip(
  reason: "no-active-tajweed-subscription" | "no-lessons" | "pointer-reanchored",
  ctx: { sessionId?: number; studentId: number }
): void {
  logger.logDomainError(`Student progress advance skipped: ${reason}`, {
    code: "PROGRESS_SKIPPED",
    entity: "progress",
    sessionId: ctx.sessionId,
    studentId: ctx.studentId,
  });
}
