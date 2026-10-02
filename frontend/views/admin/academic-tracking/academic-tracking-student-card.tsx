"use client";

/**
 * Admin academic-tracking stacked mobile card — the touch-layout
 * presentation of one dashboard row: identity, latest per-track positions,
 * per-track grade summaries, the honest progress count and last-graded
 * stamp, attention flags, and the drill-down link. Deep imports only; the
 * listing dispatcher composes it below the md breakpoint.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * tabular numerals on numeric values.
 */

import { Card, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminAcademicDashboardQuery_adminAcademicDashboard_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  AcademicAttentionChips,
  AcademicGradeSummaryValue,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-cells";
import { NULL_VALUE_PLACEHOLDER } from "@/frontend/views/admin/academic-tracking/academic-tracking-display";
import { AcademicPositionValue } from "@/frontend/views/admin/academic-tracking/academic-tracking-position-value";
import { formatCount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

type AcademicStudentRow = AdminAcademicDashboardQuery_adminAcademicDashboard_items;

/**
 * The track-lane separation styles: the Madi half carries a logical-inline
 * hairline so the two per-track lanes (Jadid | Madi) scan as a grid —
 * `borderInlineStart` mirrors automatically under RTL and never grows
 * into a layout element the way a divider node would.
 */
const madiLaneSx = (theme: Theme) => ({
  borderInlineStart: `1px solid ${theme.palette.divider}`,
  paddingInlineStart: 1.5,
});

/** The detail-link renderer is owned by the listing dispatcher (fail-closed). */
export type RenderDetailLink = (props: {
  readonly rowId: string;
  readonly fullName: string;
  /** Card context requests the forward-chevron affordance. */
  readonly withChevron?: boolean;
}) => ReactNode;

/** The stacked mobile card — the same honest values in a touch layout. */
export function AcademicStudentCard({
  row,
  labels,
  locale,
  renderDetailLink,
}: Readonly<{
  row: AcademicStudentRow;
  labels: AdminAcademicLabels;
  locale: string;
  renderDetailLink: RenderDetailLink;
}>): ReactNode {
  const renderLastGraded = (): string =>
    row.lastGradedHomeworkAt === null ? NULL_VALUE_PLACEHOLDER : formatApplicantDate(row.lastGradedHomeworkAt, locale);

  return (
    <Card variant="outlined" sx={theme => ({ borderRadius: "12px", borderColor: theme.palette.border.light })}>
      <Stack spacing={1.5} sx={{ padding: 2 }}>
        <Stack spacing={0.5}>
          <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
            {row.fullName}
          </Typography>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {row.email}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "stretch" }}>
          <Stack spacing={0.5} sx={{ flexBasis: "50%", flexGrow: 1 }}>
            <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
              {labels.columnLatestJadidPosition}
            </Typography>
            <AcademicPositionValue
              stacked
              position={row.latestJadidPosition}
              ayahRangeLabel={labels.ayahRangeLabel}
              locale={locale}
              noneLabel={labels.positionNone}
            />
          </Stack>
          <Stack spacing={0.5} sx={theme => ({ flexBasis: "50%", flexGrow: 1, ...madiLaneSx(theme) })}>
            <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
              {labels.columnLatestMadiPosition}
            </Typography>
            <AcademicPositionValue
              stacked
              position={row.latestMadiPosition}
              ayahRangeLabel={labels.ayahRangeLabel}
              locale={locale}
              noneLabel={labels.positionNone}
            />
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "stretch" }}>
          <Stack spacing={0.5} sx={{ flexBasis: "50%", flexGrow: 1 }}>
            <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
              {labels.columnJadidAverage}
            </Typography>
            <AcademicGradeSummaryValue summary={row.jadidGradeSummary} labels={labels} locale={locale} />
          </Stack>
          <Stack spacing={0.5} sx={theme => ({ flexBasis: "50%", flexGrow: 1, ...madiLaneSx(theme) })}>
            <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
              {labels.columnMadiAverage}
            </Typography>
            <AcademicGradeSummaryValue summary={row.madiGradeSummary} labels={labels} locale={locale} />
          </Stack>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ alignItems: "baseline", flexWrap: "wrap", rowGap: 1 }}>
          <Typography variant="body2" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {labels.columnProgressRows}: {formatCount(row.progressRowCount, locale)}
          </Typography>
          <Typography
            variant="body2"
            component="p"
            sx={theme => ({ color: theme.palette.text.secondary, fontVariantNumeric: "tabular-nums" })}
          >
            {labels.columnLastGradedAt}: {renderLastGraded()}
          </Typography>
        </Stack>
        <AcademicAttentionChips flag={row.needsAttention} labels={labels} badgeLabel={labels.attentionBadgeLabel} />
        {/* The drill-down action rides a hairline top edge so it reads as
            the card's action row, separated from the data above it. */}
        <Stack spacing={0.5} sx={theme => ({ borderTop: `1px solid ${theme.palette.divider}`, paddingTop: 1.5 })}>
          {renderDetailLink({ rowId: row.id, fullName: row.fullName, withChevron: true })}
        </Stack>
      </Stack>
    </Card>
  );
}
