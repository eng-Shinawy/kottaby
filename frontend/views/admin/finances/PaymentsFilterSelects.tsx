"use client";

/**
 * PaymentsFilterSelects — the status / gateway Select controls of the
 * payments audit filter bar (`/admin/finances`, payments tab), extracted
 * from the filter bar as focused sibling components. Each control renders
 * the enum-typed option list from {@link paymentsFilterOptions} with the
 * "all" escape option first, and lifts the raw wire value (the bar's type
 * guards narrow it onto the draft state).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, ≥44px touch targets.
 */

import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import type { ReactNode } from "react";
import type { PaymentGateway, PaymentStatus } from "@/frontend/graphql/generated/gql/graphql";
import { GATEWAY_OPTIONS, STATUS_OPTIONS } from "@/frontend/views/admin/finances/paymentsFilterOptions";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

interface PaymentsStatusSelectProps {
  /** The controlled draft value (`""` = the all-statuses option). */
  readonly value: PaymentStatus | "";
  /** The select's DOM id (`useId`-derived). */
  readonly id: string;
  /** The label's DOM id (the `labelId` target). */
  readonly labelId: string;
  /** Change intent — lifts the raw wire value. */
  readonly onChange: (value: string) => void;
}

/** The payment-status filter select (all-statuses escape + the four canonical options). */
export function PaymentsStatusSelect({ value, id, labelId, onChange }: Readonly<PaymentsStatusSelectProps>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <FormControl>
      <InputLabel id={labelId} shrink>
        {t.statusFilterLabel}
      </InputLabel>
      <Select
        labelId={labelId}
        id={id}
        value={value}
        label={t.statusFilterLabel}
        onChange={event => onChange(event.target.value)}
        // Render the "" draft as its option text in the closed control —
        // without displayEmpty the closed select shows an empty value area.
        displayEmpty
        data-testid="admin-finances-filter-status"
      >
        <MenuItem value="">{t.allStatusesOption}</MenuItem>
        {STATUS_OPTIONS.map(status => (
          <MenuItem key={status} value={status}>
            {status}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

interface PaymentsGatewaySelectProps {
  /** The controlled draft value (`""` = the all-gateways option). */
  readonly value: PaymentGateway | "";
  /** The select's DOM id (`useId`-derived). */
  readonly id: string;
  /** The label's DOM id (the `labelId` target). */
  readonly labelId: string;
  /** Change intent — lifts the raw wire value. */
  readonly onChange: (value: string) => void;
}

/** The payment-gateway filter select (all-gateways escape + the canonical options). */
export function PaymentsGatewaySelect({
  value,
  id,
  labelId,
  onChange,
}: Readonly<PaymentsGatewaySelectProps>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <FormControl>
      <InputLabel id={labelId} shrink>
        {t.gatewayFilterLabel}
      </InputLabel>
      <Select
        labelId={labelId}
        id={id}
        value={value}
        label={t.gatewayFilterLabel}
        onChange={event => onChange(event.target.value)}
        displayEmpty
        data-testid="admin-finances-filter-gateway"
      >
        <MenuItem value="">{t.allGatewaysOption}</MenuItem>
        {GATEWAY_OPTIONS.map(gateway => (
          <MenuItem key={gateway} value={gateway}>
            {gateway}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
