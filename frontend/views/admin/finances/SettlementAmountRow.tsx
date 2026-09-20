"use client";

/**
 * SettlementAmountRow — the labeled pending-amount value row shared by the
 * withdrawal settlement dialogs ({@link ApproveWithdrawalDialog} /
 * {@link RejectWithdrawalDialog}): the caption (the namespace's amount
 * header) beside the pre-formatted amount on a tinted pill. The amount is
 * the decision's whole substance, so both dialogs surface it the SAME way
 * instead of burying it in copy — one recipe, two consumers.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors.
 */

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

interface SettlementAmountRowProps {
  /** The pending amount, pre-formatted (the queue row's own display form). */
  readonly amount: string;
  /** Accessible/test hook — names the dialog arm ("approve" / "reject"). */
  readonly testId: string;
}

/** The labeled amount pill of the settlement dialogs (approve + reject). */
export function SettlementAmountRow({ amount, testId }: Readonly<SettlementAmountRowProps>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={theme => ({
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 2,
        py: 1,
        px: 1.5,
        borderRadius: 1.5,
        bgcolor: theme.palette.surfaceContainerHigh,
      })}
    >
      <Typography variant="caption" component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
        {t.amountHeader}
      </Typography>
      <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }} data-testid={testId}>
        {amount}
      </Typography>
    </Stack>
  );
}
