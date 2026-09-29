"use client";

/**
 * TeacherPrepDialog — the read-only pre-session preparation dialog a
 * teacher opens from a scheduled session row before starting it. This file
 * is the orchestrator only: it wires the query bundle
 * (`useTeacherPrepQueries`) → the pure helpers → the presentational parts.
 * Zero derivation of its own and zero write affordances — the two reads
 * are student-keyed, and every display value comes from the query payloads
 * through the helpers.
 *
 * Two translation handles are composed here because the hook takes exactly
 * one namespace: the dialog chrome speaks `sessions`, the homework rows
 * speak `homework` (one Jadid/Madi vocabulary across the homework
 * surfaces). The two sections branch independently — one section's failure
 * never blanks the other — and the content announces busy semantics while
 * either read is in flight.
 */

import { Dialog, DialogContent, DialogTitle, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { PrepProgressCard } from "@/frontend/views/teacher/sessions/TeacherPrepDialog.parts";
import { PrepHomeworkList } from "@/frontend/views/teacher/sessions/TeacherPrepHomeworkList";
import {
  resolveHiddenHomeworkCount,
  resolvePrepHomeworkRows,
  resolvePrepSection,
} from "@/frontend/views/teacher/sessions/teacherPrepDialog.helpers";
import { useTeacherPrepQueries } from "@/frontend/views/teacher/sessions/useTeacherPrepQueries";
import { Homework, Sessions, useAppTranslation } from "@/shared/locale";

export interface TeacherPrepDialogProps {
  readonly open: boolean;
  /** The student the session was booked with, derived by the mount from the
   *  cached session row (server data — never caller input). */
  readonly studentId: number | null;
  /** The owning session row's id — the mount keys this dialog by it; the
   *  two reads below are student-keyed and do not consume it. */
  readonly sessionId: string;
  readonly onClose: () => void;
}

export function TeacherPrepDialog({ open, studentId, onClose }: Readonly<TeacherPrepDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const th = useAppTranslation(Homework);
  const { progressQuery, homeworkQuery, loading } = useTeacherPrepQueries({ open, studentId });

  const progress = progressQuery.data?.studentProgress ?? null;
  const section = progress === null ? null : resolvePrepSection(progress);
  const homeworkPage = homeworkQuery.data?.studentHomeworkHistory ?? null;
  const rows = homeworkPage === null ? [] : resolvePrepHomeworkRows(homeworkPage.items);
  const hiddenCount = homeworkPage === null ? 0 : resolveHiddenHomeworkCount(homeworkPage.totalCount, rows.length);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="teacher-prep-dialog-title">
      <DialogTitle id="teacher-prep-dialog-title">{t.prepDialogTitle}</DialogTitle>
      <DialogContent aria-busy={loading} sx={{ display: "grid", gap: 3 }}>
        {studentId === null ? null : (
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.prepStudentLabel} #{studentId}
          </Typography>
        )}
        <PrepProgressCard
          section={section}
          loading={progressQuery.loading}
          error={progressQuery.error}
          onRetry={() => {
            void progressQuery.refetch().catch(() => undefined);
          }}
          t={t}
        />
        <PrepHomeworkList
          rows={rows}
          hiddenCount={hiddenCount}
          called={studentId !== null}
          loading={homeworkQuery.loading}
          error={homeworkQuery.error}
          onRetry={() => {
            void homeworkQuery.refetch().catch(() => undefined);
          }}
          t={t}
          th={th}
        />
        <Typography
          variant="caption"
          sx={theme => ({
            color: theme.palette.text.secondary,
            borderTop: `1px solid ${theme.palette.divider}`,
            paddingTop: 1.5,
          })}
        >
          {t.prepReadonlyHint}
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
