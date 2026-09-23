"use client";

import { ShowChartOutlined } from "@mui/icons-material";
import { Box, Stack, Typography, useTheme } from "@mui/material";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  type DotItemDotProps,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ParentChildReportsQuery_parentChildReports_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

interface RatingPoint {
  readonly session: string;
  readonly rating: number;
}

function buildRatingData(
  items: readonly ParentChildReportsQuery_parentChildReports_items[],
  locale: string
): readonly RatingPoint[] {
  const points: RatingPoint[] = [];
  for (const item of items) {
    if (item.studentRatingByTeacher !== null) {
      const dateIso = item.sessionStartedAt ?? item.createdAt;
      points.push({ session: formatApplicantDate(dateIso, locale), rating: item.studentRatingByTeacher });
    }
  }
  return points.toReversed();
}

/**
 * Per-point dot renderer: earlier points stay small primary dots; the
 * LATEST point pops larger (r 5) with a background-paper stroke ring so
 * the "where we are now" end of the trend reads at a glance. SVG paint
 * order keeps the stroked curve on top of the gradient fill beneath it.
 */
function renderTrendDot(latestIndex: number, dotFill: string, ringStroke: string) {
  function TrendDot(dotProps: DotItemDotProps): ReactNode {
    const { cx, cy, index } = dotProps;
    const isLatest = index === latestIndex;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={isLatest ? 5 : 3}
        fill={dotFill}
        stroke={isLatest ? ringStroke : dotFill}
        strokeWidth={isLatest ? 2 : 0}
      />
    );
  }
  return TrendDot;
}

export function RatingTrendChart({
  items,
  labels,
  locale,
}: Readonly<{
  items: readonly ParentChildReportsQuery_parentChildReports_items[];
  labels: ParentMonitoringLabels;
  locale: string;
}>): ReactNode {
  const theme = useTheme();
  const chronological = buildRatingData(items, locale);

  // RTL mirror: Arabic reads right-to-left, so the timeline flows right →
  // left — the newest session plots at the LEFT end of the axis and the
  // value axis moves to the right edge, matching the reading direction of
  // every other localized surface. Reversing the chronological points is
  // the whole mirror: recharts plots categories in data order, so the
  // reversed array puts the latest rating at index 0 (the left end), where
  // the latest-point emphasis lands for RTL instead of the LTR right end.
  const isRtl = locale === "ar";
  const data = isRtl ? chronological.toReversed() : chronological;
  const latestIndex = isRtl ? 0 : chronological.length - 1;

  if (data.length === 0) {
    return (
      <Box sx={t => ({ p: 2, borderRadius: 2, bgcolor: t.palette.action.hover, textAlign: "center" })}>
        <Stack spacing={1} sx={{ alignItems: "center" }}>
          <ShowChartOutlined sx={t => ({ fontSize: 32, color: t.palette.text.secondary })} />
          <Typography variant="body2" sx={t => ({ color: t.palette.text.secondary })}>
            {labels.ratingTrendEmpty}
          </Typography>
        </Stack>
      </Box>
    );
  }

  const gridStroke = theme.palette.divider;
  const lineStroke = theme.palette.primary.main;
  const tooltipBorder = theme.palette.divider;
  const tooltipBg = theme.palette.background.paper;
  // Reference into the <defs> gradient below — the URL carries no color; the
  // gradient stops themselves are theme-palette tokens.
  const trendFillUrl = "url(#parent-rating-trend-fill)";
  // Chart gutters mirror with the reading direction: the negative value-
  // axis gutter hugs the axis's own side (left in LTR, right in RTL).
  const chartMargin = isRtl
    ? { top: 5, right: -20, bottom: 16, left: 10 }
    : { top: 5, right: 10, bottom: 16, left: -20 };

  return (
    <Box sx={t => ({ p: 2, borderRadius: 2, bgcolor: t.palette.action.hover })}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
        {labels.ratingTrendHeading}
      </Typography>
      {/* Semantic <figure> + aria-label gives the SVG chart an accessible name for screen readers (oxlint prefer-tag-over-role rejects role="img" shims). */}
      <Box component="figure" aria-label={labels.ratingTrendHeading} sx={{ width: "100%", height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={[...data]} margin={chartMargin}>
            <defs>
              <linearGradient id="parent-rating-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineStroke} stopOpacity={0.2} />
                <stop offset="100%" stopColor={lineStroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey="session"
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              orientation={isRtl ? "right" : "left"}
              domain={[0, 5]}
              ticks={[0, 1, 2, 3, 4, 5]}
              tick={{ fontSize: 12, verticalAnchor: "middle", fill: theme.palette.text.secondary }}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid " + tooltipBorder,
                boxShadow: theme.shadows[3],
                fontSize: 12,
                backgroundColor: tooltipBg,
              }}
              labelStyle={{ fontWeight: 700 }}
              itemStyle={{ fontWeight: 600 }}
            />
            <Area
              type="monotone"
              dataKey="rating"
              stroke={lineStroke}
              strokeWidth={2}
              fill={trendFillUrl}
              dot={renderTrendDot(latestIndex, lineStroke, tooltipBg)}
              activeDot={{ r: 6 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
