"use client";

/**
 * PaymentsFilterDateWindow — the from/to date-window fields of the
 * payments audit filter bar (`/admin/finances`, payments tab), extracted
 * from the filter bar as a focused sibling component: native `date` inputs
 * committed as inclusive from-midnight / exclusive to-midnight UTC
 * instants (the parsing lives in {@link paymentFilterDates}).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, ≥44px touch targets.
 */

import { Stack, TextField } from "@mui/material";
import type { ReactNode } from "react";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

interface PaymentsFilterDateWindowProps {
  /** The controlled from-draft (`""` = unset). */
  readonly from: string;
  /** The controlled to-draft (`""` = unset). */
  readonly to: string;
  /** From-draft change intent. */
  readonly onFromChange: (value: string) => void;
  /** To-draft change intent. */
  readonly onToChange: (value: string) => void;
}

/** The from/to date-window fields of the payments filter bar. */
export function PaymentsFilterDateWindow({
  from,
  to,
  onFromChange,
  onToChange,
}: Readonly<PaymentsFilterDateWindowProps>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    // The from/to pair shares ONE row at every breakpoint: on the narrowest
    // screens stacking them doubled the filter card's height and pushed the
    // payments table entirely below the fold; half-width date inputs stay
    // comfortably usable at 390px.
    <Stack sx={{ flexDirection: "row", gap: 1.5 }}>
      <TextField
        fullWidth
        type="date"
        label={t.dateFromLabel}
        value={from}
        onChange={event => onFromChange(event.target.value)}
        data-testid="admin-finances-filter-from"
        sx={{ "& input": { fontFamily: "inherit" } }}
        slotProps={{
          htmlInput: { autoComplete: "off" },
          // Native date inputs always paint their segments — an un-shrunk
          // label would overlap them.
          inputLabel: { shrink: true },
        }}
      />
      <TextField
        fullWidth
        type="date"
        label={t.dateToLabel}
        value={to}
        onChange={event => onToChange(event.target.value)}
        data-testid="admin-finances-filter-to"
        sx={{ "& input": { fontFamily: "inherit" } }}
        slotProps={{
          htmlInput: { autoComplete: "off" },
          inputLabel: { shrink: true },
        }}
      />
    </Stack>
  );
}
