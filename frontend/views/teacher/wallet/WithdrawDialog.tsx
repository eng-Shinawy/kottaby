"use client";

/**
 * WithdrawDialog — the withdrawal-request dialog, extracted verbatim from
 * `TeacherWalletContainer` (the max-lines split). The amount field is a
 * plain controlled TextField (inputMode decimal); the live hint renders the
 * available balance; the submit CTA disables while the input fails the
 * client mirror OR the request is in flight. Failure arms keep the dialog
 * open (honest retry surface) and surface the denial through the container
 * snackbar.
 */

import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { isClientValidAmount } from "@/frontend/views/teacher/wallet/teacherWalletShared";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { WalletLabels } from "@/shared/locale/types/wallet";

export interface WithdrawDialogProps {
  readonly open: boolean;
  readonly balance: string;
  readonly inFlight: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (rawAmount: string) => void;
  readonly t: WalletLabels;
  readonly tc: CommonLabels;
}

/** The withdrawal-request dialog — see the module docblock. */
export function WithdrawDialog({
  open,
  balance,
  inFlight,
  onClose,
  onSubmit,
  t,
  tc,
}: Readonly<WithdrawDialogProps>): ReactNode {
  const [amount, setAmount] = useState("");

  const trimmed = useMemo(() => amount.trim(), [amount]);
  const clientValid = isClientValidAmount(trimmed);
  const submitDisabled = inFlight || !clientValid;

  const handleSubmit = useCallback((): void => {
    if (!clientValid) return;
    onSubmit(trimmed);
  }, [clientValid, onSubmit, trimmed]);

  return (
    <Dialog
      data-testid="wallet-withdraw-dialog"
      open={open}
      onClose={inFlight ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>{t.withdrawDialogTitle}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{t.withdrawDialogBody}</DialogContentText>
        <TextField
          data-testid="wallet-amount-input"
          autoFocus
          fullWidth
          label={t.amountLabel}
          placeholder={t.amountPlaceholder}
          value={amount}
          onChange={event => setAmount(event.target.value)}
          slotProps={{ htmlInput: { inputMode: "decimal" } }}
          error={trimmed !== "" && !clientValid}
          helperText={trimmed !== "" && !clientValid ? t.invalidAmount : t.availableBalanceHint(balance)}
          disabled={inFlight}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />
        {inFlight ? (
          <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "center" }}>
            <CircularProgress size={18} />
            <Typography variant="caption" sx={theme => ({ color: theme.palette.onSurfaceVariant })}>
              {t.withdrawSubmit}
            </Typography>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={inFlight} sx={{ minHeight: 44 }}>
          {tc.cancel}
        </Button>
        <Button
          data-testid="wallet-withdraw-submit"
          onClick={handleSubmit}
          disabled={submitDisabled}
          variant="contained"
          sx={{ minHeight: 44 }}
        >
          {t.withdrawSubmit}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
