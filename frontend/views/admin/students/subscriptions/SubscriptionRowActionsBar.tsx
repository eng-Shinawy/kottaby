"use client";

/**
 * SubscriptionRowActionsBar — the per-status lifecycle action row of the
 * admin drawer's subscription cards: extend/renew/change plan on their
 * outlined neutral lane, cancel on the destructive error lane. Which
 * buttons render at all is the pure `ACTIONS_BY_STATUS` matrix's job —
 * the bar only lays out what its `actions` prop affords.
 *
 * Presentational: the row data + resolved availability arrive via props;
 * every label resolves in the owning card through the `subscriptionAdmin`
 * namespace. MUI v9 `sx`-only styling, theme tokens only.
 */
import { Button, Stack } from "@mui/material";
import type { ReactNode } from "react";
import type {
  SubscriptionRow,
  SubscriptionRowActions,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";

interface SubscriptionRowActionsBarProps {
  readonly row: SubscriptionRow;
  /** Resolved per-status action availability (the pure matrix). */
  readonly actions: SubscriptionRowActions;
  readonly labels: {
    readonly extend: string;
    readonly renew: string;
    readonly cancel: string;
    readonly changePlan: string;
  };
  readonly onExtend: (row: SubscriptionRow) => void;
  readonly onRenew: (row: SubscriptionRow) => void;
  readonly onCancel: (row: SubscriptionRow) => void;
  readonly onChangePlan: (row: SubscriptionRow) => void;
}

export function SubscriptionRowActionsBar({
  row,
  actions,
  labels,
  onExtend,
  onRenew,
  onCancel,
  onChangePlan,
}: SubscriptionRowActionsBarProps): ReactNode {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, pt: 1.5 }}>
      {actions.extend && (
        <Button size="small" variant="outlined" onClick={() => onExtend(row)}>
          {labels.extend}
        </Button>
      )}
      {actions.renew && (
        <Button size="small" variant="outlined" onClick={() => onRenew(row)}>
          {labels.renew}
        </Button>
      )}
      {actions.changePlan && (
        <Button size="small" variant="outlined" onClick={() => onChangePlan(row)}>
          {labels.changePlan}
        </Button>
      )}
      {actions.cancel && (
        <Button size="small" variant="outlined" color="error" onClick={() => onCancel(row)}>
          {labels.cancel}
        </Button>
      )}
    </Stack>
  );
}
