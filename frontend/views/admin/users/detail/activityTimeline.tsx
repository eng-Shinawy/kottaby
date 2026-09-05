"use client";

/**
 * activityTimeline — the timeline internals of `RecentActivityCard` (the
 * per-user activity card on the admin user DETAIL page): the timeline entry
 * list body and the always-rendered "View Full Audit Log" link button.
 *
 * - `TimelineEntry`: per-entry 10px dot (latest filled `primary`, older
 *   `surfaceContainerHighest`) joined by 1px `divider` segments; entry =
 *   600-weight action label + `byActor actorName · relativeTime` sub-line +
 *   optional localized changed-fields caption.
 * - `ActivityBody`: body renderer in priority order — loading spinner
 *   (initial load only; refresh keeps stale data) → inline error → centered
 *   empty state → the newest-first timeline. A top-level function keeps the
 *   card body free of nested ternaries (sonarjs/no-nested-conditional).
 * - `ActivityAuditButton`: outlined link button, always rendered so the
 *   audit surface stays one click away (full-width footer in the
 *   populated/loading/error states, inline in the compact empty state).
 *
 * Action/field label localization lives in `activityAuditLabels.ts`.
 */

import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  type ActivityEntry,
  type ActivityLabels,
  actionLabel,
  localizeAuditFieldName,
} from "@/frontend/views/admin/users/utils";

interface TimelineEntryProps {
  readonly entry: ActivityEntry;
  readonly isLatest: boolean;
  readonly hasNext: boolean;
  readonly labels: ActivityLabels;
  /** Locale-bound relative-time formatter. */
  readonly formatRelative: (raw: string | null | undefined) => string;
}

function TimelineEntry({ entry, isLatest, hasNext, labels, formatRelative }: TimelineEntryProps): ReactNode {
  return (
    <Box component="li" sx={{ display: "flex", gap: 1.5 }}>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 12 }}>
        <Box
          aria-hidden
          sx={theme => ({
            width: 10,
            height: 10,
            borderRadius: "50%",
            flexShrink: 0,
            mt: "5px",
            bgcolor: isLatest ? theme.palette.primary.main : theme.palette.surfaceContainerHighest,
          })}
        />
        {hasNext && (
          <Box aria-hidden sx={theme => ({ flex: 1, width: 1, minHeight: 24, bgcolor: theme.palette.divider })} />
        )}
      </Box>
      <Box sx={{ minWidth: 0, pb: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {actionLabel(entry.actionType, labels)}
        </Typography>
        <Typography variant="caption" sx={theme => ({ display: "block", color: theme.palette.text.secondary })}>
          {labels.activity.byActor} {entry.actorName} · {formatRelative(entry.createdAt)}
        </Typography>
        {entry.changedFields && entry.changedFields.length > 0 && (
          <Typography variant="caption" sx={theme => ({ display: "block", color: theme.palette.text.secondary })}>
            {labels.activity.changedFields}{" "}
            {entry.changedFields.map(field => localizeAuditFieldName(field, labels)).join(", ")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

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
        minHeight: 44,
        borderColor: theme.palette.outlineVariant,
      })}
    >
      {labels.activity.viewFullAuditLog}
    </Button>
  );
}
