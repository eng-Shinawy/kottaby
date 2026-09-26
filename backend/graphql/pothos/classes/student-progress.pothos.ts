/**
 * StudentProgressPothosObject — the canonical GraphQL object type for the
 * `studentProgress` read.
 *
 * Backed exclusively by `StudentProgressReturnType` from `@/backend/types`
 * (zero local types). The DTO is a computed read-model — a per-student
 * curriculum-position payload assembled field-by-field by the service, never
 * a row spread — so every field below is consumer-safe by construction and
 * nothing beyond it reaches the wire. No business logic in this module — the
 * query resolver delegates to `StudentProgressService`.
 *
 * Nullability mirrors the DTO exactly (Pothos defaults non-nullable): the
 * plan echo (`planId`/`planTitle`) and the current-lesson trio
 * (`currentLessonId`/`currentLessonTitle`/`currentLessonPosition`) are
 * `| null` in the type, so each carries `nullable: true` here. The object is
 * an embedded value object — it carries NO `id` field (the natural cache key
 * is the echoed `studentId`, and the type registers nothing that is not in
 * the canonical DTO). Flat root projection — no per-parent fan-out, so no
 * DataLoader (`t.loadable`) applies.
 *
 * Consumed by the `studentProgress` query resolver module, whose
 * side-effect import registers the type through the `gqlSchema.ts`
 * side-effect chain.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { StudentProgressReturnType } from "@/backend/types";

/**
 * The canonical `StudentProgress` GraphQL object type.
 */
export const StudentProgressPothosObject = gqlSchemaBuilder
  .objectRef<StudentProgressReturnType>("StudentProgress")
  .implement({
    description:
      "A student's curriculum position on their governing tajweed plan: the current lesson, the completed count, and the floor-computed completion percentage. Fields are null when no progress exists yet (hasProgress=false) — never fabricated.",
    fields: t => ({
      hasProgress: t.exposeBoolean("hasProgress"),
      studentId: t.exposeInt("studentId"),
      planId: t.exposeInt("planId", { nullable: true }),
      planTitle: t.exposeString("planTitle", { nullable: true }),
      totalLessons: t.exposeInt("totalLessons"),
      currentLessonId: t.exposeInt("currentLessonId", { nullable: true }),
      currentLessonTitle: t.exposeString("currentLessonTitle", { nullable: true }),
      currentLessonPosition: t.exposeInt("currentLessonPosition", { nullable: true }),
      lessonsCompleted: t.exposeInt("lessonsCompleted"),
      completionPercent: t.exposeInt("completionPercent"),
      isOnFinalLesson: t.exposeBoolean("isOnFinalLesson"),
    }),
  });
