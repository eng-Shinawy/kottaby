"use client";

import { TextField } from "@mui/material";
import type { ReactNode } from "react";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * ResolveDisputeAmountField — the partial-refund amount of the
 * `ResolveDisputeDialog`: rendered ONLY while the PARTIAL_REFUND outcome is
 * selected (the dialog owns that condition), validated by the dialog
 * against the fee-bounded money policy (`resolvePartialAmount.ts`). The
 * localized error swaps in for the blank helper the moment the dialog
 * raises it (live on a non-empty invalid value, or after a blocked submit);
 * MUI derives `aria-invalid` from the `error` state for assistive tech.
 *
 * Kept a sibling of `ResolveDisputeNoteField` for the dialog's
 * function-size budget; the value semantics stay owned by the dialog.
 */

interface ResolveDisputeAmountFieldProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Localized error copy (the errors-namespace amount policy) — `null` renders the field clean. */
  readonly errorMessage: string | null;
  /** The disputed row's verbatim fee — the amount's upper bound; `null` renders no reference line. */
  readonly fee: string | null;
  /** Localized sessions-namespace labels (field vocabulary). */
  readonly t: SessionsLabels;
}

/** Partial-refund amount — decimal money field with the fee reference and the localized policy error. */
export function ResolveDisputeAmountField({
  value,
  onChange,
  errorMessage,
  fee,
  t,
}: Readonly<ResolveDisputeAmountFieldProps>): ReactNode {
  const feeReference =
    fee === null ? null : t.partialAmountFeeReference.replace("{fee}", fee).replace("{currency}", SESSION_FEE_CURRENCY);

  return (
    <TextField
      value={value}
      onChange={event => {
        onChange(event.target.value);
      }}
      label={t.partialAmountLabel}
      placeholder={t.partialAmountPlaceholder}
      error={errorMessage !== null}
      helperText={errorMessage ?? feeReference ?? " "}
      inputMode="decimal"
      autoComplete="off"
      data-testid="resolve-dispute-amount-field"
      slotProps={{ htmlInput: { "data-testid": "resolve-dispute-amount-input" } }}
    />
  );
}
