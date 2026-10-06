"use client";

/**
 * TeacherDirectoryEmptyState — the zero-results branch of the student
 * teacher directory browse. Zero eligible teachers is a VALID browse
 * state (an honest empty page — the server returns an empty `items` next
 * to the honest total, never an error), so the copy never apologizes: the
 * headline states the fact and the hint points at the lever the student
 * actually holds (a different recitation or subject — both filters are
 * hard filters server-side).
 *
 * Composition: the shared `IconCircleEmptyState` rhythm (decorative
 * `PersonSearchOutlined` icon in a 72px tinted circle, bolded title,
 * secondary body) — the same zero-rows shape every surface keeps so no
 * page reads as the poorer sibling — breathing room added by the local
 * wrapper so the quiet state never crowds the always-on chrome.
 */

import { PersonSearchOutlined } from "@mui/icons-material";
import { Box } from "@mui/material";
import type { ReactElement } from "react";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import { TeacherDirectory, useAppTranslation } from "@/shared/locale";

/** The honest zero-results state of the teacher directory browse. */
export function TeacherDirectoryEmptyState(): ReactElement {
  const t = useAppTranslation(TeacherDirectory);
  return (
    <Box sx={{ py: 6 }}>
      <IconCircleEmptyState
        testId="student-teachers-empty"
        icon={<PersonSearchOutlined sx={{ fontSize: 36 }} />}
        title={t.noTeachersAvailable}
        body={t.emptyStateHint}
      />
    </Box>
  );
}
