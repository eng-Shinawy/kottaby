import type { lessons } from "@/backend/db/schema/classes/lessons";

export type LessonSelectType = typeof lessons.$inferSelect;
export type LessonInsertType = typeof lessons.$inferInsert;

/**
 * Canonical read shape for a lesson row — identical to `LessonSelectType`:
 * no forbidden fields and no enum re-typing. `planId` stays nullable in the
 * read shape (a standalone lesson whose plan was deleted is a normal state —
 * the plan FK deletes with SET NULL), and `title` stays nullable per the
 * schema ground truth.
 */
export type LessonReturnType = typeof lessons.$inferSelect;

export interface LessonSubmitInput {
  readonly planId: number;
  readonly title: string;
}

export type LessonUpdateInput = Partial<LessonSubmitInput>;
