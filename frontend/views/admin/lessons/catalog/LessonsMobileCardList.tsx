/**
 * LessonsMobileCardList — Mobile card-stack view (visible below md) for the
 * admin lessons catalog.
 *
 * Clone of the plans-admin `PlanMobileCardList` lineage, translated to
 * lessons. Composes individual LessonsMobileCard items.
 */

"use client";

import { Box } from "@mui/material";
import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { LessonsMobileCard } from "@/frontend/views/admin/lessons/catalog/LessonsMobileCard";

type LessonItem = PlanLessonsQuery["planLessons"][number];

export interface LessonsMobileCardListProps {
  readonly lessons: readonly LessonItem[];
  readonly actionLoadingId?: string | null;
  readonly onEdit: (lesson: LessonItem) => void;
  readonly onDelete: (lesson: LessonItem) => void;
}

export function LessonsMobileCardList({
  lessons,
  actionLoadingId,
  onEdit,
  onDelete,
}: LessonsMobileCardListProps): React.ReactElement {
  return (
    <Box sx={{ display: { xs: "flex", md: "none" }, flexDirection: "column", gap: 2 }}>
      {lessons.map(lesson => (
        <LessonsMobileCard
          key={lesson.id}
          lesson={lesson}
          actionLoadingId={actionLoadingId}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </Box>
  );
}
