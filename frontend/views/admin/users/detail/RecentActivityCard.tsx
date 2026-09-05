"use client";

/**
 * RecentActivityCard — the per-user activity timeline card of the admin user
 * DETAIL page (prototype "Recent Activity" / audit trail card).
 *
 * The audit-entry label logic (`actionLabel` / `localizeAuditFieldName`,
 * moved out of `AdminUserDetailContainer` earlier) now lives in
 * `activityAuditLabels.ts`; the timeline body (`TimelineEntry` /
 * `ActivityBody`) and the footer `ActivityAuditButton` live in
 * `activityTimeline.tsx`.
 *
 * Composition:
 *  - Title row: HistoryOutlined (primary) + title + trailing "View All"
 *    text button linking to the `/audit` route.
 *  - Timeline: per-entry 10px dot (latest filled `primary`, older
 *    `surfaceContainerHighest`) joined by 1px `divider` segments; entry =
 *    600-weight action label + `byActor actorName · relativeTime` sub-line +
 *    optional localized changed-fields caption.
 *  - States: loading spinner (initial load only), inline warning on query
 *    failure (never blocks the page), centered compact empty state (muted
 *    28px history icon + centered copy + the inline audit button, 16px
 *    gaps) — the empty content is vertically centered inside the card,
 *    which always stretches to the grid column like any other state.
 *  - Footer: full-width outlined "View Full Audit Log" button linking to
 *    `/audit` — rendered for the loading/error/populated states pinned to
 *    the card bottom (spacer + flex column, mirroring `GovernanceCard`); in
 *    the empty state the same button renders inline directly under the copy.
 */

import { HistoryOutlined as HistoryIcon } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminUserActivityQuery } from "@/frontend/graphql/generated/gql/graphql";
import { ActivityAuditButton, ActivityBody, DetailCard, DetailCardTitle } from "@/frontend/views/admin/users/detail";
import type { ActivityLabels } from "@/frontend/views/admin/users/utils";

interface RecentActivityCardProps {
  readonly labels: ActivityLabels;
  readonly activityLoading: boolean;
  readonly activityData: AdminUserActivityQuery | undefined;
  readonly activityError: unknown;
  readonly formatRelative: (raw: string | null | undefined) => string;
}

export function RecentActivityCard({
  labels,
  activityLoading,
  activityData,
  activityError,
  formatRelative,
}: RecentActivityCardProps): ReactNode {
  const hasEntries = (activityData?.adminUserActivity?.length ?? 0) > 0;
  // Settled + no rows → centered compact empty state: the card still spans
  // the grid column (width + stretch); only the CONTENT stays compact and
  // is vertically centered so no dead zone or mis-sized card appears.
  const isCompactEmpty = !activityLoading && !activityError && !hasEntries;
  return (
    // flexGrow wrapper: the wide grid column stretches to the row height; the
    // card becomes a flex column and the spacer above the footer button pins
    // it to the card bottom (mirrors GovernanceCard in the narrow column).
    // `width: 100%` + column direction keep the card at full column width in
    // EVERY state — the empty state included — so it never shrinks to its
    // content; in the empty state the compact content centers vertically.
    <Box
      sx={{
        flexGrow: 1,
        minWidth: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        "& > *": { flexGrow: 1, display: "flex", flexDirection: "column" },
      }}
    >
      <DetailCard>
        <DetailCardTitle
          icon={<HistoryIcon />}
          title={labels.activity.title}
          trailing={
            hasEntries ? (
              <Button component={Link} href="/audit" size="small" sx={{ whiteSpace: "nowrap" }}>
                {labels.activity.viewAll}
              </Button>
            ) : undefined
          }
        />
        {isCompactEmpty ? (
          <Stack sx={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 2, py: 2 }}>
            <HistoryIcon aria-hidden sx={theme => ({ fontSize: 28, color: theme.palette.text.secondary })} />
            <Typography variant="body2" sx={theme => ({ textAlign: "center", color: theme.palette.text.secondary })}>
              {labels.activity.empty}
            </Typography>
            <ActivityAuditButton labels={labels} fullWidth={false} />
          </Stack>
        ) : (
          <>
            <ActivityBody
              loading={activityLoading}
              entries={activityData?.adminUserActivity}
              error={activityError}
              labels={labels}
              formatRelative={formatRelative}
            />
            {/* Spacer absorbs the column stretch so the footer sits at the bottom. */}
            <Box aria-hidden sx={{ flexGrow: 1 }} />
            <ActivityAuditButton labels={labels} fullWidth />
          </>
        )}
      </DetailCard>
    </Box>
  );
}
