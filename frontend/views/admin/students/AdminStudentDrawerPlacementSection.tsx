"use client";

/**
 * AdminStudentDrawerPlacementSection — the student detail drawer's parent
 * placement section (extracted from `AdminStudentDetailDrawer`): the
 * verbatim parent identity with a mailto affordance when the student is
 * linked, the localized "independent" chip otherwise, or the em-dash
 * fallback for a linked student whose parent identity is missing
 * (defensive — mirrors the row cell).
 */

import { Typography } from "@mui/material";
import type { ReactNode } from "react";
import {
  DirectoryDrawerSection,
  DirectoryEmptyValue,
  DirectoryLabelValueRow,
} from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

interface StudentDrawerPlacementSectionProps {
  readonly student: StudentDirectoryItem;
  readonly labels: AdminStudentsLabels;
}

export function StudentDrawerPlacementSection({ student, labels }: StudentDrawerPlacementSectionProps): ReactNode {
  let placementContent: ReactNode;
  if (!student.hasParent) {
    placementContent = <TonalChip tone="neutral" label={labels.parentLabels.noParent} />;
  } else if (student.parentName === null && student.parentEmail === null) {
    placementContent = <DirectoryEmptyValue />;
  } else {
    placementContent = (
      <>
        {student.parentName !== null && (
          <DirectoryLabelValueRow label={labels.headers.parent}>
            <Typography
              component="div"
              title={student.parentName}
              sx={theme => ({
                fontWeight: 500,
                color: theme.palette.text.primary,
                overflowWrap: "anywhere",
              })}
            >
              {student.parentName}
            </Typography>
          </DirectoryLabelValueRow>
        )}
        {student.parentEmail !== null && (
          <DirectoryLabelValueRow label={labels.fields.parentEmail} ltr>
            <Typography
              component="a"
              href={`mailto:${student.parentEmail}`}
              title={student.parentEmail}
              sx={theme => ({
                color: theme.palette.primary.main,
                fontWeight: 500,
                textDecoration: "none",
                overflowWrap: "anywhere",
                "&:hover": { textDecoration: "underline" },
              })}
            >
              {student.parentEmail}
            </Typography>
          </DirectoryLabelValueRow>
        )}
      </>
    );
  }
  return <DirectoryDrawerSection label={labels.drawer.sectionPlacement}>{placementContent}</DirectoryDrawerSection>;
}
