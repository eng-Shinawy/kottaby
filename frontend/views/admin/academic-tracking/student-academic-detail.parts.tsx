"use client";

/**
 * Presentational parts of the per-student academic drill-down — the
 * back/refresh toolbar, the student header, the soft-delete governance
 * banner, and the progress summary card. Deep imports only (no barrel);
 * the container owns the query/pagination state, these render the settled
 * pieces with caller-resolved labels.
 *
 * The governance banner carries the account-deleted fact + audit-retention
 * copy ONLY — no deletion cause, date, or actor vocabulary (the disclosure
 * floor the locale suite pins). MUI v9 discipline: `sx`-only styling,
 * theme-palette colors via callbacks, `*Outlined` icons only, ≥44px touch
 * targets.
 */

import { ArrowBackOutlined, RefreshOutlined, TrendingUpOutlined } from "@mui/icons-material";
import { Alert, AlertTitle, Button, CircularProgress, Link as MuiLink, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_student } from "@/frontend/graphql/generated/gql/graphql";
import {
  AcademicAttentionChips,
  type AcademicAttentionFlag,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-cells";
import { ACADEMIC_TRACKING_DASHBOARD_ROUTE } from "@/frontend/views/admin/academic-tracking/academic-tracking-routes";
import { MetricCard } from "@/frontend/views/admin/analytics/MetricCard";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

interface DetailToolbarProps {
  readonly backLabel: string;
  readonly refreshLabel: string;
  /** Refresh disabled while the initial load is in flight or access is denied. */
  readonly refreshDisabled: boolean;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

/**
 * The drill-down toolbar — the back-to-dashboard affordance (a real link,
 * single-sourced route) beside the manual refresh CTA.
 */
export function DetailToolbar({
  backLabel,
  refreshLabel,
  refreshDisabled,
  refreshing,
  onRefresh,
}: Readonly<DetailToolbarProps>): ReactNode {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", rowGap: 1.5 }}
    >
      <MuiLink
        component={Link}
        href={ACADEMIC_TRACKING_DASHBOARD_ROUTE}
        underline="none"
        sx={theme => ({
          color: theme.palette.primary.main,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          borderRadius: "6px",
          "&:hover": { color: theme.palette.primary.dark },
        })}
      >
        <ArrowBackOutlined fontSize="small" />
        {backLabel}
      </MuiLink>
      <Button
        variant="outlined"
        onClick={onRefresh}
        disabled={refreshDisabled}
        startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshOutlined />}
        sx={{ minHeight: 44 }}
      >
        {refreshLabel}
      </Button>
    </Stack>
  );
}

interface DetailStudentHeaderProps {
  readonly student: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_student;
  readonly labels: AdminAcademicLabels;
}

/** The drill-down header — the interpolated title, subtitle, and identity line. */
export function DetailStudentHeader({ student, labels }: Readonly<DetailStudentHeaderProps>): ReactNode {
  return (
    <Stack spacing={1}>
      <Typography variant="h4" component="h2">
        {labels.detailPageTitle(student.fullName)}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.detailPageSubtitle}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.emailLabel}: {student.email}
      </Typography>
    </Stack>
  );
}

interface DetailGovernanceBannerProps {
  readonly title: string;
  readonly body: string;
}

/**
 * The soft-deleted-student governance banner — the retained academic
 * history stays viewable for audit, bannered never silent.
 */
export function DetailGovernanceBanner({ title, body }: Readonly<DetailGovernanceBannerProps>): ReactNode {
  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={theme => ({ borderRadius: 2, borderColor: theme.palette.border.main })}
    >
      <AlertTitle sx={{ mb: 0.5 }}>{title}</AlertTitle>
      <Typography variant="body2" component="p">
        {body}
      </Typography>
    </Alert>
  );
}

interface DetailProgressCardProps {
  readonly progressRowCount: number;
  /** The student's attention flag — `null` renders no chips at all. */
  readonly attentionFlag: AcademicAttentionFlag | null;
  readonly labels: AdminAcademicLabels;
}

/** The progress summary card — the honest pluralized count + attention chips. */
export function DetailProgressCard({
  progressRowCount,
  attentionFlag,
  labels,
}: Readonly<DetailProgressCardProps>): ReactNode {
  return (
    <MetricCard icon={<TrendingUpOutlined />} title={labels.progressSectionTitle}>
      <Typography variant="body2" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {labels.progressRowCount(progressRowCount)}
      </Typography>
      <AcademicAttentionChips flag={attentionFlag} labels={labels} badgeLabel={labels.attentionSectionTitle} />
    </MetricCard>
  );
}
