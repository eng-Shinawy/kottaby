"use client";

/**
 * ApplicantStatusChip — the applicant lifecycle status as a tonal chip
 * (pending/in-evaluation → info, passed → success, failed → error), shared
 * by the hero chip row and the teacher-application title row of the admin
 * user DETAIL page. Extracted from `UserDetailPrimitives`.
 */

import type { ReactNode } from "react";
import { ApplicantStatus } from "@/frontend/graphql/generated/gql/graphql";
import { DetailTonalChip, type DetailTone } from "@/frontend/views/admin/users/detail";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Applicant lifecycle status → tonal lane (pending/in-evaluation info, passed success, failed error).
 *  Pending/in-evaluation take the INFO lane (not warning) so the chip can't be
 *  confused with the teacher role's secondary-copper identity it sits beside. */
const APPLICANT_TONES: Record<ApplicantStatus, DetailTone> = {
  [ApplicantStatus.Pending]: "info",
  [ApplicantStatus.InEvaluation]: "info",
  [ApplicantStatus.Passed]: "success",
  [ApplicantStatus.Failed]: "error",
};

/** Localized applicant-status string (Record lookup — no enum switch). */
function applicantLabelOf(status: ApplicantStatus, labels: AdminUsersLabels["detail"]["applicantStatus"]): string {
  const labelsByStatus: Record<ApplicantStatus, string> = {
    [ApplicantStatus.Pending]: labels.pending,
    [ApplicantStatus.InEvaluation]: labels.inEvaluation,
    [ApplicantStatus.Passed]: labels.passed,
    [ApplicantStatus.Failed]: labels.failed,
  };
  return labelsByStatus[status];
}

interface ApplicantStatusChipProps {
  readonly status: ApplicantStatus;
  readonly labels: AdminUsersLabels["detail"]["applicantStatus"];
}

/** Tonal applicant-status chip used by the hero chip row and the teacher-application title row. */
export function ApplicantStatusChip({ status, labels }: ApplicantStatusChipProps): ReactNode {
  return <DetailTonalChip tone={APPLICANT_TONES[status]} label={applicantLabelOf(status, labels)} />;
}
