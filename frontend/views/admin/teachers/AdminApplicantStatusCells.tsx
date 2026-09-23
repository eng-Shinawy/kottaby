"use client";

/**
 * AdminApplicantStatusCells — the applicant-queue status column content:
 * the lifecycle headline chip (tone-mapped, honest verbatim fallback for
 * unknown wire values) plus the governance pills (deleted / suspended /
 * blocked, rendered only when the flag is set), wrapped in a wrapping row
 * so the desktop cell and the mobile body row share one composition.
 */

import { Stack } from "@mui/material";
import type { ReactNode } from "react";
import type { ApplicantDirectoryItem } from "@/frontend/views/admin/teachers/AdminApplicantIdentityCell";
import { applicantStatusLabel, applicantStatusTone } from "@/frontend/views/admin/teachers/adminApplicants.helpers";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface ApplicantStatusStackProps {
  readonly applicant: ApplicantDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "applicantStatus" | "statusPills">;
}

/**
 * Status content — the lifecycle headline chip plus the governance pills,
 * reused by the desktop cell and the mobile body row.
 */
export function ApplicantStatusStack({ applicant, labels }: ApplicantStatusStackProps): ReactNode {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", rowGap: 0.5, columnGap: 1, minWidth: 0 }}>
      <ApplicantStatusChip applicant={applicant} labels={labels} />
      <ApplicantGovernancePills applicant={applicant} labels={labels} />
    </Stack>
  );
}

interface ApplicantStatusChipProps {
  readonly applicant: ApplicantDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "applicantStatus">;
}

/** Lifecycle headline chip — tone-mapped with an honest neutral fallback. */
function ApplicantStatusChip({ applicant, labels }: ApplicantStatusChipProps): ReactNode {
  return (
    <TonalChip
      tone={applicantStatusTone(applicant.status)}
      label={applicantStatusLabel(applicant.status, labels.applicantStatus)}
    />
  );
}

interface ApplicantGovernancePillsProps {
  readonly applicant: ApplicantDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "statusPills">;
}

/**
 * Governance pills — deleted / suspended / blocked, each rendered only when
 * its flag is set (priority semantics stay on the backend; the pills are a
 * faithful set rendering). Renders nothing when no governance flag is set.
 */
function ApplicantGovernancePills({ applicant, labels }: ApplicantGovernancePillsProps): ReactNode {
  return (
    <>
      {applicant.isDeleted && <TonalChip tone="error" label={labels.statusPills.deleted} />}
      {applicant.suspended && <TonalChip tone="warning" label={labels.statusPills.suspended} />}
      {applicant.isBlocked && <TonalChip tone="error" label={labels.statusPills.blocked} />}
    </>
  );
}
