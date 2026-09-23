"use client";

/**
 * SubscriptionStatusFilterChips — the horizontal filter-chip row of the
 * admin student drawer's subscription-management section: All + the four
 * admin-facing lifecycle statuses, each chip carrying its row count (the
 * All chip carries the total). The selection renders filled on its tone
 * lane while the rest stay outlined — one glance shows both the split and
 * the current lens. The row mounts only while the student HAS rows (the
 * empty state owns the zero-rows case) and never mutates the data flow:
 * the pure `countByStatus`/`filterByStatus` helpers do the math in the
 * owning section.
 *
 * Presentational: counts and labels arrive resolved (the per-status chips
 * reuse the namespace's `status` slots — single-sourced, never
 * re-translated). MUI v9 `sx`-only styling, theme tokens only, fully
 * rounded chips; the wrapping flex row respects RTL without any
 * directional CSS (the count pill follows the label in the reading order).
 */

import {
  CheckCircleOutlined as ActiveIcon,
  CancelOutlined as CancelIcon,
  EventBusyOutlined as ExpiredIcon,
  ScheduleOutlined as PendingIcon,
} from "@mui/icons-material";
import { Box, Chip, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import {
  STATUS_TONE,
  type SubscriptionStatusFilter,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { statusLabelsOf } from "@/frontend/views/admin/students/subscriptions/subscriptionView.helpers";
import { type DirectoryTone, toneColors } from "@/frontend/views/admin/users/utils";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

interface SubscriptionStatusFilterChipsProps {
  readonly labels: SubscriptionAdminLabels;
  /** Per-status tallies from the pure helper (the wire-enum-keyed table). */
  readonly counts: Record<SubscriptionStatus, number>;
  /** Total fetched rows — the All chip's count. */
  readonly total: number;
  readonly selected: SubscriptionStatusFilter;
  readonly onSelect: (filter: SubscriptionStatusFilter) => void;
}

/** The chips' status order (All rides first — the unfiltered lens). */
const CHIP_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.Active,
  SubscriptionStatus.Expired,
  SubscriptionStatus.Cancelled,
  SubscriptionStatus.Pending,
];

interface FilterChipSlot {
  readonly filter: SubscriptionStatusFilter;
  readonly label: string;
  readonly count: number;
  readonly tone: DirectoryTone;
  /** Optional leading glyph (the lifecycle lens the chip filters by). */
  readonly icon?: ReactNode;
}

/** Per-status chip glyphs — the lens each chip filters by at a glance. */
const CHIP_ICONS: Partial<Record<SubscriptionStatus, ReactNode>> = {
  [SubscriptionStatus.Active]: <ActiveIcon sx={{ fontSize: 16 }} />,
  [SubscriptionStatus.Expired]: <ExpiredIcon sx={{ fontSize: 16 }} />,
  [SubscriptionStatus.Cancelled]: <CancelIcon sx={{ fontSize: 16 }} />,
  [SubscriptionStatus.Pending]: <PendingIcon sx={{ fontSize: 16 }} />,
};

/** One filter chip — filled on the tone lane when selected, outlined otherwise. */
function FilterChip({
  slot,
  selected,
  onSelect,
}: {
  readonly slot: FilterChipSlot;
  readonly selected: boolean;
  readonly onSelect: (filter: SubscriptionStatusFilter) => void;
}): ReactNode {
  return (
    <Chip
      size="small"
      onClick={() => onSelect(slot.filter)}
      aria-pressed={selected}
      label={
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          {slot.icon}
          <Box component="span">{slot.label}</Box>
          <Box
            component="span"
            sx={theme => ({
              borderRadius: "999px",
              px: 0.75,
              fontSize: "0.75rem",
              lineHeight: 1.6,
              ...(selected
                ? { bgcolor: theme.palette.background.paper, color: theme.palette.text.primary }
                : { bgcolor: toneColors(theme, slot.tone).bg, color: toneColors(theme, slot.tone).fg }),
            })}
          >
            {slot.count}
          </Box>
        </Stack>
      }
      sx={theme => {
        const colors = toneColors(theme, slot.tone);
        return {
          borderRadius: "999px",
          fontWeight: 600,
          flexShrink: 0,
          transition: theme.transitions.create(["background-color", "border-color", "color", "box-shadow"], {
            duration: theme.transitions.duration.shorter,
          }),
          ...(selected
            ? { bgcolor: colors.bg, color: colors.fg, boxShadow: theme.shadows[1] }
            : {
                bgcolor: "transparent",
                border: `1px solid ${colors.dot}`,
                color: colors.dot,
                "&:hover": { bgcolor: colors.bg },
              }),
        };
      }}
    />
  );
}

/** The filter-chip row — All (total) first, then the four lifecycle chips. */
export function SubscriptionStatusFilterChips({
  labels,
  counts,
  total,
  selected,
  onSelect,
}: SubscriptionStatusFilterChipsProps): ReactNode {
  const statusLabels = statusLabelsOf(labels);
  const slots: readonly FilterChipSlot[] = [
    { filter: "all", label: labels.filter.all, count: total, tone: "primary" },
    ...CHIP_STATUSES.map(status => ({
      filter: status,
      label: statusLabels[status],
      count: counts[status],
      tone: STATUS_TONE[status],
      icon: CHIP_ICONS[status],
    })),
  ];
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mb: 1.5 }}>
      {slots.map(slot => (
        <FilterChip key={slot.filter} slot={slot} selected={selected === slot.filter} onSelect={onSelect} />
      ))}
    </Stack>
  );
}
