"use client";

/**
 * Shared presentational atoms for the admin academic-tracking surfaces —
 * the cell/value/pager building blocks consumed by BOTH the dashboard
 * container and the per-student drill-down (deep imports only; no barrel).
 *
 * Every atom is presentational: labels arrive already resolved by the
 * caller, values render exactly what the wire carries (localized digits
 * for display), and honest nulls render their dedicated label — never a
 * fabricated zero. MUI v9 discipline: `sx`-only styling, theme-palette
 * colors through callbacks, `*Outlined` icons, ≥44px touch targets on the
 * pager buttons.
 */

import { NavigateBeforeOutlined, NavigateNextOutlined } from "@mui/icons-material";
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminAcademicDashboardQuery_adminAcademicDashboard_items_jadidGradeSummary as AcademicGradeSummary,
  AdminAcademicAttentionReason,
  AdminAcademicDashboardQuery_adminAcademicDashboard_items_needsAttention,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  attentionReasonLabel,
  formatAcademicAverage,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-display";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

/** The shared attention-flag shape of both queries (dashboard row + detail payload). */
export type AcademicAttentionFlag = AdminAcademicDashboardQuery_adminAcademicDashboard_items_needsAttention;

interface AcademicGradeSummaryValueProps {
  /** Per-track grade summary — `null` when the track has no graded rows. */
  readonly summary: AcademicGradeSummary | null;
  readonly labels: AdminAcademicLabels;
  readonly locale: string;
  /**
   * Dense-table variant: the graded-count caption stays on ONE line
   * (ellipsis + `title` carrying the full copy) so every row keeps the
   * same height. The card layout omits this and lets the caption wrap.
   */
  readonly compact?: boolean;
}

/**
 * One per-track grade summary — the average over graded rows (or the
 * "not graded yet" copy when the average is null), with the honest graded
 * row count beneath.
 */
export function AcademicGradeSummaryValue({
  summary,
  labels,
  locale,
  compact,
}: Readonly<AcademicGradeSummaryValueProps>): ReactNode {
  const average = summary === null ? null : summary.averageGrade;
  const averageText = average === null ? labels.gradeNotGraded : formatAcademicAverage(average, locale);
  const gradedCountText = labels.gradedHomeworkCount(summary === null ? 0 : summary.gradedCount);
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" component="p" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {averageText}
      </Typography>
      <Typography
        variant="caption"
        component="p"
        title={compact ? gradedCountText : undefined}
        noWrap={compact}
        sx={theme => ({ color: theme.palette.text.secondary, ...(compact ? { maxWidth: 100 } : {}) })}
      >
        {gradedCountText}
      </Typography>
    </Stack>
  );
}

interface AcademicAttentionChipsProps {
  /** The student's attention flag — `null` means unflagged (renders nothing). */
  readonly flag: AcademicAttentionFlag | null;
  readonly labels: AdminAcademicLabels;
  /**
   * Optional visible badge label rendered ahead of the reason chips (the
   * dashboard row's "Needs attention" badge). Omitted on surfaces whose
   * section heading already carries the flag context.
   */
  readonly badgeLabel?: string;
}

/**
 * Attention-reason chips — one localized chip per crossed threshold, in
 * the backend's canonical reason order. A null flag (unflagged student)
 * renders nothing, never an empty badge.
 */
export function AcademicAttentionChips({ flag, labels, badgeLabel }: Readonly<AcademicAttentionChipsProps>): ReactNode {
  if (flag === null || flag.reasons.length === 0) {
    return null;
  }
  const resolve = (reason: AdminAcademicAttentionReason): string => attentionReasonLabel(reason, labels);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
      {badgeLabel !== undefined ? <Chip label={badgeLabel} color="warning" size="small" /> : null}
      {flag.reasons.map(reason => (
        <Chip key={reason} label={resolve(reason)} color="warning" size="small" variant="outlined" />
      ))}
    </Stack>
  );
}

interface AcademicHistoryPagerProps {
  /** The EFFECTIVE page echoed by the envelope — never a client-local counter. */
  readonly page: number;
  readonly pageCount: number;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly pageOfLabel: (page: number, pageCount: number) => string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

/**
 * Pagination row for a history section — the honest page counter
 * (`Page X of Y`) echoing the envelope's effective page and ceiling count,
 * with Previous/Next bounded by that envelope. Renders nothing when the
 * section has no pages at all (an empty section shows its empty state).
 */
export function AcademicHistoryPager({
  page,
  pageCount,
  previousLabel,
  nextLabel,
  pageOfLabel,
  onPrevious,
  onNext,
}: Readonly<AcademicHistoryPagerProps>): ReactNode {
  if (pageCount <= 0) {
    return null;
  }
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", justifyContent: { xs: "center", md: "space-between" }, flexWrap: "wrap", rowGap: 1 }}
    >
      {/* The directory-pager posture: icon-only chevrons (RTL-mirrored)
          with the localized label as tooltip + aria-label, clamped at the
          edges — composed inside one hairline pill so the pair reads as a
          single interactive control, not two loose icons. */}
      <Stack
        direction="row"
        spacing={0.5}
        sx={theme => ({
          alignItems: "center",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: "24px",
          paddingInline: 0.75,
          paddingBlock: 0.25,
        })}
      >
        <Tooltip title={previousLabel}>
          <span>
            <IconButton
              aria-label={previousLabel}
              disabled={page <= 1}
              onClick={onPrevious}
              sx={{ width: 44, height: 44 }}
            >
              <NavigateBeforeOutlined
                sx={theme => ({ transform: theme.direction === "rtl" ? "scaleX(-1)" : "none" })}
              />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={nextLabel}>
          <span>
            <IconButton
              aria-label={nextLabel}
              disabled={page >= pageCount}
              onClick={onNext}
              sx={{ width: 44, height: 44 }}
            >
              <NavigateNextOutlined sx={theme => ({ transform: theme.direction === "rtl" ? "scaleX(-1)" : "none" })} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Box component="p" sx={theme => ({ margin: 0, color: theme.palette.text.secondary })}>
        <Typography variant="body2" component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {pageOfLabel(page, pageCount)}
        </Typography>
      </Box>
    </Stack>
  );
}
