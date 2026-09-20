"use client";

/**
 * WithdrawDialogParts — the withdrawal-request dialog's extracted pieces:
 * the live "balance after this request" preview chip and the cancel /
 * submit actions row. Siblings of `WithdrawDialog` (split to stay under
 * the function-size tier).
 *
 * MUI v9 `sx`-only discipline, theme-palette colors.
 */

import { Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { WalletLabels } from "@/shared/locale/types/wallet";

/**
 * The live "balance after this request" preview chip — the honest
 * pre-commit view of the debit-on-request semantics (funds freeze the
 * moment the request is accepted). Rendered only while the typed amount
 * is client-valid (the field's own error hint owns the invalid state).
 */
export function WithdrawBalanceAfterPreview({
  remaining,
  t,
}: Readonly<{ remaining: string; t: WalletLabels }>): ReactNode {
  return (
    <Typography
      data-testid="wallet-balance-after"
      variant="caption"
      sx={theme => ({
        mt: 1.5,
        display: "inline-block",
        px: 1.25,
        py: 0.5,
        borderRadius: 1.5,
        fontVariantNumeric: "tabular-nums",
        bgcolor: theme.palette.surfaceContainerLow,
        color: theme.palette.onSurfaceVariant,
      })}
    >
      {t.balanceAfterRequest(remaining)}
    </Typography>
  );
}

/**
 * The dialog actions row — the AA-contrast neutral outlined cancel and the
 * on-primary submit (disabled while in flight or client-invalid).
 */
export function WithdrawDialogActions({
  inFlight,
  submitDisabled,
  onClose,
  onSubmit,
  t,
  tc,
}: Readonly<{
  inFlight: boolean;
  submitDisabled: boolean;
  onClose: () => void;
  onSubmit: () => void;
  t: WalletLabels;
  tc: CommonLabels;
}>): ReactNode {
  return (
    <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end", px: 3, pb: 2.5, pt: 1 }}>
      <Button
        onClick={onClose}
        disabled={inFlight}
        variant="outlined"
        sx={theme => ({
          minHeight: 44,
          // Neutral outlined cancel: text.primary on the dark paper holds AA
          // (the branded primary lane measured ~3.2:1 here); the border rides
          // the shared outline token so the control reads quiet but solid.
          color: theme.palette.text.primary,
          borderColor: theme.palette.outline,
        })}
      >
        {tc.cancel}
      </Button>
      <Button
        data-testid="wallet-withdraw-submit"
        onClick={onSubmit}
        disabled={submitDisabled}
        variant="contained"
        sx={theme => ({
          minHeight: 44,
          // Full-contrast M3 on-primary label; scoped to the enabled state
          // so MUI's disabled token still owns the in-flight look.
          "&:not(.Mui-disabled)": { color: theme.palette.onPrimary },
        })}
      >
        {t.withdrawSubmit}
      </Button>
    </Stack>
  );
}
