"use client";

/**
 * WalletBalanceCard — one tinted-icon balance summary card. The value
 * renders VERBATIM (a decimal string) beside the currency label — never
 * reformatted, never computed. Extracted verbatim from
 * `TeacherWalletContainer` (the max-lines split).
 *
 * The `tone` prop differentiates the two header cards at a glance: the
 * spendable balance wears the PRIMARY container tint (it drives the
 * withdrawal CTA), lifetime earnings keep the quiet SECONDARY tint.
 */

import { Avatar, Box, Paper, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export interface WalletBalanceCardProps {
  readonly testId: string;
  readonly label: string;
  readonly value: string | undefined;
  readonly currency: string | undefined;
  readonly loading: boolean;
  readonly icon: ReactNode;
  /** Icon-tile tone — `"primary"` marks the spendable-balance card. */
  readonly tone?: "primary" | "secondary";
}

/** One tinted-icon balance summary card — see the module docblock. */
export function WalletBalanceCard({
  testId,
  label,
  value,
  currency,
  loading,
  icon,
  tone = "secondary",
}: Readonly<WalletBalanceCardProps>): ReactNode {
  return (
    <Paper
      data-testid={testId}
      variant="outlined"
      sx={theme => ({
        p: 2.5,
        flex: 1,
        display: "flex",
        gap: 2,
        alignItems: "center",
        borderRadius: 3,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <Avatar
        variant="rounded"
        sx={theme => ({
          width: 44,
          height: 44,
          borderRadius: 2,
          ...(tone === "primary"
            ? { bgcolor: theme.palette.primaryContainer, color: theme.palette.onPrimaryContainer }
            : { bgcolor: theme.palette.secondaryContainer, color: theme.palette.onSecondaryContainer }),
        })}
      >
        {icon}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={theme => ({ mb: 0.5, color: theme.palette.onSurfaceVariant })}>
          {label}
        </Typography>
        {loading && value === undefined ? (
          <Skeleton width={96} height={32} />
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            <Typography
              data-testid={`${testId}-value`}
              variant="h5"
              sx={theme => ({
                fontWeight: 700,
                color: theme.palette.onSurface,
                fontVariantNumeric: "tabular-nums",
              })}
            >
              {value ?? "\u2014"}
            </Typography>
            {value !== undefined && currency !== undefined ? (
              <Typography variant="caption" sx={theme => ({ fontWeight: 600, color: theme.palette.onSurfaceVariant })}>
                {currency}
              </Typography>
            ) : null}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
