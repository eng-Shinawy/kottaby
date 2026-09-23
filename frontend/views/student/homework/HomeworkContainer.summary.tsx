"use client";

import { AssignmentOutlined, HourglassEmptyOutlined, TaskAltOutlined } from "@mui/icons-material";
import { Box, ButtonBase } from "@mui/material";
import type { ReactNode } from "react";
import { DashboardStatCard } from "@/frontend/views/dashboard/home/DashboardStatCard";
import {
  type HomeworkStatusFilter,
  type HomeworkSummary,
  toggleHomeworkFilter,
} from "@/frontend/views/student/homework/homework.helpers";
import type { HomeworkLabels } from "@/shared/locale/types/homework";

/**
 * The three-card honest partition strip (total / graded / pending) — and
 * the status filter: each card is a toggle button over the SAME partition
 * the list filters by, so the cards and the list can never disagree. The
 * active bucket gets a primary ring + tint; clicking it again returns to
 * the unfiltered view (aria-pressed communicates the toggle state).
 */
export function SummaryStrip({
  summary,
  labels: t,
  active,
  onToggle,
}: Readonly<{
  summary: HomeworkSummary;
  labels: HomeworkLabels;
  active: HomeworkStatusFilter;
  onToggle: (filter: HomeworkStatusFilter) => void;
}>): ReactNode {
  const cards = [
    { key: "all", label: t.summaryTotalLabel, value: summary.total, Icon: AssignmentOutlined, aria: t.filterAllLabel },
    {
      key: "graded",
      label: t.summaryGradedLabel,
      value: summary.graded,
      Icon: TaskAltOutlined,
      aria: t.filterGradedLabel,
    },
    {
      key: "pending",
      label: t.summaryPendingLabel,
      value: summary.pending,
      Icon: HourglassEmptyOutlined,
      aria: t.filterPendingLabel,
    },
  ] as const;
  return (
    <Box
      data-testid="student-homework-summary"
      sx={{
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
      }}
    >
      {cards.map(card => {
        const selected = active === card.key;
        return (
          <ButtonBase
            key={card.key}
            component="button"
            type="button"
            aria-pressed={selected}
            aria-label={card.aria}
            onClick={() => {
              onToggle(toggleHomeworkFilter(active, card.key));
            }}
            sx={theme => ({
              display: "block",
              width: "100%",
              textAlign: "inherit",
              borderRadius: 3,
              transition: theme.transitions.create(["box-shadow", "border-color", "background-color"], {
                duration: theme.transitions.duration.short,
                easing: theme.transitions.easing.easeOut,
              }),
            })}
          >
            <DashboardStatCard
              stat={{ label: card.label, value: String(card.value), Icon: card.Icon }}
              selected={selected}
            />
          </ButtonBase>
        );
      })}
    </Box>
  );
}
