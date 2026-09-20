"use client";

/**
 * SubscriptionAuditLinkButton — the row's audit-trail deep link of the
 * admin drawer's subscription rows: `/audit` seeded with the row's own
 * entity pair (the server route sanitizes the seed, so the link degrades
 * to the unfiltered listing rather than an error).
 *
 * The trail-depth badge rides the link: the row's audit-entry count (the
 * read's `auditEntriesCount`) renders as a tabular-numeral pill so the
 * admin sees how deep the row's history runs BEFORE committing to the
 * navigation — a zero pill is the honest "nothing recorded yet" arm, and
 * the counted copy flows from the namespace's `auditLinkCount` forms.
 *
 * Presentational: the id, label, and counted badge copy arrive resolved;
 * the link keeps the drawer's audit surface one click away without
 * leaving the admin role zone. MUI v9 `sx`-only styling, theme tokens
 * only; the counted context rides as visually-hidden real text so the
 * link's accessible name carries it while the visible pill stays a bare
 * count.
 */
import { ManageSearchOutlined as AuditTrailIcon } from "@mui/icons-material";
import { Box, Button, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/**
 * Visually-hidden text styles — the standard clip-into-1px recipe (the
 * NotificationRowContent precedent; px STRING literals because MUI's sx
 * transforms reinterpret bare numbers as spacing tokens).
 */
const VISUALLY_HIDDEN_TEXT_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

interface SubscriptionAuditLinkButtonProps {
  /** The subscription's wire id (the audit rows' entity id). */
  readonly subscriptionId: string;
  /** The link label (resolved in the owning card). */
  readonly label: string;
  /** The row's audit-entry count (the trail-depth badge). */
  readonly count: number;
  /** The counted badge copy (the namespace's `auditLinkCount` form). */
  readonly countLabel: string;
}

export function SubscriptionAuditLinkButton({
  subscriptionId,
  label,
  count,
  countLabel,
}: SubscriptionAuditLinkButtonProps): ReactNode {
  return (
    <Button
      component={Link}
      href={`/audit?entityType=subscription&entityId=${subscriptionId}`}
      size="small"
      variant="text"
      startIcon={<AuditTrailIcon />}
      endIcon={<TrailDepthBadge count={count} countLabel={countLabel} />}
      sx={theme => ({
        ...focusVisibleRingSx,
        minHeight: 32,
        px: 1,
        alignSelf: "flex-start",
        color: theme.palette.text.secondary,
        "&:hover": { color: theme.palette.text.primary, bgcolor: theme.palette.action.hover },
      })}
    >
      {label}
    </Button>
  );
}

/**
 * The trail-depth pill: a compact tabular-numeral count on the action-hover
 * lane. The visible value is the bare number (the pill shape + position
 * speak "badge"); the counted copy rides as visually-hidden REAL text so
 * the link's accessible name reads the full "… 1 entry" context instead of
 * a bare digit (the NotificationRowContent visually-hidden precedent).
 */
function TrailDepthBadge({ count, countLabel }: { count: number; countLabel: string }): ReactNode {
  return (
    <Box
      component="span"
      title={countLabel}
      sx={theme => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 20,
        height: 20,
        px: 0.75,
        borderRadius: 10,
        bgcolor: theme.palette.action.hover,
        border: `1px solid ${theme.palette.border.light}`,
        fontVariantNumeric: "tabular-nums",
      })}
    >
      <Typography
        component="span"
        variant="caption"
        aria-hidden
        sx={theme => ({ color: theme.palette.text.secondary, lineHeight: 1, fontWeight: 600 })}
      >
        {count}
      </Typography>
      <Typography component="span" variant="caption" sx={VISUALLY_HIDDEN_TEXT_SX}>
        {` ${countLabel}`}
      </Typography>
    </Box>
  );
}
