"use client";

import { ReportProblemOutlined as DisputedIcon } from "@mui/icons-material";
import { Chip } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import {
  STATUS_ICON,
  STATUS_LABEL_KEY,
  STATUS_TONE,
  TONE_COLORS,
} from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionRowStatusCell — the lifecycle StatusBadge of a governance
 * directory row: the shared status chip (icon + label + Material 3
 * container/on-container tone pair) driven EXCLUSIVELY by the shared
 * presentation tables (`STATUS_ICON` / `STATUS_TONE` / `TONE_COLORS` /
 * `STATUS_LABEL_KEY` in the student/sessions row family — the same
 * vocabulary every session surface renders). Defensive-corrupt arms keep
 * unknown statuses renderable, never crashing.
 *
 * The status label resolves through the shared sessions-namespace status
 * labels (`statusScheduled` … `statusDisputed`) — the lifecycle vocabulary
 * stays single-sourced. MUI v9 discipline: `sx`-only styling, colors
 * exclusively through `theme.palette.*` callbacks.
 */

interface AdminSessionRowStatusCellProps {
  /** The session lifecycle status — drives the chip's icon + tone pair. */
  readonly status: SessionStatus;
  /** Shared sessions-namespace labels (status chip vocabulary). */
  readonly t: SessionsLabels;
}

/** The lifecycle StatusBadge of one governance row. */
export function AdminSessionRowStatusCell({ status, t }: Readonly<AdminSessionRowStatusCellProps>): ReactNode {
  const statusTone = STATUS_TONE[status] ?? "warning";
  const toneColors = TONE_COLORS[statusTone] ?? TONE_COLORS.warning;
  const Icon = STATUS_ICON[status] ?? DisputedIcon;
  const label = t[STATUS_LABEL_KEY[status] ?? "statusDisputed"];

  return (
    <Chip
      icon={<Icon fontSize="small" />}
      label={label}
      size="small"
      data-testid="admin-session-status-chip"
      sx={theme => ({
        fontWeight: 600,
        bgcolor: toneColors.bg(theme.palette),
        color: toneColors.fg(theme.palette),
        // Same separation rationale as the chrome's summary cards: the
        // dark-mode container pairs (esp. primaryContainer) sit close to the
        // row card's surface, so the chip gets a quiet 1px outline.
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        "& .MuiChip-icon": {
          color: toneColors.fg(theme.palette),
        },
      })}
    />
  );
}
