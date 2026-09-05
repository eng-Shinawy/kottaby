"use client";

/**
 * TeacherApplicationPanels — the stats panel and the Approved/Evaluator
 * flag rows of the teacher-application card on the admin user DETAIL page
 * (extracted from `TeacherApplicationCard.tsx`).
 *
 * - `StatsPanel` (`surfaceContainerHigh`, radius 10, 3 equal columns):
 *   VERIFICATION ATTEMPTS `${n} of 3`, COOLDOWN UNTIL (em dash when no
 *   active cooldown), SUBMITTED. NOTE: the applicant fragment exposes no
 *   dedicated `submittedAt` — for teacher applicants the account row is
 *   created when the application is submitted, so `user.createdAt` is the
 *   submitted date (same value the prototype shows).
 * - `TeacherFlagRow`: Approved / Evaluator footer row — label + trailing
 *   `DetailTonalChip` (Yes = success container, No = neutral) from the
 *   `teacher` snapshot (No when the snapshot is absent); no state icons
 *   (the ✗ glyphs read as "error/remove").
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminUserDetailFieldsFragment_applicant,
  AdminUserDetailQuery_adminUserDetail,
} from "@/frontend/graphql/generated/gql/graphql";
import { DetailEyebrow, DetailTonalChip } from "@/frontend/views/admin/users/detail";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DetailUser = AdminUserDetailQuery_adminUserDetail;
type ApplicantSnapshot = AdminUserDetailFieldsFragment_applicant;
type DetailLabels = Pick<AdminUsersLabels, "detail">;
type BooleanValues = AdminUsersLabels["detail"]["booleanValues"];

/**
 * Maximum verification attempts before forced cooldown — the applicant
 * lifecycle contract fixes this at 3 (see `docs/teachers/applicant-lifecycle.md`);
 * the value is backend-owned, mirrored here for display only.
 */
const MAX_VERIFICATION_ATTEMPTS = 3;

interface StatCellProps {
  readonly label: string;
  readonly value: string;
}

/** One stats-panel column: uppercase eyebrow over a 500-weight value — both aligned to the logical start. */
function StatCell({ label, value }: StatCellProps): ReactNode {
  return (
    <Box sx={{ minWidth: 0, textAlign: "start" }}>
      <DetailEyebrow>{label}</DetailEyebrow>
      <Typography
        variant="body2"
        sx={theme => ({ mt: 0.5, fontWeight: 500, textAlign: "start", color: theme.palette.text.primary })}
      >
        {value}
      </Typography>
    </Box>
  );
}

interface TeacherFlagRowProps {
  readonly label: string;
  readonly value: boolean;
  readonly booleanValues: BooleanValues;
}

/**
 * Approved / Evaluator footer row — label + trailing `DetailTonalChip`
 * (Yes = success container, No = neutral lane). No state icons: the ✗-shaped
 * cancel glyphs read as "error/remove" next to a plain boolean.
 */
export function TeacherFlagRow({ label, value, booleanValues }: TeacherFlagRowProps): ReactNode {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      <DetailTonalChip tone={value ? "success" : "neutral"} label={value ? booleanValues.yes : booleanValues.no} />
    </Stack>
  );
}

interface StatsPanelProps {
  readonly applicant: ApplicantSnapshot;
  readonly user: DetailUser;
  readonly labels: DetailLabels;
  readonly formatDate: (raw: string | null | undefined) => string;
}

export function StatsPanel({ applicant, user, labels, formatDate }: StatsPanelProps): ReactNode {
  const cooldownValue = applicant.cooldownActive && applicant.cooldownUntil ? formatDate(applicant.cooldownUntil) : "—";
  return (
    <Box
      sx={theme => ({
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
        gap: 2,
        p: 2,
        bgcolor: theme.palette.surfaceContainerHigh,
        borderRadius: "10px",
      })}
    >
      <StatCell
        label={labels.detail.applicantFields.verificationAttempts}
        value={`${applicant.verificationAttempts} ${labels.detail.teacherApplication.statsOf} ${MAX_VERIFICATION_ATTEMPTS}`}
      />
      <StatCell label={labels.detail.applicantFields.cooldownUntil} value={cooldownValue} />
      <StatCell label={labels.detail.teacherApplication.submitted} value={formatDate(user.createdAt)} />
    </Box>
  );
}
