"use client";

/**
 * WithdrawDialog — the withdrawal-request dialog, extracted from
 * `TeacherWalletContainer` (the max-lines split). The amount field is a
 * plain controlled TextField (inputMode decimal); the live hint renders the
 * available balance; the submit CTA disables while the input fails the
 * client mirror OR the request is in flight. Failure arms keep the dialog
 * open (honest retry surface) and surface the denial through the container
 * snackbar. The preview chip + actions row live in `WithdrawDialogParts`
 * (the function-size split).
 */

import CloseOutlined from "@mui/icons-material/CloseOutlined";
import {
  CircularProgress,
  Dialog,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { isClientValidAmount } from "@/frontend/views/teacher/wallet/teacherWalletShared";
import {
  WithdrawBalanceAfterPreview,
  WithdrawDialogActions,
} from "@/frontend/views/teacher/wallet/WithdrawDialogParts";
import { WithdrawQuickAmounts } from "@/frontend/views/teacher/wallet/WithdrawQuickAmounts";
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

  // Live "balance after this request" preview — the honest pre-commit view
  // of the debit-on-request semantics (funds freeze the moment the request
  // is accepted). Computed from the same 2-decimal wire strings the server
  // validates, so the preview can never disagree with the settled state by
  // a float rounding step. Hidden entirely while the typed amount is
  // client-invalid (the field's own error hint owns that state).
  const remainingAfterRequest = useMemo(() => {
    if (!clientValid) return null;
    const remaining = Number(balance) - Number(trimmed);
    return remaining.toFixed(2);
  }, [balance, clientValid, trimmed]);

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
      <DialogTitle sx={{ fontWeight: 700, paddingInlineEnd: 6 }}>{t.withdrawDialogTitle}</DialogTitle>
      <IconButton
        data-testid="wallet-withdraw-dialog-close"
        aria-label={tc.close}
        onClick={onClose}
        disabled={inFlight}
        sx={theme => ({
          position: "absolute",
          top: 8,
          // Logical inline-end pin: the button rides the dialog's end edge and
          // mirrors to the correct physical side under RTL on its own.
          insetInlineEnd: 8,
          color: theme.palette.onSurfaceVariant,
        })}
      >
        <CloseOutlined fontSize="small" />
      </IconButton>
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
        <WithdrawQuickAmounts
          balance={balance}
          disabled={inFlight}
          label={t.quickAmountsAria}
          quickLabels={[t.quickAmountQuarter, t.quickAmountHalf, t.quickAmountFull]}
          onPick={setAmount}
        />
        {remainingAfterRequest !== null ? (
          <WithdrawBalanceAfterPreview remaining={remainingAfterRequest} t={t} />
        ) : null}
        {inFlight ? <WithdrawInFlight label={t.withdrawSubmit} /> : null}
      </DialogContent>
      <WithdrawDialogActions
        inFlight={inFlight}
        submitDisabled={submitDisabled}
        onClose={onClose}
        onSubmit={handleSubmit}
        t={t}
        tc={tc}
      />
    </Dialog>
  );
}

/** The in-flight row — a compact progress line under the form. */
function WithdrawInFlight({ label }: Readonly<{ label: string }>): ReactNode {
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "center" }}>
      <CircularProgress size={18} />
      <Typography variant="caption" sx={theme => ({ color: theme.palette.onSurfaceVariant })}>
        {label}
      </Typography>
    </Stack>
  );
}
