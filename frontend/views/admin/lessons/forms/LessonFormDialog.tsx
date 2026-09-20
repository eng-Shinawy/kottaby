/**
 * LessonFormDialog — Modal dialog for creating and editing curriculum lessons.
 *
 * Clone of the plans-admin `PlanFormDialog` lineage, translated to lessons.
 * Handles:
 *  - Unified create/edit flow (state re-initialized per target via `key`)
 *  - Server field-level errors on the title input (LessonFormContent)
 *  - In-flight double-submit mitigation (close disabled while loading)
 */

"use client";

import { Dialog } from "@mui/material";
import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { LessonFormContent } from "@/frontend/views/admin/lessons/forms/LessonFormContent";
import type { LessonFormSubmitInput } from "@/frontend/views/admin/lessons/hooks/useLessonFormDialog";

type LessonItem = PlanLessonsQuery["planLessons"][number];

export interface LessonFormDialogProps {
  readonly open: boolean;
  readonly lesson: LessonItem | null;
  readonly loading: boolean;
  readonly globalError?: string | null;
  readonly serverFieldErrors?: Record<string, string>;
  readonly onClose: () => void;
  readonly onSubmit: (input: LessonFormSubmitInput) => Promise<void>;
}

export function LessonFormDialog({
  open,
  lesson,
  loading,
  globalError,
  serverFieldErrors,
  onClose,
  onSubmit,
}: LessonFormDialogProps): React.ReactElement {
  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="lesson-form-dialog-title"
      slotProps={{
        backdrop: {
          sx: {
            // Scoped to this dialog: one step past MUI's 50% scrim plus a
            // subtle blur so the page behind reads as depth, not noise.
            backgroundColor: "color-mix(in srgb, var(--mui-palette-scrim) 60%, transparent)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
          },
        },
      }}
    >
      {open && (
        <LessonFormContent
          key={lesson?.id ?? "new"}
          lesson={lesson}
          loading={loading}
          globalError={globalError}
          serverFieldErrors={serverFieldErrors}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  );
}
