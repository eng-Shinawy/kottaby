"use client";

/**
 * AdminStudentParentContent — the student directory's parent-placement
 * content cell, extracted from `AdminStudentRowCells` (its largest member).
 * Rendered identically by the desktop row and the mobile card body: the
 * verbatim parent identity (name + email) when the student is linked, the
 * localized "independent" chip when they are not, or the em-dash fallback
 * for a linked student whose parent identity is missing (defensive — the
 * backend derives the link from the parent_id).
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

interface StudentParentContentProps {
  readonly student: StudentDirectoryItem;
  readonly labels: Pick<AdminStudentsLabels, "parentLabels">;
}

export function StudentParentContent({ student, labels }: StudentParentContentProps): ReactNode {
  if (!student.hasParent) {
    return <TonalChip tone="neutral" label={labels.parentLabels.noParent} />;
  }
  if (student.parentName === null && student.parentEmail === null) {
    return (
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        —
      </Typography>
    );
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      {student.parentName !== null && (
        <Typography
          component="div"
          title={student.parentName}
          sx={theme => ({
            fontSize: 14,
            fontWeight: 500,
            color: theme.palette.text.primary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {student.parentName}
        </Typography>
      )}
      {student.parentEmail !== null && (
        <Typography
          variant="body2"
          component="div"
          title={student.parentEmail}
          dir="ltr"
          sx={theme => ({
            fontSize: 13,
            color: theme.palette.text.secondary,
            unicodeBidi: "isolate",
            textAlign: "start",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {student.parentEmail}
        </Typography>
      )}
    </Box>
  );
}
