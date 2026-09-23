"use client";

/**
 * SubscriptionRowCard chips — the row card's two status-toned pills:
 * `StatusChip` (the lifecycle status on its tone lane) and
 * `LastActionChip` (the last-audit-action pill speaking the SAME visual
 * language the audit trail table's action chips use — the secondary-
 * container pill — so the drawer's teaser and the trail's full listing
 * read as one surface). Split from `SubscriptionRowCard` (the 150-line
 * view-file convention).
 */

import { Box, Chip } from "@mui/material";
import type { ReactNode } from "react";
import type { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { STATUS_TONE } from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { toneColors } from "@/frontend/views/admin/users/utils";

interface StatusChipProps {
  readonly status: SubscriptionStatus;
  readonly labels: Record<SubscriptionStatus, string>;
}

/** The lifecycle status chip on the status's tone lane. */
export function StatusChip({ status, labels }: StatusChipProps): ReactNode {
  return (
    <Chip
      label={labels[status]}
      size="small"
      sx={theme => {
        const colors = toneColors(theme, STATUS_TONE[status]);
        return { bgcolor: colors.bg, color: colors.fg, fontWeight: 600 };
      }}
    />
  );
}

/**
 * The last-audit-action chip — the SAME visual language the audit trail
 * table speaks for action chips (the secondary-container pill), so the
 * drawer's teaser and the trail's full listing read as one surface.
 */
export function LastActionChip({ actionLabel }: { readonly actionLabel: string }): ReactNode {
  return (
    <Box
      component="span"
      sx={theme => ({
        display: "inline-flex",
        alignItems: "center",
        padding: theme.spacing(0.25, 1.25),
        borderRadius: 999,
        backgroundColor: theme.palette.secondaryContainer,
        color: theme.palette.onSecondaryContainer,
        fontSize: 13,
        fontWeight: 600,
      })}
    >
      {actionLabel}
    </Box>
  );
}
