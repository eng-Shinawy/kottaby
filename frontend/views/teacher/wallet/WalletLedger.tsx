"use client";

/**
 * WalletLedger — the newest-first transaction ledger list, extracted
 * verbatim from `TeacherWalletContainer`'s `WalletBody` (the max-lines
 * split: the list was the bulk of the body's line count). Rows carry the
 * tinted type avatar, the signed amount (a string PREFIX — never math),
 * the status chip, and the description · date secondary line.
 */

import {
  Avatar,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import type { MyWalletQuery_myWallet_transactions } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  amountTone,
  avatarTone,
  ledgerRowVisual,
  ledgerStatusColor,
  ledgerStatusLabel,
  ledgerTypeLabel,
  signedAmount,
} from "@/frontend/views/teacher/wallet/walletLedgerVisuals";
import type { WalletLabels } from "@/shared/locale/types/wallet";

export interface WalletLedgerProps {
  readonly transactions: readonly MyWalletQuery_myWallet_transactions[];
  readonly locale: string;
  readonly t: WalletLabels;
}

/** The ledger list — see the module docblock. */
export function WalletLedger({ transactions, locale, t }: Readonly<WalletLedgerProps>): ReactNode {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={theme => ({
          px: 2.5,
          py: 1.5,
          alignItems: "center",
          bgcolor: theme.palette.surfaceContainerLow,
        })}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {t.ledgerTitle}
        </Typography>
      </Stack>
      <Divider />
      <List data-testid="wallet-ledger" disablePadding>
        {transactions.map((row, index) => {
          const visual = ledgerRowVisual(row.type);
          return (
            <ListItem
              key={row.id}
              data-testid={`wallet-ledger-row-${row.id}`}
              divider={index < transactions.length - 1}
              secondaryAction={
                <Stack spacing={0.5} sx={{ alignItems: "flex-end" }}>
                  <Typography
                    data-testid={`wallet-ledger-row-${row.id}-amount`}
                    sx={theme => ({
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: amountTone(row.type, theme.palette),
                    })}
                  >
                    {signedAmount(row)}
                  </Typography>
                  <Chip
                    data-testid={`wallet-ledger-row-${row.id}-status`}
                    label={ledgerStatusLabel(row.status, t)}
                    color={ledgerStatusColor(row.status)}
                    size="small"
                    variant="outlined"
                  />
                </Stack>
              }
              sx={{ pr: { xs: 14, sm: 16 } }}
            >
              <ListItemAvatar>
                <Avatar variant="rounded" sx={theme => ({ borderRadius: 2, ...avatarTone(row.type, theme.palette) })}>
                  <visual.Icon fontSize="small" />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={ledgerTypeLabel(row.type, t)}
                secondary={
                  row.description === null
                    ? formatApplicantDate(row.createdAt, locale)
                    : `${row.description} · ${formatApplicantDate(row.createdAt, locale)}`
                }
                slotProps={{
                  primary: { variant: "body2", sx: { fontWeight: 600 } },
                  secondary: { variant: "caption" },
                }}
              />
            </ListItem>
          );
        })}
      </List>
    </Paper>
  );
}
