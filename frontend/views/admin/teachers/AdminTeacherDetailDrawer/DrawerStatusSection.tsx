"use client";

/**
 * AdminTeacherDetailDrawer status section — the account-status card
 * rendering the EXACT pill set the directory rows render (approval pill,
 * presence, governance pills, evaluator chip).
 */

import { Stack } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryDrawerSection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import {
  TeacherApprovalPill,
  type TeacherDirectoryItem,
  TeacherEvaluatorChip,
  TeacherGovernancePills,
  TeacherPresenceLabel,
} from "@/frontend/views/admin/teachers/AdminTeacherRowCells";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface TeacherDrawerStatusSectionProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: AdminTeachersLabels;
}

/** Status section — the exact pill set the directory rows render. */
export function TeacherDrawerStatusSection({ teacher, labels }: TeacherDrawerStatusSectionProps): ReactNode {
  return (
    <DirectoryDrawerSection label={labels.drawer.sectionStatus}>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", rowGap: 1, columnGap: 1.5 }}>
        <TeacherApprovalPill teacher={teacher} labels={labels} />
        <TeacherPresenceLabel teacher={teacher} labels={labels} />
        <TeacherGovernancePills teacher={teacher} labels={labels} />
        <TeacherEvaluatorChip teacher={teacher} labels={labels} />
      </Stack>
    </DirectoryDrawerSection>
  );
}
