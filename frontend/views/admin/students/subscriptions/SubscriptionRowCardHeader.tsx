"use client";

/**
 * SubscriptionRowCardHeader — the heading block of the admin drawer's
 * subscription row cards: the tinted plan glyph, the plan-snapshot title,
 * the `#<id>` seam identifier, and the copy-id quick action (the
 * directory's copy-email convention — the id in `#<id>` display format,
 * never an internal-only raw value).
 *
 * Presentational: the row + resolved copy labels arrive via props; every
 * visible string resolves in the owning section through the
 * `subscriptionAdmin` namespace. MUI v9 `sx`-only styling, theme tokens
 * only; the id line is tabular-numeral so dense ids stay aligned.
 */
import { CardMembershipOutlined as CardMembershipIcon } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SubscriptionCopyIdButton } from "@/frontend/views/admin/students/subscriptions/SubscriptionCopyIdButton";
import type { SubscriptionRow } from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";

interface SubscriptionRowCardHeaderProps {
  readonly row: SubscriptionRow;
  readonly copyIdLabels: {
    readonly copy: string;
    readonly copied: string;
  };
}

export function SubscriptionRowCardHeader({ row, copyIdLabels }: SubscriptionRowCardHeaderProps): ReactNode {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 0.5 }}>
      <PlanGlyph />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" component="div" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
          {row.plan.title}
        </Typography>
        <Typography
          variant="caption"
          sx={theme => ({ color: theme.palette.text.secondary, fontVariantNumeric: "tabular-nums" })}
        >
          {`#${row.id}`}
        </Typography>
      </Box>
      <SubscriptionCopyIdButton
        subscriptionId={row.id}
        copyLabel={copyIdLabels.copy}
        copiedLabel={copyIdLabels.copied}
      />
    </Stack>
  );
}

/** The tinted plan glyph heading the card (the directory's icon-circle recipe, compact). */
function PlanGlyph(): ReactNode {
  return (
    <Box
      aria-hidden
      sx={theme => ({
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: "10px",
        flexShrink: 0,
        bgcolor: theme.palette.secondaryContainer,
        color: theme.palette.onSecondaryContainer,
      })}
    >
      <CardMembershipIcon sx={{ fontSize: 19 }} />
    </Box>
  );
}
