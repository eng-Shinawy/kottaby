"use client";

/**
 * AdjustWalletDialog — the manual wallet-adjustment dialog of the admin
 * wallet inspector (`/admin/finances`, wallet tab): amount + credit/debit
 * choice + the mandatory reason, extracted from the panel as a focused
 * sibling component (the fields section lives in
 * {@link AdjustWalletFields}).
 *
 * The submit stays disabled until the amount matches the decimal grammar,
 * is non-zero, and the reason is non-empty; the invalid states render the
 * namespace's denial copy beside the fields. The raw server `message` is
 * NEVER echoed — the caller owns the outcome surfaces (the container-level
 * snackbar lanes).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, `*Outlined` icons.
 */

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { type ReactNode, useState } from "react";
import { AdjustWalletFields } from "@/frontend/views/admin/finances/AdjustWalletFields";
import { Common, useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** Adjustment dialog amount grammar — the backend's decimal grammar mirror. */
const ADJUSTMENT_AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

/** Adjustment dialog draft state (raw controlled strings). */
interface AdjustDialogDrafts {
  readonly amount: string;
  readonly direction: "credit" | "debit";
  readonly reason: string;
}

const EMPTY_ADJUST_DRAFTS: AdjustDialogDrafts = { amount: "", direction: "credit", reason: "" };

/**
 * The manual wallet-adjustment dialog: amount + credit/debit choice + the
 * mandatory reason. The submit stays disabled until the amount matches the
 * decimal grammar, is non-zero, and the reason is non-empty.
 */
export function AdjustWalletDialog({
  teacherName,
  open,
  onClose,
  onSubmit,
  loading,
  submitTestId,
}: Readonly<{
  teacherName: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { amount: string; direction: "credit" | "debit"; reason: string }) => void;
  loading: boolean;
  submitTestId: string;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  const tc = useAppTranslation(Common);
  const [drafts, setDrafts] = useState<AdjustDialogDrafts>(EMPTY_ADJUST_DRAFTS);
  const [amountInvalid, setAmountInvalid] = useState(false);
  const [reasonInvalid, setReasonInvalid] = useState(false);

  const amountError = amountInvalid || (drafts.amount !== "" && !ADJUSTMENT_AMOUNT_PATTERN.test(drafts.amount));
  // The backend's nonzero-digit string check mirror — no `Number()` parse
  // ever touches the money string on the client.
  const zeroAmount = drafts.amount !== "" && !/[1-9]/.test(drafts.amount);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) return;
    const amountValid = ADJUSTMENT_AMOUNT_PATTERN.test(drafts.amount) && /[1-9]/.test(drafts.amount);
    const reasonValid = drafts.reason.trim() !== "";
    setAmountInvalid(!amountValid);
    setReasonInvalid(!reasonValid);
    if (!amountValid || !reasonValid) return;
    onSubmit({ amount: drafts.amount, direction: drafts.direction, reason: drafts.reason.trim() });
  };

  const handleDialogClose = (): void => {
    if (!loading) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="adjust-wallet-dialog-title"
    >
      <DialogTitle id="adjust-wallet-dialog-title" sx={theme => ({ color: theme.palette.onSurface })}>
        {t.adjustDialogTitle}
      </DialogTitle>
      <form onSubmit={handleSubmit} noValidate style={{ display: "contents" }}>
        <DialogContent sx={{ display: "grid", gap: 2 }}>
          <AdjustWalletFields
            teacherName={teacherName}
            drafts={drafts}
            amountError={amountError || zeroAmount}
            reasonError={reasonInvalid}
            onAmountChange={amount => {
              setDrafts(current => ({ ...current, amount }));
              setAmountInvalid(false);
            }}
            onReasonChange={reason => {
              setDrafts(current => ({ ...current, reason }));
              setReasonInvalid(false);
            }}
            onDirectionPick={direction => {
              setDrafts(current => ({ ...current, direction }));
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button
            onClick={onClose}
            disabled={loading}
            variant="outlined"
            color="inherit"
            sx={{ minHeight: { xs: 44, sm: 40 }, px: 3, whiteSpace: "nowrap" }}
          >
            {tc.cancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading || drafts.amount.trim() === "" || drafts.reason.trim() === ""}
            data-testid={submitTestId}
            sx={{ minHeight: { xs: 44, sm: 40 }, px: 3, whiteSpace: "nowrap" }}
          >
            {t.adjustSubmit}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
