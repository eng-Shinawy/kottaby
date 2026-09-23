"use client";

/**
 * AdminTeacherDetailCells — the teacher-directory detail column contents:
 * the rating (star icon + one-decimal localized value), the subject chips
 * (up to three + a "+N" overflow chip), the evaluator chip, and the joined
 * timestamp — the same semantic content the desktop table and the mobile
 * card list render per row.
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { TeacherDirectoryItem } from "@/frontend/views/admin/teachers/AdminTeacherIdentityCell";
import {
  ADMIN_TEACHERS_SUBJECTS_LIMIT,
  formatTeacherRating,
} from "@/frontend/views/admin/teachers/adminTeachersDirectory.helpers";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AppLocale } from "@/shared/locale";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface TeacherRatingTextProps {
  readonly teacher: TeacherDirectoryItem;
  readonly locale: AppLocale;
}

/** Rating content — star icon + one-decimal localized value, em-dash when unrated. */
export function TeacherRatingText({ teacher, locale }: TeacherRatingTextProps): ReactNode {
  if (teacher.averageRating === null) {
    return (
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        —
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <StarIcon />
      <Typography
        variant="body2"
        component="span"
        sx={theme => ({ color: theme.palette.text.primary, fontWeight: 500 })}
      >
        {formatTeacherRating(teacher.averageRating, locale)}
      </Typography>
    </Stack>
  );
}

/** Decorative star glyph — aria-hidden, the adjacent value carries the meaning. */
function StarIcon(): ReactNode {
  return (
    <Box
      component="span"
      aria-hidden
      sx={theme => ({
        width: 16,
        height: 16,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: theme.palette.warningContainer,
        color: theme.palette.onWarningContainer,
        fontSize: 10,
        lineHeight: 1,
      })}
    >
      ★
    </Box>
  );
}

interface TeacherSubjectsChipsProps {
  readonly teacher: TeacherDirectoryItem;
}

/** Subjects content — up to three chips + a "+N" overflow chip, em-dash when empty. */
export function TeacherSubjectsChips({ teacher }: TeacherSubjectsChipsProps): ReactNode {
  if (teacher.subjects.length === 0) {
    return (
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        —
      </Typography>
    );
  }
  const visible = teacher.subjects.slice(0, ADMIN_TEACHERS_SUBJECTS_LIMIT);
  const overflow = teacher.subjects.length - visible.length;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5, minWidth: 0 }}>
      {visible.map(subject => (
        <Chip key={subject} label={subject} />
      ))}
      {overflow > 0 && <Chip label={`+${overflow}`} overflow />}
    </Stack>
  );
}

interface SubjectChipProps {
  readonly label: string;
  /** Overflow chips ("+N") render in the disabled ink to read as metadata. */
  readonly overflow?: boolean;
}

/** Small neutral subject chip (surface-container lane, 26px tall). */
function Chip({ label, overflow = false }: SubjectChipProps): ReactNode {
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
        color: overflow ? theme.palette.text.disabled : theme.palette.onSurfaceVariant,
        fontSize: 12,
        fontWeight: 600,
        maxWidth: 160,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      })}
    >
      {label}
    </Box>
  );
}

interface TeacherEvaluatorChipProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "statusPills">;
}

/** Evaluator content — the evaluator chip when the privilege is held, em-dash otherwise. */
export function TeacherEvaluatorChip({ teacher, labels }: TeacherEvaluatorChipProps): ReactNode {
  if (!teacher.isEvaluator) {
    return (
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        —
      </Typography>
    );
  }
  return <TonalChip tone="secondary" label={labels.statusPills.evaluator} />;
}

interface TeacherJoinedTextProps {
  readonly teacher: TeacherDirectoryItem;
  readonly locale: AppLocale;
}

/** Joined content — localized timestamp via the shared frontend date util. */
export function TeacherJoinedText({ teacher, locale }: TeacherJoinedTextProps): ReactNode {
  return (
    <Typography variant="body2" component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
      {formatApplicantDate(teacher.createdAt, locale)}
    </Typography>
  );
}
