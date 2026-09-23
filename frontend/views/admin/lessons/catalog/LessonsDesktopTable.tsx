/**
 * LessonsDesktopTable — Desktop table view (visible md and up) for the admin
 * lessons catalog.
 *
 * Built on the shared `AdminDesktopTable` scaffold (row rendering inlined —
 * a lesson row carries title + created + actions).
 *  - Null-guarded title render (wire-nullable `Lesson.title`)
 *  - Row-level action buttons (Edit, Delete) with pending state
 *  - Theme-callback token styling (zero hardcoded hex/strings)
 */

"use client";

import { DeleteOutlined as DeleteIcon, EditOutlined as EditIcon } from "@mui/icons-material";
import { IconButton, Stack, TableBody, TableCell, TableRow, Tooltip } from "@mui/material";
import { AdminDesktopTable } from "@/frontend/components/ui/AdminDesktopTable";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { formatPlanDate } from "@/frontend/views/admin/plans/catalog/planCatalogFormatting";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

type LessonItem = PlanLessonsQuery["planLessons"][number];

export interface LessonsDesktopTableProps {
  readonly lessons: readonly LessonItem[];
  readonly actionLoadingId?: string | null;
  readonly onEdit: (lesson: LessonItem) => void;
  readonly onDelete: (lesson: LessonItem) => void;
}

export function LessonsDesktopTable({
  lessons,
  actionLoadingId,
  onEdit,
  onDelete,
}: LessonsDesktopTableProps): React.ReactElement {
  const t = useAppTranslation(Lessons);

  return (
    <AdminDesktopTable
      ariaLabel={t.pageTitle}
      headers={[{ label: t.titleColumn }, { label: t.createdAtColumn }, { label: t.actionsColumn }]}
    >
      <TableBody>
        {lessons.map(lesson => {
          const isActionPending = actionLoadingId === lesson.id;
          const editLabel = lesson.title ? `${t.editLessonButton} ${lesson.title}` : t.editLessonButton;
          const deleteLabel = lesson.title ? `${t.deleteLessonButton} ${lesson.title}` : t.deleteLessonButton;
          return (
            <TableRow key={lesson.id} hover sx={{ "&:last-child td, &:last-child th": { border: 0 } }}>
              <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                {lesson.title ?? "—"}
              </TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{formatPlanDate(lesson.createdAt, "—")}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                <Stack sx={{ flexDirection: "row", gap: 0.5, alignItems: "center" }}>
                  <Tooltip title={t.editLessonButton}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={editLabel}
                        onClick={() => onEdit(lesson)}
                        disabled={isActionPending}
                        sx={theme => ({
                          ...focusVisibleRingSx,
                          width: 44,
                          height: 44,
                          color: theme.palette.primary.main,
                        })}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t.deleteLessonButton}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={deleteLabel}
                        onClick={() => onDelete(lesson)}
                        disabled={isActionPending}
                        sx={theme => ({
                          ...focusVisibleRingSx,
                          width: 44,
                          height: 44,
                          color: theme.palette.error.main,
                        })}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </AdminDesktopTable>
  );
}
