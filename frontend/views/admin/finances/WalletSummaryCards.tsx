"use client";

/**
 * WalletSummaryCards — the balance / total-earnings summary card pair of
 * the admin wallet inspector (`/admin/finances`, wallet tab), extracted
 * from the panel as a focused sibling component.
 *
 * Honest wallet state: the caller resolves the display strings — the
 * namespace's empty copy for the no-wallet state, the loading copy while
 * unresolved, else the real amount (never fake zeros).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { Box, Card, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/**
 * The wallet summary cards: balance / total earnings, the honest pair.
 * `balanceDisplay` / `totalEarningsDisplay` are pre-resolved display
 * strings (empty copy for the no-wallet state, never fake zeros).
 */
export function WalletSummaryCards({
  balanceDisplay,
  totalEarningsDisplay,
}: Readonly<{ balanceDisplay: string; totalEarningsDisplay: string }>): ReactNode {
  const t = useAppTranslation(AdminFinance);

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
      <Card
        sx={theme => ({
          borderRadius: "12px",
          border: `1px solid ${theme.palette.border.light}`,
          boxShadow: theme.palette.shadow.card,
        })}
        data-testid="admin-finances-balance-card"
      >
        <Stack spacing={1} sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="subtitle2" component="h3" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.balanceLabel}
          </Typography>
          <Typography variant="h5" component="p" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {balanceDisplay}
          </Typography>
        </Stack>
      </Card>
      <Card
        sx={theme => ({
          borderRadius: "12px",
          border: `1px solid ${theme.palette.border.light}`,
          boxShadow: theme.palette.shadow.card,
        })}
        data-testid="admin-finances-total-earnings-card"
      >
        <Stack spacing={1} sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="subtitle2" component="h3" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.totalEarningsLabel}
          </Typography>
          <Typography variant="h5" component="p" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {totalEarningsDisplay}
          </Typography>
        </Stack>
      </Card>
    </Box>
  );
}
