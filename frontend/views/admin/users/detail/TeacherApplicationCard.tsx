"use client";

/**
 * TeacherApplicationCard — the teacher-application progress card of the
 * admin user DETAIL page (prototype `user-detail-teacher.png`).
 *
 * Rendered when the detail query returns an `applicant` and/or a `teacher`
 * snapshot. Composition:
 *  - Title row: badge icon + title + trailing tonal `ApplicantStatusChip`
 *    (when an applicant snapshot exists).
 *  - Subtitle line (`teacherApplication.subtitle`).
 *  - Stats panel and Approved/Evaluator flag rows (`TeacherApplicationPanels`);
 *    custom 3-node stepper (`TeacherApplicationStepper`).
 *  - Info note strip (`DetailInfoStrip` `info` tone — elevated surface +
 *    leading info accent bar) — certification is read-only here.
 */

import { BadgeOutlined as BadgeIcon } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUserDetailQuery_adminUserDetail } from "@/frontend/graphql/generated/gql/graphql";
import {
  ApplicationStepper,
  DetailCard,
  DetailCardTitle,
  DetailInfoStrip,
  StatsPanel,
  TeacherFlagRow,
} from "@/frontend/views/admin/users/detail";
import { ApplicantStatusChip } from "@/frontend/views/admin/users/ui";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DetailUser = AdminUserDetailQuery_adminUserDetail;
type DetailLabels = Pick<AdminUsersLabels, "detail">;

interface TeacherApplicationCardProps {
  readonly user: DetailUser;
  readonly labels: DetailLabels;
  /** Locale-bound date-only formatter (cooldown / submitted dates). */
  readonly formatDate: (raw: string | null | undefined) => string;
}

export function TeacherApplicationCard({ user, labels, formatDate }: TeacherApplicationCardProps): ReactNode {
  const applicant = user.applicant;
  const teacher = user.teacher;
  return (
    <DetailCard>
      <DetailCardTitle
        icon={<BadgeIcon />}
        title={labels.detail.applicant}
        trailing={
          applicant ? (
            <ApplicantStatusChip status={applicant.status} labels={labels.detail.applicantStatus} />
          ) : undefined
        }
      />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, mb: 2 })}>
        {labels.detail.teacherApplication.subtitle}
      </Typography>
      {applicant && <StatsPanel applicant={applicant} user={user} labels={labels} formatDate={formatDate} />}
      {applicant && <ApplicationStepper status={applicant.status} labels={labels.detail.teacherApplication} />}
      <DetailInfoStrip tone="info" note={labels.detail.teacherApplication.note} />
      <Stack direction="row" sx={{ mt: 2, gap: 3, flexWrap: "wrap" }}>
        <TeacherFlagRow
          label={labels.detail.teacherFields.approved}
          value={teacher?.isApproved ?? false}
          booleanValues={labels.detail.booleanValues}
        />
        <TeacherFlagRow
          label={labels.detail.teacherFields.evaluator}
          value={teacher?.isEvaluator ?? false}
          booleanValues={labels.detail.booleanValues}
        />
      </Stack>
    </DetailCard>
  );
}
