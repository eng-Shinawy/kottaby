"use client";

/**
 * StudentStatusCard — the student status card of the admin user DETAIL page
 * (prototype `user-detail-student.png` "Student Status").
 *
 * Rendered only when the detail query returns a `student` snapshot. Each of
 * the four rows pairs a 40px squircle icon tile (radius 10, container-tinted
 * background with matching on-container icon) with a label (+ optional
 * sub-line) and a trailing tonal chip:
 *  - Parent Linked (`FamilyRestroomOutlined`, secondary tile) → Yes/No chip
 *    (success lane when linked).
 *  - Active Subscription (`MonitorOutlined`, primary tile) → Yes/No chip.
 *  - Trial Status (`HourglassEmptyOutlined`, warning tile) → sub-line
 *    `${balanceTrial} creditsLabel` when a trial balance exists + amber
 *    trial chip.
 *  - Handshake Code (`TagOutlined`, neutral surface-highest tile) → neutral
 *    chip with the code.
 *
 * All value chips are the same `DetailTonalChip` (radius 999 pill, height
 * 26, `size="small"`) — uniformly pill-shaped across rows.
 *
 * Hairline `divider` between rows; null values degrade to the neutral lane
 * without crashing.
 */

import {
  FamilyRestroomOutlined as ParentLinkIcon,
  SchoolOutlined as SchoolIcon,
  MonitorOutlined as SubscriptionIcon,
  TagOutlined as TagIcon,
  HourglassEmptyOutlined as TrialIcon,
} from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminUserDetailFieldsFragment_student } from "@/frontend/graphql/generated/gql/graphql";
import { DetailCard, DetailCardTitle, DetailTonalChip, type DetailTone } from "@/frontend/views/admin/users/detail";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type StudentSnapshot = AdminUserDetailFieldsFragment_student;
type StudentLabels = Pick<AdminUsersLabels, "detail">;
type BooleanValues = AdminUsersLabels["detail"]["booleanValues"];

/** Squircle tile tints — M3 container/`on<Color>Container` pairs. */
type TileTone = "secondary" | "primary" | "warning" | "neutral";

interface TileColors {
  readonly bg: string;
  readonly fg: string;
}

function tileColors(theme: Theme, tone: TileTone): TileColors {
  switch (tone) {
    case "secondary":
      return { bg: theme.palette.secondaryContainer, fg: theme.palette.onSecondaryContainer };
    case "warning":
      return { bg: theme.palette.warningContainer, fg: theme.palette.onWarningContainer };
    case "neutral":
      return { bg: theme.palette.surfaceContainerHighest, fg: theme.palette.onSurfaceVariant };
    default:
      return { bg: theme.palette.primaryContainer, fg: theme.palette.onPrimaryContainer };
  }
}

interface StatusRowProps {
  readonly icon: ReactNode;
  readonly tileTone: TileTone;
  readonly label: string;
  readonly subLine?: string | null;
  readonly chipTone: DetailTone;
  readonly chipLabel: string;
  /** Hairline between rows — absent on the first row. */
  readonly hasTopDivider: boolean;
}

function StatusRow({ icon, tileTone, label, subLine, chipTone, chipLabel, hasTopDivider }: StatusRowProps): ReactNode {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={theme => ({
        alignItems: "center",
        py: 1.25,
        ...(hasTopDivider && { borderTop: `1px solid ${theme.palette.divider}` }),
      })}
    >
      <Box
        aria-hidden
        sx={theme => {
          const colors = tileColors(theme, tileTone);
          return {
            width: 40,
            height: 40,
            borderRadius: "10px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            bgcolor: colors.bg,
            color: colors.fg,
          };
        }}
      >
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        {subLine && (
          <Typography variant="caption" sx={theme => ({ display: "block", color: theme.palette.text.secondary })}>
            {subLine}
          </Typography>
        )}
      </Box>
      <DetailTonalChip tone={chipTone} label={chipLabel} />
    </Stack>
  );
}

/** Yes/No chip for a boolean student flag (success lane when true). */
function booleanChip(flag: boolean, booleanValues: BooleanValues): { tone: DetailTone; label: string } {
  return flag ? { tone: "success", label: booleanValues.yes } : { tone: "neutral", label: booleanValues.no };
}

interface StudentStatusCardProps {
  readonly student: StudentSnapshot;
  readonly labels: StudentLabels;
}

export function StudentStatusCard({ student, labels }: StudentStatusCardProps): ReactNode {
  const booleanValues = labels.detail.booleanValues;
  const parentLink = booleanChip(student.hasParentLink, booleanValues);
  const subscription = booleanChip(student.hasActiveSubscription, booleanValues);
  const trialSubLine =
    student.balanceTrial === null ? null : `${student.balanceTrial} ${labels.detail.studentStatus.creditsLabel}`;
  return (
    <DetailCard>
      <DetailCardTitle icon={<SchoolIcon />} title={labels.detail.student} />
      <Box>
        <StatusRow
          icon={<ParentLinkIcon />}
          tileTone="secondary"
          label={labels.detail.studentFields.hasParentLink}
          chipTone={parentLink.tone}
          chipLabel={parentLink.label}
          hasTopDivider={false}
        />
        <StatusRow
          icon={<SubscriptionIcon />}
          tileTone="primary"
          label={labels.detail.studentFields.hasActiveSubscription}
          chipTone={subscription.tone}
          chipLabel={subscription.label}
          hasTopDivider
        />
        <StatusRow
          icon={<TrialIcon />}
          tileTone="warning"
          label={labels.detail.studentStatus.trialStatus}
          subLine={trialSubLine}
          chipTone="warning"
          chipLabel={labels.detail.studentStatus.trialChip}
          hasTopDivider
        />
        <StatusRow
          icon={<TagIcon />}
          tileTone="neutral"
          label={labels.detail.studentFields.handshakeCode}
          chipTone="neutral"
          chipLabel={student.handshakeCode}
          hasTopDivider
        />
      </Box>
    </DetailCard>
  );
}
