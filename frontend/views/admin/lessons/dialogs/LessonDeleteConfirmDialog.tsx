/**
 * LessonsDeleteConfirmDialog — Modal dialog confirming lesson deletion.
 *
 * Clone of the plans-admin `PlanStatusConfirmDialog` lineage, translated to
 * lessons (a single destructive flow instead of activate/deactivate).
 * Handles:
 *  - In-flight pending state (disabling actions)
 *  - Names the target lesson (localized label + title) in the confirm body
 *  - Inline error alert (LESSON_NOT_FOUND, etc. — server-localized message)
 */

"use client";

import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { ConfirmDialogBody } from "@/frontend/views/admin/shared/ConfirmDialogBody";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

type LessonItem = PlanLessonsQuery["planLessons"][number];

export interface LessonsDeleteConfirmDialogProps {
  readonly open: boolean;
  readonly lesson: LessonItem | null;
  readonly loading: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (lesson: LessonItem) => Promise<void>;
}

export function LessonsDeleteConfirmDialog({
  open,
  lesson,
  loading,
  error,
  onClose,
  onConfirm,
}: LessonsDeleteConfirmDialogProps): React.ReactElement | null {
  const t = useAppTranslation(Lessons);

  if (!lesson) {
    return null;
  }

  const handleConfirm = async (): Promise<void> => {
    await onConfirm(lesson);
  };

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="lesson-delete-confirm-title"
    >
      <DialogTitle id="lesson-delete-confirm-title" sx={{ fontWeight: 600 }}>
        {t.confirmDeleteTitle}
      </DialogTitle>
      <DialogContent>
        <ConfirmDialogBody
          error={error}
          message={t.confirmDeleteMessage}
          entityLabel={`${t.titleFieldLabel}: ${lesson.title ?? "—"}`}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="outlined" onClick={onClose} color="inherit" disabled={loading}>
          {t.cancelButton}
        </Button>
        <Button
          color="error"
          onClick={handleConfirm}
          disabled={loading}
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {t.confirmButton}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
