"use client";

/**
 * activityTimeline — the timeline internals of `RecentActivityCard` (the
 * per-user activity card on the admin user DETAIL page): the timeline entry
 * list body and the always-rendered "View Full Audit Log" link button.
 *
 * - `ActivityBody`: body renderer in priority order — loading spinner
 *   (initial load only; refresh keeps stale data) → inline error → centered
 *   empty state → the newest-first timeline. A top-level function keeps the
 *   card body free of nested ternaries (sonarjs/no-nested-conditional).
 * - `ActivityAuditButton`: outlined link button, always rendered so the
 *   audit surface stays one click away (full-width footer in the
 *   populated/loading/error states, inline in the compact empty state).
 *
 * Per-entry row rendering (dot tinting, entity tag, caption lines) lives in
 * `activityTimelineEntry.tsx` (file-size cap extraction). Action/field
 * label localization lives in `activityAuditLabels.ts`.
 */

import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { TimelineEntry } from "@/frontend/views/admin/users/detail/activityTimelineEntry";
import type { ActivityEntry, ActivityLabels } from "@/frontend/views/admin/users/utils";

interface ActivityBodyProps {
  readonly loading: boolean;
  readonly entries: ReadonlyArray<ActivityEntry> | undefined;
  readonly error: unknown;
  readonly labels: ActivityLabels;
  readonly formatRelative: (raw: string | null | undefined) => string;
}

export function ActivityBody({ loading, entries, error, labels, formatRelative }: ActivityBodyProps): ReactNode {
  if (loading && !entries) {
    return (
      <Stack sx={{ alignItems: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Stack>
    );
  }
  if (error) {
    return <Alert severity="warning">{labels.errorState.title}</Alert>;
  }
  const items = entries ?? [];
  if (items.length === 0) {
    return (
      <Typography variant="body2" sx={theme => ({ py: 4, textAlign: "center", color: theme.palette.text.secondary })}>
        {labels.activity.empty}
      </Typography>
    );
  }
  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none" }} aria-label={labels.activity.title}>
      {items.map((entry, index) => (
        <TimelineEntry
          key={entry.id}
          entry={entry}
          isLatest={index === 0}
          hasNext={index < items.length - 1}
          labels={labels}
          formatRelative={formatRelative}
        />
      ))}
    </Box>
  );
}

interface ActivityAuditButtonProps {
  readonly labels: ActivityLabels;
  /** Full-width + top margin = the bottom-of-card footer (entries/loading/error);
   *  inline width = the compact empty state, where the Stack gap owns spacing. */
  readonly fullWidth: boolean;
}

/** Outlined "View Full Audit Log" link button — always rendered so the audit surface stays one click away. */
export function ActivityAuditButton({ labels, fullWidth }: ActivityAuditButtonProps): ReactNode {
  return (
    <Button
      component={Link}
      href="/audit"
      variant="outlined"
      sx={theme => ({
        ...(fullWidth && { mt: 2, width: "100%" }),
        minHeight: 54,
        borderColor: theme.palette.outlineVariant,
      })}
    >
      {labels.activity.viewFullAuditLog}
    </Button>
  );
}
