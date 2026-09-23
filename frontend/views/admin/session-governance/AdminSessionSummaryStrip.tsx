"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { StatusSummaryCounts } from "@/frontend/views/admin/session-governance/AdminSessionGovernanceContainer";
import { STATUS_LABEL_KEY, TONE_COLORS } from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionSummaryStrip — the per-status summary strip of the admin
 * session governance directory (`/admin/session-governance`):
 * one card per lifecycle status over the LOADED directory page (real data
 * only; the container passes the honest server `totalCount` for the sticky
 * bar and nothing is extrapolated across pages) plus the needs-attention
 * card in the warning tone (the same badge family as the row chip).
 *
 * Status vocabulary reuses the shared sessions-namespace status labels via
 * the `STATUS_LABEL_KEY` table; tones come from the shared presentation
 * tables. MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, RTL-safe logical composition.
 */

interface AdminSessionSummaryStripProps {
  /** Per-status counts over the loaded page (real data only). */
  readonly statusCounts: StatusSummaryCounts;
  /** Needs-attention card label (summary strip). */
  readonly needsAttentionLabel: string;
  /** Scope hint — the counts describe the LOADED page. */
  readonly summaryScopeHint: string;
  /** Shared sessions-namespace labels (status chip vocabulary). */
  readonly statusLabels: SessionsLabels;
}

/** Per-status count cards over the loaded page + the loaded-page scope hint. */
export function AdminSessionSummaryStrip({
  statusCounts,
  needsAttentionLabel,
  summaryScopeHint,
  statusLabels,
}: Readonly<AdminSessionSummaryStripProps>): ReactNode {
  return (
    <Stack
      data-testid="admin-session-governance-summary"
      sx={theme => ({
        display: "grid",
        gap: 1,
        gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(6, 1fr)" },
        p: 1.5,
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <SummaryCard
        count={statusCounts.scheduled}
        label={statusLabels[STATUS_LABEL_KEY[SessionStatus.Scheduled] ?? "statusScheduled"]}
        tone="info"
      />
      <SummaryCard
        count={statusCounts.started}
        label={statusLabels[STATUS_LABEL_KEY[SessionStatus.Started] ?? "statusStarted"]}
        tone="primary"
      />
      <SummaryCard
        count={statusCounts.completed}
        label={statusLabels[STATUS_LABEL_KEY[SessionStatus.Completed] ?? "statusCompleted"]}
        tone="success"
      />
      <SummaryCard
        count={statusCounts.cancelled}
        label={statusLabels[STATUS_LABEL_KEY[SessionStatus.Cancelled] ?? "statusCancelled"]}
        tone="error"
      />
      <SummaryCard
        count={statusCounts.disputed}
        label={statusLabels[STATUS_LABEL_KEY[SessionStatus.Disputed] ?? "statusDisputed"]}
        tone="warning"
      />
      <SummaryCard count={statusCounts.needsAttention} label={needsAttentionLabel} tone="warning" />
      <Typography
        variant="caption"
        sx={theme => ({ color: theme.palette.text.secondary, gridColumn: "1 / -1", textAlign: "start" })}
      >
        {summaryScopeHint}
      </Typography>
    </Stack>
  );
}

interface SummaryCardProps {
  readonly count: number;
  readonly label: string;
  readonly tone: "info" | "primary" | "success" | "error" | "warning";
}

/** One status-summary card — count over label on the status tone pair. */
function SummaryCard({ count, label, tone }: Readonly<SummaryCardProps>): ReactNode {
  const toneColors = TONE_COLORS[tone] ?? TONE_COLORS.warning;
  return (
    <Stack
      sx={theme => ({
        gap: 0.5,
        p: 1.25,
        borderRadius: 2,
        alignItems: "flex-start",
        bgcolor: toneColors.bg(theme.palette),
        color: toneColors.fg(theme.palette),
        // Dark-mode M3 containers (esp. primaryContainer) sit close to the
        // strip's surface — the 1px outline separates card from card without
        // changing the tone vocabulary.
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
      })}
    >
      <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
        {count}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, textAlign: "start" }}>
        {label}
      </Typography>
    </Stack>
  );
}
