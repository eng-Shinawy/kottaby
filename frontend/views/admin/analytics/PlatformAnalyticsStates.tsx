"use client";

/**
 * Platform-analytics state surfaces: the `aria-busy` initial-load skeleton
 * (mirrors the populated grid geometry — 7 metric cards + 2 chart slots at
 * the shared `METRIC_GRID_SX`/`TRENDS_GRID_SX`/`TREND_CHART_BODY_HEIGHT`
 * constants; per-card row counts approximate), the load-failure `Alert`
 * with its retry CTA, and the query-context FORBIDDEN denied notice (the
 * governed-admin edge the page guard cannot see — the server guard passed,
 * the read model denied). Every string comes from the `Analytics` labels;
 * the raw server `message` is NEVER rendered.
 *
 * MUI v9 discipline: `sx`-only styling, `theme.palette.*` tokens only,
 * `*Outlined` icons, ≥44px touch target on the retry CTA.
 */

import { RefreshOutlined } from "@mui/icons-material";
import { Alert, AlertTitle, Box, Button, Card, Skeleton, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import {
  METRIC_GRID_SX,
  TREND_CHART_BODY_HEIGHT,
  TRENDS_GRID_SX,
} from "@/frontend/views/admin/analytics/platform-analytics-display";
import type { AnalyticsLabels } from "@/shared/locale/types/analytics";

/**
 * Skeleton rows per metric card — title line + three value lines. A fixed
 * approximation: populated metric cards carry 2–11 content rows.
 */
const SKELETON_ROWS_PER_CARD = 4;

/** Skeleton metric cards — one per populated metric section (seven). */
const SKELETON_METRIC_CARDS = 7;

/** Skeleton chart cards per trends row — one per populated trend chart (two). */
const SKELETON_CHART_SLOTS = 2;

/** Shared shell of every skeleton card — mirrors MetricCard/TrendChartCard. */
const SKELETON_CARD_SX: SxProps<Theme> = theme => ({
  borderRadius: "12px",
  border: `1px solid ${theme.palette.border.light}`,
  boxShadow: theme.palette.shadow.card,
  height: "100%",
});

/** One metric-card skeleton: title line + the fixed placeholder rows. */
function MetricCardSkeleton({ cardIndex }: Readonly<{ cardIndex: number }>): ReactNode {
  const key = `platform-analytics-metric-skeleton-${cardIndex}`;
  return (
    <Card sx={SKELETON_CARD_SX}>
      <Stack spacing={2} sx={{ padding: { xs: 2, md: 2.5 } }}>
        <Skeleton variant="rounded" height={28} width="55%" />
        {Array.from({ length: SKELETON_ROWS_PER_CARD }, (_unused, rowIndex) => rowIndex + 1).map(rowIndex => (
          <Skeleton key={`${key}-row-${rowIndex}`} variant="rounded" height={20} />
        ))}
      </Stack>
    </Card>
  );
}

/**
 * One chart-card skeleton mirroring `TrendChartCard`: glyph/title/chip
 * header placeholder over a body slot at the shared `TREND_CHART_BODY_HEIGHT`
 * (reused verbatim from the dynamic-chart loading skeleton).
 */
function TrendChartCardSkeleton(): ReactNode {
  return (
    <Card sx={SKELETON_CARD_SX}>
      <Stack spacing={2} sx={{ padding: { xs: 2, md: 2.5 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Skeleton variant="circular" width={36} height={36} />
            <Skeleton variant="rounded" height={28} width="45%" />
          </Stack>
          <Skeleton variant="rounded" height={24} width={64} />
        </Stack>
        <TrendChartBodySkeleton />
      </Stack>
    </Card>
  );
}

/**
 * Initial-load skeleton mirroring the populated grid geometry (7 metric
 * cards + 2 chart slots at shared heights); per-card row counts approximate
 * the populated cards' variable rows. The seven metric-card skeletons sit
 * in the shared `METRIC_GRID_SX`, the trends row in the shared
 * `TRENDS_GRID_SX`, the chart-slot bodies at the shared
 * `TREND_CHART_BODY_HEIGHT` — all card-shaped, wrapped in the
 * `component="output" aria-busy` output region.
 */
export function PlatformAnalyticsSkeleton(): ReactNode {
  return (
    <Box component="output" aria-busy sx={{ display: "block" }}>
      <Stack spacing={3}>
        <Box data-testid="platform-analytics-metric-skeleton" sx={METRIC_GRID_SX}>
          {Array.from({ length: SKELETON_METRIC_CARDS }, (_unused, index) => index + 1).map(cardIndex => (
            <MetricCardSkeleton key={`platform-analytics-metric-skeleton-${cardIndex}`} cardIndex={cardIndex} />
          ))}
        </Box>
        <Box data-testid="platform-analytics-trends-skeleton" sx={TRENDS_GRID_SX}>
          {Array.from({ length: SKELETON_CHART_SLOTS }, (_unused, index) => index + 1).map(chartIndex => (
            <TrendChartCardSkeleton key={`platform-analytics-chart-skeleton-${chartIndex}`} />
          ))}
        </Box>
      </Stack>
    </Box>
  );
}

interface PlatformAnalyticsLoadErrorProps {
  readonly labels: AnalyticsLabels;
  readonly onRetry: () => void;
  readonly retryPending: boolean;
}

/**
 * Load-failure surface — inline `Alert severity="error"` with the localized
 * title/body and the Retry CTA (disabled while the retry is in flight).
 */
export function PlatformAnalyticsLoadError({
  labels,
  onRetry,
  retryPending,
}: Readonly<PlatformAnalyticsLoadErrorProps>): ReactNode {
  return (
    <Alert
      severity="error"
      variant="outlined"
      sx={theme => ({ borderRadius: "12px", borderColor: theme.palette.border.main })}
      action={
        <Button
          color="error"
          size="small"
          disabled={retryPending}
          onClick={onRetry}
          startIcon={<RefreshOutlined />}
          sx={{ ...focusVisibleRingSx, flexShrink: 0, minHeight: 54 }}
        >
          {labels.retryAction}
        </Button>
      }
    >
      <AlertTitle sx={{ fontWeight: 700 }}>{labels.loadErrorTitle}</AlertTitle>
      <Typography variant="body2" component="p">
        {labels.loadErrorBody}
      </Typography>
    </Alert>
  );
}

interface PlatformAnalyticsDeniedNoticeProps {
  readonly labels: AnalyticsLabels;
}

/**
 * Query-context FORBIDDEN notice — the localized denied copy IN-container.
 * No retry CTA: a permission denial is not retryable (the errorLink table
 * marks the FORBIDDEN row non-retryable).
 */
export function PlatformAnalyticsDeniedNotice({ labels }: Readonly<PlatformAnalyticsDeniedNoticeProps>): ReactNode {
  return (
    <Alert severity="error" variant="outlined" sx={{ borderRadius: "12px" }}>
      <AlertTitle sx={{ fontWeight: 700 }}>{labels.deniedTitle}</AlertTitle>
      <Typography variant="body2" component="p">
        {labels.deniedBody}
      </Typography>
    </Alert>
  );
}

/**
 * Chart-body skeleton at the shared `TREND_CHART_BODY_HEIGHT` — the body of
 * each initial-load chart placeholder AND the loading face of the dynamic
 * trend-chart chunks (one shared height constant → no layout shift in either
 * handoff).
 */
export function TrendChartBodySkeleton(): ReactNode {
  return <Skeleton variant="rounded" height={TREND_CHART_BODY_HEIGHT} />;
}
