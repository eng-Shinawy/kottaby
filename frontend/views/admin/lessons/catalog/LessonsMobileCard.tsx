/**
 * LessonsMobileCard — Single mobile card for the admin lessons catalog.
 *
 * Clone of the plans-admin `PlanMobileCard` lineage, translated to lessons.
 * Renders the lesson title (null-guarded — wire-nullable `Lesson.title`), the
 * created date caption, and the Edit / Delete action buttons for mobile layouts.
 */

"use client";

import { DeleteOutlined as DeleteIcon, EditOutlined as EditIcon } from "@mui/icons-material";
import { Button, Card, CardActions, CardContent, Stack, Typography } from "@mui/material";
import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { formatPlanDate } from "@/frontend/views/admin/plans/catalog/planCatalogFormatting";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

type LessonItem = PlanLessonsQuery["planLessons"][number];

export interface LessonsMobileCardProps {
  readonly lesson: LessonItem;
  readonly actionLoadingId?: string | null;
  readonly onEdit: (lesson: LessonItem) => void;
  readonly onDelete: (lesson: LessonItem) => void;
}

export function LessonsMobileCard({
  lesson,
  actionLoadingId,
  onEdit,
  onDelete,
}: LessonsMobileCardProps): React.ReactElement {
  const t = useAppTranslation(Lessons);
  const isActionPending = actionLoadingId === lesson.id;

  return (
    <Card
      elevation={0}
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
      })}
    >
      <CardContent sx={{ pb: 1 }}>
        <Stack sx={{ mb: 1, alignItems: "flex-start" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {lesson.title ?? "—"}
          </Typography>
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, whiteSpace: "nowrap" })}>
            {t.createdAtColumn}: {formatPlanDate(lesson.createdAt, "—")}
          </Typography>
        </Stack>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2, pt: 0, justifyContent: "flex-end" }}>
        <Button
          size="small"
          startIcon={<EditIcon />}
          onClick={() => onEdit(lesson)}
          disabled={isActionPending}
          sx={{ minHeight: 44 }}
        >
          {t.editLessonButton}
        </Button>
        <Button
          size="small"
          startIcon={<DeleteIcon />}
          onClick={() => onDelete(lesson)}
          disabled={isActionPending}
          sx={theme => ({
            color: theme.palette.error.main,
            minHeight: 44,
          })}
        >
          {t.deleteLessonButton}
        </Button>
      </CardActions>
    </Card>
  );
}
