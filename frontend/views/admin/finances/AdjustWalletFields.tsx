"use client";

/**
 * AdjustWalletFields — the form fields section of the manual
 * wallet-adjustment dialog (`/admin/finances`, wallet tab): the
 * credit/debit choice pair over the amount and reason fields, extracted
 * from the dialog as a focused sibling component.
 *
 * The invalid states render the namespace's denial copy beside the fields;
 * the caller owns the draft state, the submit grammar (the backend's
 * decimal-grammar mirror) and the outcome surfaces.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { Button, Stack, TextField, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** Muted overline + owner name — names the wallet the adjustment targets. */
function TeacherIdentityCaption({ teacherName }: Readonly<{ teacherName: string }>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <Stack spacing={0.5}>
      <Typography
        variant="caption"
        component="p"
        sx={theme => ({
          color: theme.palette.text.secondary,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        })}
      >
        {t.teacherPickerLabel}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.primary, fontWeight: 600 })}>
        {teacherName}
      </Typography>
    </Stack>
  );
}

/**
 * Direction-button skin — the debit arm carries the error lane (the
 * balance-decreasing direction reads as the risky one); credit keeps the
 * primary lane.
 */
function directionButtonSx(direction: "credit" | "debit", active: boolean): SxProps<Theme> {
  return theme => {
    if (direction !== "debit") {
      return { minHeight: { xs: 44, sm: 40 }, flex: 1 };
    }
    return {
      minHeight: { xs: 44, sm: 40 },
      flex: 1,
      ...(active
        ? {
            bgcolor: theme.palette.error.main,
            color: theme.palette.onError,
            "&:hover": { bgcolor: theme.palette.error.dark },
          }
        : { borderColor: theme.palette.error.main, color: theme.palette.error.main }),
    };
  };
}

/** The dialog's fields: choice pair + amount + reason, with error flags. */
export function AdjustWalletFields({
  teacherName,
  drafts,
  amountError,
  reasonError,
  onAmountChange,
  onReasonChange,
  onDirectionPick,
}: Readonly<{
  teacherName: string;
  drafts: { readonly amount: string; readonly direction: "credit" | "debit"; readonly reason: string };
  amountError: boolean;
  reasonError: boolean;
  onAmountChange: (amount: string) => void;
  onReasonChange: (reason: string) => void;
  onDirectionPick: (direction: "credit" | "debit") => void;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);

  return (
    <>
      <TeacherIdentityCaption teacherName={teacherName} />
      <Stack direction="row" spacing={1}>
        {(["credit", "debit"] as const).map(direction => (
          <Button
            key={direction}
            type="button"
            variant={drafts.direction === direction ? "contained" : "outlined"}
            aria-pressed={drafts.direction === direction}
            onClick={() => {
              onDirectionPick(direction);
            }}
            data-testid={`admin-finances-adjust-direction-${direction}`}
            sx={directionButtonSx(direction, drafts.direction === direction)}
          >
            {direction === "credit" ? t.directionCredit : t.directionDebit}
          </Button>
        ))}
      </Stack>
      <TextField
        label={t.adjustAmountLabel}
        value={drafts.amount}
        onChange={event => {
          onAmountChange(event.target.value);
        }}
        required
        error={amountError}
        helperText={amountError ? t.adjustAmountInvalidMessage : undefined}
        aria-invalid={amountError}
        data-testid="admin-finances-adjust-amount"
        slotProps={{
          htmlInput: { inputMode: "decimal", autoComplete: "off" },
          inputLabel: { shrink: true },
        }}
      />
      <TextField
        label={t.adjustReasonLabel}
        value={drafts.reason}
        onChange={event => {
          onReasonChange(event.target.value);
        }}
        required
        multiline
        minRows={2}
        error={reasonError}
        helperText={reasonError ? t.adjustReasonInvalidMessage : undefined}
        aria-invalid={reasonError}
        data-testid="admin-finances-adjust-reason"
        slotProps={{
          htmlInput: { autoComplete: "off" },
          inputLabel: { shrink: true },
        }}
      />
    </>
  );
}
