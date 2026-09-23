"use client";

import { Alert, DialogContent } from "@mui/material";
import type { ReactNode } from "react";
import type { DisputeResolution } from "@/frontend/graphql/generated/gql/graphql";
import { ResolveDisputeAmountField } from "@/frontend/views/admin/disputes/ResolveDisputeAmountField";
import { ResolveDisputeIntroBanner } from "@/frontend/views/admin/disputes/ResolveDisputeIntroBanner";
import { ResolveDisputeNoteField } from "@/frontend/views/admin/disputes/ResolveDisputeNoteField";
import {
  ResolveDisputeOptionGroup,
  type ResolveDisputeOutcomeOption,
} from "@/frontend/views/admin/disputes/ResolveDisputeOptionGroup";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** The note cap shared by the arbitration dialog surface. */
const MAX_NOTE_LENGTH = 500;

/**
 * The body of the arbitration dialog: the escrow-classified outcome radios,
 * the partial-refund amount field (only while a partial refund is the
 * picked outcome), the capped note field, and the stale-selection mismatch
 * alert — surfaced, never coerced.
 */
export function ResolveDisputeFormFields(
  props: Readonly<{
    introBody: string;
    selectionOffClass: boolean;
    mismatchCopy: string;
    options: readonly ResolveDisputeOutcomeOption[];
    resolution: DisputeResolution | null;
    onResolutionChange: (next: DisputeResolution | null) => void;
    groupLabel: string;
    isPartialRefund: boolean;
    partialAmount: string;
    onAmountChange: (next: string) => void;
    amountError: string | null;
    /** The disputed row's verbatim fee — the amount field's reference line. */
    fee: string | null;
    note: string;
    onNoteChange: (next: string) => void;
    t: SessionsLabels;
  }>
): ReactNode {
  const {
    introBody,
    selectionOffClass,
    mismatchCopy,
    options,
    resolution,
    onResolutionChange,
    groupLabel,
    isPartialRefund,
    partialAmount,
    onAmountChange,
    amountError,
    fee,
    note,
    onNoteChange,
    t,
  } = props;
  return (
    <DialogContent sx={{ display: "grid", gap: 2 }}>
      <ResolveDisputeIntroBanner body={introBody} />
      {selectionOffClass ? (
        <Alert severity="error" variant="outlined" data-testid="resolve-dispute-mismatch">
          {mismatchCopy}
        </Alert>
      ) : null}
      <ResolveDisputeOptionGroup
        options={options}
        value={resolution}
        onChange={onResolutionChange}
        groupLabel={groupLabel}
      />
      {isPartialRefund ? (
        <ResolveDisputeAmountField
          value={partialAmount}
          onChange={onAmountChange}
          errorMessage={amountError}
          fee={fee}
          t={t}
        />
      ) : null}
      <ResolveDisputeNoteField value={note} onChange={onNoteChange} maxLength={MAX_NOTE_LENGTH} t={t} />
    </DialogContent>
  );
}
