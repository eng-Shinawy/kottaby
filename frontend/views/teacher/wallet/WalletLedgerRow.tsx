"use client";

/**
 * One ledger row — the wallet ledger's repeating unit.
 *
 * Row anatomy: a CSS grid whose named areas reflow between the compact
 * stacked card (below `md`: type/description block with the stamp under it,
 * amount above the status chip on the inline end) and the desktop table
 * layout (`md+`: description | date | status | amount columns aligned under
 * the shared header row). The date-time stamp and the signed amount render
 * in bidi-isolated LTR boxes so the Unicode bidi algorithm can never detach
 * their fragments from the row's base direction — the stamp itself is the
 * pure-ASCII `formatLedgerStamp` (an ICU `ar` stamp embeds RLM controls that
 * reorder the neutral punctuation INSIDE the LTR box: QA finding); the
 * locale-aware full stamp rides the native `title` tooltip. The free-form
 * description gets `dir="auto"` so mixed-script copy always picks its own
 * base.
 */

import ArrowOutwardOutlinedIcon from "@mui/icons-material/ArrowOutwardOutlined";
import { Avatar, Box, Chip, ListItem, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MyWalletQuery_myWallet_transactions } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import {
  avatarTone,
  ledgerRowVisual,
  ledgerStatusColor,
  ledgerStatusLabel,
  ledgerTypeLabel,
  signedAmount,
} from "@/frontend/views/teacher/wallet/walletLedgerVisuals";
import type { WalletLabels } from "@/shared/locale/types/wallet";

/** The newest-first ledger row — avatar, type/description, date, status, signed amount. */
export function WalletLedgerRow({
  row,
  isLast,
  locale,
  t,
}: Readonly<{
  row: MyWalletQuery_myWallet_transactions;
  isLast: boolean;
  locale: string;
  t: WalletLabels;
}>): ReactNode {
  const visual = ledgerRowVisual(row.type);
  // The outward arrow is the one directional glyph in the set — the payout
  // flow reads "funds leaving" in both directions once it mirrors under RTL;
  // the plus/gift/gavel glyphs are direction-neutral.
  const isDirectionalGlyph = visual.Icon === ArrowOutwardOutlinedIcon;
  const amount = signedAmount(row);
  const isDebit = amount.startsWith("-");
  return (
    <ListItem
      key={row.id}
      data-testid={`wallet-ledger-row-${row.id}`}
      divider={!isLast}
      sx={{
        display: "grid",
        alignItems: "center",
        columnGap: { xs: 1.5, md: 2 },
        rowGap: 0.25,
        // Roomier rows on the desktop/tablet grid: a short ledger inside the
        // viewport-stretching card reads deliberate when each row carries
        // its own air, instead of pooling the spare height under the list.
        py: { xs: 1.25, md: 2 },
        gridTemplateColumns: {
          xs: "auto minmax(0, 1fr) auto",
          md: "40px minmax(0, 1fr) 152px 88px 96px",
        },
        gridTemplateRows: { xs: "auto auto", md: "auto" },
        gridTemplateAreas: {
          xs: '"avatar text amount" "avatar date status"',
          md: '"avatar text date status amount"',
        },
      }}
    >
      <Box sx={{ gridArea: "avatar", display: "flex" }}>
        <Avatar variant="rounded" sx={theme => ({ borderRadius: 2, ...avatarTone(row.type, theme.palette) })}>
          <visual.Icon
            fontSize="small"
            sx={
              isDirectionalGlyph
                ? theme => ({ transform: theme.direction === "rtl" ? "scaleX(-1)" : "none" })
                : undefined
            }
          />
        </Avatar>
      </Box>
      <Stack spacing={0.25} sx={{ gridArea: "text", minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {ledgerTypeLabel(row.type, t)}
        </Typography>
        {row.description !== null ? (
          <Typography
            variant="caption"
            dir="auto"
            sx={theme => ({
              color: theme.palette.onSurfaceVariant,
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
              overflowWrap: "anywhere",
            })}
          >
            {row.description}
          </Typography>
        ) : null}
      </Stack>
      <Typography
        variant="caption"
        dir="ltr"
        title={formatApplicantDate(row.createdAt, locale)}
        sx={theme => ({
          gridArea: "date",
          // Hug the column's start edge so the stamp lines up with the
          // header label in both flow directions (the isolated LTR box
          // itself must not stretch across the fixed-width track).
          justifySelf: "start",
          unicodeBidi: "isolate",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
          color: theme.palette.onSurfaceVariant,
          cursor: "default",
        })}
      >
        {formatLedgerStamp(row.createdAt)}
      </Typography>
      <Box sx={{ gridArea: "status", justifySelf: "end" }}>
        <Chip
          data-testid={`wallet-ledger-row-${row.id}-status`}
          label={ledgerStatusLabel(row.status, t)}
          color={ledgerStatusColor(row.status)}
          size="small"
          variant="outlined"
        />
      </Box>
      <WalletLedgerAmount rowId={row.id} amount={amount} isDebit={isDebit} />
    </ListItem>
  );
}

/** The signed amount cell — an isolated LTR box with one tone per sign. */
function WalletLedgerAmount({
  rowId,
  amount,
  isDebit,
}: Readonly<{ rowId: string; amount: string; isDebit: boolean }>): ReactNode {
  return (
    <Typography
      data-testid={`wallet-ledger-row-${rowId}-amount`}
      dir="ltr"
      sx={theme => ({
        gridArea: "amount",
        justifySelf: "end",
        unicodeBidi: "isolate",
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        // One success tone for every credit (the sign already separates
        // earning from bonus); debits stay on the error tone.
        color: isDebit ? theme.palette.error.main : theme.palette.success.main,
      })}
    >
      {amount}
    </Typography>
  );
}
