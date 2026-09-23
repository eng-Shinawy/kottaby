"use client";

/**
 * PaymentsFilterBar — the payments audit panel's filter bar: a real
 * `<form>` whose submit narrows the query (NEVER per-field `onChange`
 * queries; `React.SubmitEvent` discipline). The bar edits a DRAFT (raw
 * strings; the student search is a free-text substring the server escapes
 * and ILIKE-wraps; dates are native `date` inputs committed as inclusive
 * from-midnight / exclusive to-midnight UTC instants) and lifts only the
 * settled outcomes: `onApply` receives the applied filter record, `onReset`
 * restores the unfiltered listing.
 *
 * The canonical enum-typed option lists live in the co-located
 * {@link paymentsFilterOptions} module; the date-draft parsing in
 * {@link paymentFilterDates}.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, ≥44px touch targets.
 */

import { SearchOutlined } from "@mui/icons-material";
import { InputAdornment, TextField } from "@mui/material";
import { type ReactNode, useId, useState } from "react";
import type { PaymentGateway, PaymentStatus } from "@/frontend/graphql/generated/gql/graphql";
import { parseUtcDayStart } from "@/frontend/views/admin/audit/audit-trail-filters";
import { FilterActionsRow } from "@/frontend/views/admin/directory-shared/FilterActionsRow";
import { FilterSectionShell } from "@/frontend/views/admin/directory-shared/FilterSectionShell";
import { PaymentsFilterDateWindow } from "@/frontend/views/admin/finances/PaymentsFilterDateWindow";
import { PaymentsGatewaySelect, PaymentsStatusSelect } from "@/frontend/views/admin/finances/PaymentsFilterSelects";
import { parseUtcDayEndExclusive } from "@/frontend/views/admin/finances/paymentFilterDates";
import { GATEWAY_OPTIONS, STATUS_OPTIONS } from "@/frontend/views/admin/finances/paymentsFilterOptions";
import type { AppliedPaymentFilters } from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** Filter drafts — raw controlled input shape (`""` = unset). */
interface PaymentFilterDrafts {
  readonly studentName: string;
  readonly status: PaymentStatus | "";
  readonly paymentGateway: PaymentGateway | "";
  readonly from: string;
  readonly to: string;
}

/** Type guard — narrows a Select wire value onto `PaymentStatus` (fail-closed to `""`). */
function isPaymentStatus(value: string): value is PaymentStatus {
  return (STATUS_OPTIONS as readonly string[]).includes(value);
}

/** Type guard — narrows a Select wire value onto `PaymentGateway` (fail-closed to `""`). */
function isPaymentGateway(value: string): value is PaymentGateway {
  return (GATEWAY_OPTIONS as readonly string[]).includes(value);
}

const EMPTY_DRAFTS: PaymentFilterDrafts = {
  studentName: "",
  status: "",
  paymentGateway: "",
  from: "",
  to: "",
};

interface PaymentsFilterBarProps {
  /** Apply intent — receives the applied filter record built from drafts. */
  readonly onApply: (applied: AppliedPaymentFilters) => void;
  /** Reset intent — restores the unfiltered listing. */
  readonly onReset: () => void;
}

/** The payments audit filter section (search + status + gateway + window). */
export function PaymentsFilterBar({ onApply, onReset }: Readonly<PaymentsFilterBarProps>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  const [drafts, setDrafts] = useState<PaymentFilterDrafts>(EMPTY_DRAFTS);

  const statusSelectId = useId();
  const gatewaySelectId = useId();
  const SEARCH_INPUT_ID = "admin-finances-filter-student";
  const STATUS_LABEL_ID = "admin-finances-filter-status-label";
  const GATEWAY_LABEL_ID = "admin-finances-filter-gateway-label";

  const updateDraft = (patch: Partial<PaymentFilterDrafts>): void => {
    setDrafts(current => ({ ...current, ...patch }));
  };

  const handleStatusChange = (value: string): void => {
    updateDraft({ status: isPaymentStatus(value) ? value : "" });
  };

  const handleGatewayChange = (value: string): void => {
    updateDraft({ paymentGateway: isPaymentGateway(value) ? value : "" });
  };

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const inverted =
      drafts.from !== "" &&
      drafts.to !== "" &&
      (parseUtcDayStart(drafts.from)?.getTime() ?? 0) > (parseUtcDayStart(drafts.to)?.getTime() ?? 0);
    onApply({
      studentName: drafts.studentName.trim() || null,
      status: drafts.status === "" ? null : drafts.status,
      paymentGateway: drafts.paymentGateway === "" ? null : drafts.paymentGateway,
      from: inverted || drafts.from === "" ? null : parseUtcDayStart(drafts.from),
      to: inverted || drafts.to === "" ? null : parseUtcDayEndExclusive(drafts.to),
    });
  };

  const handleReset = (): void => {
    setDrafts(EMPTY_DRAFTS);
    onReset();
  };

  return (
    <FilterSectionShell
      testId="admin-finances-payments-filters"
      title={t.filtersTitle}
      gridTemplateColumns={{ xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }}
      onSubmit={handleSubmit}
    >
      <TextField
        id={SEARCH_INPUT_ID}
        fullWidth
        label={t.studentSearchLabel}
        value={drafts.studentName}
        onChange={event => updateDraft({ studentName: event.target.value })}
        data-testid="admin-finances-filter-student"
        slotProps={{
          htmlInput: { autoComplete: "off", placeholder: t.studentSearchPlaceholder },
          inputLabel: { shrink: true },
          // Leading search icon — sibling fields carry trailing
          // caret/calendar affordances; the search input matches.
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} />
              </InputAdornment>
            ),
          },
        }}
      />

      <PaymentsStatusSelect
        value={drafts.status}
        id={statusSelectId}
        labelId={STATUS_LABEL_ID}
        onChange={handleStatusChange}
      />

      <PaymentsGatewaySelect
        value={drafts.paymentGateway}
        id={gatewaySelectId}
        labelId={GATEWAY_LABEL_ID}
        onChange={handleGatewayChange}
      />

      <PaymentsFilterDateWindow
        from={drafts.from}
        to={drafts.to}
        onFromChange={value => {
          updateDraft({ from: value });
        }}
        onToChange={value => {
          updateDraft({ to: value });
        }}
      />

      <FilterActionsRow
        onReset={handleReset}
        resetTestId="admin-finances-filters-reset"
        resetLabel={t.resetFilters}
        applySubmitsForm
        applyTestId="admin-finances-filters-apply"
        applyLabel={t.applyFilters}
      />
    </FilterSectionShell>
  );
}
