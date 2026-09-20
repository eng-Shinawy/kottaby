"use client";

/**
 * AuditDateRangeFields — the audit-trail filter bar's native date-input
 * from/to pair. Split from `AuditTrailFilterFields` so the fields grid's
 * component stays under the function-size cap. `lang` localizes the
 * browser's built-in date mask to the active UI locale instead of always
 * rendering English; `shrink` keeps the label floating above the native
 * date mask when the draft is empty (MUI never auto-shrinks for
 * `type="date"` — the label would overlap it).
 */

import { TextField } from "@mui/material";
import type { ReactNode } from "react";
import type { FilterDrafts } from "@/frontend/views/admin/audit/audit-trail-filters";

const FROM_DATE_INPUT_ID = "audit-trail-from-date";
const TO_DATE_INPUT_ID = "audit-trail-to-date";

interface AuditDateRangeFieldsProps {
  readonly drafts: FilterDrafts;
  readonly onDraftChange: (patch: Partial<FilterDrafts>) => void;
  readonly labels: {
    readonly fromDateLabel: string;
    readonly toDateLabel: string;
  };
  readonly fieldsDisabled: boolean;
  /** Active UI locale — localizes the browser's built-in date mask via `lang`. */
  readonly locale: string;
}

export function AuditDateRangeFields({
  drafts,
  onDraftChange,
  labels,
  fieldsDisabled,
  locale,
}: Readonly<AuditDateRangeFieldsProps>): ReactNode {
  return (
    <>
      <TextField
        id={FROM_DATE_INPUT_ID}
        type="date"
        fullWidth
        label={labels.fromDateLabel}
        value={drafts.from}
        onChange={event => onDraftChange({ from: event.target.value })}
        disabled={fieldsDisabled}
        slotProps={{ htmlInput: { lang: locale }, inputLabel: { shrink: true } }}
      />
      <TextField
        id={TO_DATE_INPUT_ID}
        type="date"
        fullWidth
        label={labels.toDateLabel}
        value={drafts.to}
        onChange={event => onDraftChange({ to: event.target.value })}
        disabled={fieldsDisabled}
        slotProps={{ htmlInput: { lang: locale }, inputLabel: { shrink: true } }}
      />
    </>
  );
}
