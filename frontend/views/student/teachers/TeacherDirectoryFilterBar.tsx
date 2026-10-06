"use client";

/**
 * TeacherDirectoryFilterBar — the browse filter bar of the student teacher
 * directory: a real `<form>` whose submit narrows the query (NEVER
 * per-keystroke refetches; `React.SubmitEvent` discipline). The bar edits
 * the DRAFT choice set (the hard Qira'ah recitation filter, the hard
 * subject intent, and the optional name-search / rating / ordering trio
 * rendered by `TeacherDirectoryFilterSelects`) and lifts settled outcomes
 * only: `onApply` receives the committed choices (the container resets to
 * page 1), `onReset` restores the defaults. The apply/reset row mirrors
 * the admin bars' `FilterActionsRow` STYLE, built locally
 * (`views/student` never imports `views/admin`), separated from the field
 * group by a hairline divider so the fields read as one group and the
 * actions as its footer. The card leans its border onto the brand color
 * and breathes a soft shadow while ANY field holds focus
 * (`&:focus-within`). MUI v9 `sx`-only styling, theme-palette colors,
 * RTL-safe (grid + gap only).
 */

import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { TeacherDirectoryFilterActions } from "@/frontend/views/student/teachers/TeacherDirectoryFilterActions";
import { TeacherDirectoryFilterSelects } from "@/frontend/views/student/teachers/TeacherDirectoryFilterSelects";
import type { BrowseFilterChoices } from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { TeacherDirectory, useAppTranslation } from "@/shared/locale";

interface TeacherDirectoryFilterBarProps {
  /** The controlled DRAFT choice set the bar edits. */
  readonly draft: BrowseFilterChoices;
  /** Draft-change intent (per-control; the bar never applies on change). */
  readonly onDraftChange: (next: BrowseFilterChoices) => void;
  /** Apply intent — the submit boundary; receives the committed choices. */
  readonly onApply: (choices: BrowseFilterChoices) => void;
  /** Reset intent — restores the default choices (+ page 1 in the container). */
  readonly onReset: () => void;
}

/** The student browse filter bar (five browse choices → apply/reset footer). */
export function TeacherDirectoryFilterBar({
  draft,
  onDraftChange,
  onApply,
  onReset,
}: Readonly<TeacherDirectoryFilterBarProps>): ReactNode {
  const t = useAppTranslation(TeacherDirectory);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onApply(draft);
  };

  return (
    <Box
      component="form"
      noValidate
      onSubmit={handleSubmit}
      data-testid="student-teachers-filters"
      sx={theme => ({
        display: "grid",
        gap: 2,
        // Row 1: recitation · intent · sort (3 across at md). Row 2: the
        // name search (double width) · the minimum rating. Actions follow
        // as the full-width footer row.
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        // Interactive-focus lift: the card leans toward the brand color and
        // breathes a soft shadow while any control inside holds focus.
        "&:focus-within": {
          borderColor: theme.palette.primary.main,
          boxShadow: theme.palette.shadow.cardHover,
        },
      })}
    >
      <TeacherDirectoryFilterSelects draft={draft} onDraftChange={onDraftChange} />
      <TeacherDirectoryFilterActions onReset={onReset} resetLabel={t.resetFilters} applyLabel={t.applyFilters} />
    </Box>
  );
}
