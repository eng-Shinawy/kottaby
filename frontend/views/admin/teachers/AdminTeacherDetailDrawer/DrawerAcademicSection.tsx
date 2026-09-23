"use client";

/**
 * AdminTeacherDetailDrawer academic section — the academic card: the rating
 * row (star + honest em-dash) and the FULL subject chip list (the drawer
 * lifts the row's "+N" overflow clamp).
 */

import { Box, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryDrawerSection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import { type TeacherDirectoryItem, TeacherRatingText } from "@/frontend/views/admin/teachers/AdminTeacherRowCells";
import type { AppLocale } from "@/shared/locale";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface TeacherDrawerAcademicSectionProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: AdminTeachersLabels;
  readonly locale: AppLocale;
}

/** Academic section — rating (star + honest em-dash) and the FULL subject list. */
export function TeacherDrawerAcademicSection({
  teacher,
  labels,
  locale,
}: TeacherDrawerAcademicSectionProps): ReactNode {
  return (
    <DirectoryDrawerSection label={labels.drawer.sectionAcademic}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: teacher.subjects.length > 0 ? 1 : 0 }}>
        <Typography
          variant="body2"
          sx={theme => ({ color: theme.palette.text.secondary, flexBasis: "40%", flexShrink: 0 })}
        >
          {labels.headers.rating}
        </Typography>
        <TeacherRatingText teacher={teacher} locale={locale} />
      </Stack>
      {teacher.subjects.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="body2" component="div" sx={theme => ({ color: theme.palette.text.secondary, mb: 1 })}>
            {labels.headers.subjects}
          </Typography>
          {/* FULL chip list — the drawer lifts the row's "+N" overflow clamp. */}
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
            {teacher.subjects.map(subject => (
              <SubjectChip key={subject} label={subject} />
            ))}
          </Stack>
        </>
      )}
    </DirectoryDrawerSection>
  );
}

interface SubjectChipProps {
  readonly label: string;
}

/** Neutral subject chip (the row cell's chip, unclamped). */
function SubjectChip({ label }: SubjectChipProps): ReactNode {
  return (
    <Box
      component="span"
      sx={theme => ({
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        height: 26,
        borderRadius: "999px",
        bgcolor: theme.palette.surfaceContainerHighest,
        color: theme.palette.onSurfaceVariant,
        fontSize: 12,
        fontWeight: 600,
      })}
    >
      {label}
    </Box>
  );
}
