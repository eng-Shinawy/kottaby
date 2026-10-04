"use client";

/**
 * AdminTeacherRow — one body row of the desktop `AdminTeachersTable`:
 * identity (avatar/name/email + copy-email quick action + the explicit
 * view-details quick action), status (approval pill + presence + governance
 * pills), rating, subject chips, evaluator chip, and the localized joined
 * timestamp.
 *
 * The row opens the detail drawer on click (pointer convenience); the
 * identity cell's view-details IconButton is the keyboard/touch affordance
 * (`onViewDetails` is optional — clicking stays inert when the directory
 * renders without a drawer). The row enforces the 72px body-row height on
 * the CELLS (a row's own height is a minimum; `py: 1.5` alone measured
 * short once line-heights settled). `verticalAlign: middle` keeps
 * single-line cells centered within the 72px band. Even rows carry a faint
 * zebra tint (`action.hover`); hover upgrades the whole row to
 * `action.selected` and shows the pointer cursor so the row reads as
 * clickable. Soft-deleted teachers keep the same row treatment — the
 * deleted governance pill and the dimmed identity carry the signal.
 */

import { TableCell } from "@mui/material";
import { memo, type ReactNode } from "react";
import { DirectoryBodyRow } from "@/frontend/views/admin/directory-shared/DirectoryBodyRow";
import {
  type TeacherDirectoryItem,
  TeacherEvaluatorChip,
  TeacherIdentityCell,
  TeacherJoinedText,
  TeacherRatingText,
  TeacherStatusStack,
  TeacherSubjectsChips,
} from "@/frontend/views/admin/teachers/AdminTeacherRowCells";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface AdminTeacherRowProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: AdminTeachersLabels;
  readonly locale: "ar" | "en";
  /** `true` paints the faint zebra tint on this row (odd body-row index). */
  readonly striped?: boolean;
  /** Invoked after the identity cell's copy-email action resolves. */
  readonly onCopyEmail?: () => void;
  /** Opens the detail drawer for this row (the directory owns the drawer). */
  readonly onViewDetails?: (teacher: TeacherDirectoryItem) => void;
}

export const AdminTeacherRow = memo(function AdminTeacherRow({
  teacher,
  labels,
  locale,
  striped,
  onCopyEmail,
  onViewDetails,
}: AdminTeacherRowProps): ReactNode {
  const openDetails = onViewDetails === undefined ? undefined : () => onViewDetails(teacher);
  return (
    <DirectoryBodyRow onClick={openDetails} striped={striped}>
      <TeacherIdentityCell teacher={teacher} labels={labels} onCopyEmail={onCopyEmail} onViewDetails={openDetails} />
      <TableCell sx={{ minWidth: 0 }}>
        <TeacherStatusStack teacher={teacher} labels={labels} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <TeacherRatingText teacher={teacher} locale={locale} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <TeacherSubjectsChips teacher={teacher} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <TeacherEvaluatorChip teacher={teacher} labels={labels} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <TeacherJoinedText teacher={teacher} locale={locale} />
      </TableCell>
    </DirectoryBodyRow>
  );
});
