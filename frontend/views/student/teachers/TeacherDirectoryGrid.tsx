"use client";

/**
 * TeacherDirectoryGrid — the responsive card grid of the student teacher
 * directory: a plain CSS grid (1 / 2 / 3 columns across `xs`/`sm`/`lg`)
 * of {@link TeacherDirectoryCard} entries keyed by teacher id (stable keys
 * — never render order). The region is a real list (`ul` + per-card `li`)
 * so assistive tech announces it as a collection (the results heading
 * above it names the list), and RTL-safety comes for free: grid
 * auto-flips with the document direction. Cards stretch to equal heights
 * per row (`alignItems: "stretch"` + the card's own `height: "100%"` +
 * the CTA's `mt: "auto"` pin), so ragged chip counts never misalign rows.
 * Each card's request intent lifts to the container's single
 * request-dialog instance through `onRequestSession`.
 */

import { Stack } from "@mui/material";
import type { ReactNode } from "react";
import type { BrowseAvailableTeachersQuery_browseAvailableTeachers_items } from "@/frontend/graphql/generated/gql/graphql";
import { TeacherDirectoryCard } from "@/frontend/views/student/teachers/TeacherDirectoryCard";

interface TeacherDirectoryGridProps {
  /** The settled browse page's teacher cards (already paged server-side). */
  readonly items: readonly BrowseAvailableTeachersQuery_browseAvailableTeachers_items[];
  /** Request intent — passed through to every card's CTA. */
  readonly onRequestSession: (teacher: BrowseAvailableTeachersQuery_browseAvailableTeachers_items) => void;
}

/** The responsive teacher-card grid. */
export function TeacherDirectoryGrid({ items, onRequestSession }: Readonly<TeacherDirectoryGridProps>): ReactNode {
  return (
    <Stack
      component="ul"
      data-testid="student-teachers-grid"
      sx={{
        m: 0,
        p: 0,
        listStyle: "none",
        display: "grid",
        gap: 2.5,
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
        alignItems: "stretch",
        alignContent: "start",
      }}
    >
      {items.map(teacher => (
        <Stack key={teacher.id} component="li" sx={{ display: "block" }}>
          <TeacherDirectoryCard teacher={teacher} onRequestSession={onRequestSession} />
        </Stack>
      ))}
    </Stack>
  );
}
