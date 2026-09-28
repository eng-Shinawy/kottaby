"use client";

/**
 * activityTimelineEntry — one timeline entry row of the admin user DETAIL
 * page's activity timeline, extracted from `activityTimeline.tsx`
 * (file-size cap): `TimelineEntry` plus its private action→dot-tone
 * mapping. Per-entry rendering: a 10px dot tinted by the entry's action
 * tone (`actionDotToneOf` — success for create/reactivate, error for
 * delete/override, warning for suspend/adjust, primary otherwise; the
 * latest entry renders the solid tone, older entries a faded wash) joined
 * by 1px `divider` segments; entry = 600-weight action label + (applicant-
 * entity rows only) a small outlined entity tag + optional server-composed
 * caption line + `byActor actorName · relativeTime` sub-line + optional
 * localized changed-fields caption.
 */

import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { AuditActionType } from "@/frontend/graphql/generated/gql/graphql";
import {
  type ActivityEntry,
  type ActivityLabels,
  actionLabel,
  localizeAuditFieldName,
} from "@/frontend/views/admin/users/utils";

/** Theme palette key owning the dot tone for one audit action. */
type DotToneKey = "success" | "warning" | "error" | "primary";

/**
 * Action → dot-tone mapping (severity scanning, no i18n): lifecycle
 * positives tint success, destructive/manual-verdict actions tint error,
 * governance timers tint warning, and every other action keeps the
 * neutral primary accent.
 */
function actionDotToneOf(action: AuditActionType): DotToneKey {
  switch (action) {
    case AuditActionType.Create:
    case AuditActionType.Reactivate:
      return "success";
    case AuditActionType.Delete:
    case AuditActionType.Override:
      return "error";
    case AuditActionType.Suspend:
    case AuditActionType.Adjust:
      return "warning";
    default:
      return "primary";
  }
}

/**
 * Faded wash factor for non-latest timeline dots — slightly stronger in
 * dark mode so the hue survives the dark background.
 */
function fadedDotAlpha(mode: string): number {
  if (mode === "dark") return 0.32;
  return 0.28;
}

interface TimelineEntryProps {
  readonly entry: ActivityEntry;
  readonly isLatest: boolean;
  readonly hasNext: boolean;
  readonly labels: ActivityLabels;
  /** Locale-bound relative-time formatter. */
  readonly formatRelative: (raw: string | null | undefined) => string;
}

export function TimelineEntry({ entry, isLatest, hasNext, labels, formatRelative }: TimelineEntryProps): ReactNode {
  const tone = actionDotToneOf(entry.actionType);
  const isApplicantEntity = entry.entityType === "applicant";
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
            bgcolor: isLatest
              ? theme.palette[tone].main
              : alpha(theme.palette[tone].main, fadedDotAlpha(theme.palette.mode)),
          })}
        />
        {hasNext && (
          <Box aria-hidden sx={theme => ({ flex: 1, width: 1, minHeight: 24, bgcolor: theme.palette.divider })} />
        )}
      </Box>
      <Box sx={{ minWidth: 0, pb: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {actionLabel(entry.actionType, labels)}
          </Typography>
          {isApplicantEntity && (
            <Box
              sx={theme => ({
                px: 0.75,
                py: 0.125,
                borderRadius: 999,
                border: `1px solid ${theme.palette.divider}`,
                backgroundColor: alpha(theme.palette.secondary.main, theme.palette.mode === "dark" ? 0.16 : 0.08),
                typography: "caption",
                lineHeight: 1.6,
                color: theme.palette.text.secondary,
                whiteSpace: "nowrap",
              })}
            >
              {labels.activity.entityApplicantTag}
            </Box>
          )}
        </Box>
        {entry.caption && (
          <Typography variant="body2" sx={theme => ({ mt: 0.25, color: theme.palette.text.secondary })}>
            {entry.caption}
          </Typography>
        )}
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
