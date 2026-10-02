import type { progress } from "@/backend/db/schema/classes/progress";

export type ProgressSelectType = typeof progress.$inferSelect;
export type ProgressInsertType = typeof progress.$inferInsert;

/** Read-model DTO for the studentProgress query — computed, never a row spread. */
export interface StudentProgressReturnType {
  readonly hasProgress: boolean;
  readonly studentId: number;
  readonly planId: number | null;
  readonly planTitle: string | null;
  readonly totalLessons: number;
  readonly currentLessonId: number | null;
  readonly currentLessonTitle: string | null;
  /** 1-based position in the plan's id-ASC sequence; null when hasProgress=false. */
  readonly currentLessonPosition: number | null;
  readonly lessonsCompleted: number;
  /** integer, floor(lessonsCompleted * 100 / totalLessons); 0 when totalLessons = 0. */
  readonly completionPercent: number;
  readonly isOnFinalLesson: boolean;
}
