"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MySubscriptionsQuery_mySubscriptions } from "@/frontend/graphql/generated/gql/graphql";
import { statusChipLabel } from "@/frontend/views/student/checkout/result/resultPresentation";
import { formatSubscriptionDate } from "@/frontend/views/student/subscriptions/subscriptionsViewLabels";
import { useAppLocale } from "@/shared/locale/localeContext";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/**
 * ResultSummaryRows — the result panel's label/value rows (the
 * confirm-dialog summary-table rhythm): the server-provided subscription
 * row's plan, lifecycle chip, and period values. Pure presentational —
 * every value is rendered straight from the `mySubscriptions` re-query
 * payload; the absent-period placeholder is the namespace's `emptyValue`.
 */
interface ResultSummaryRowsProps {
  /** The newest subscription row (server truth). */
  readonly newest: MySubscriptionsQuery_mySubscriptions;
  /** The checkout namespace labels (pre-resolved by the container). */
  readonly t: CheckoutLabels;
}

/** The summary rows — label/value pairs straight from the server row. */
export function ResultSummaryRows({ newest, t }: Readonly<ResultSummaryRowsProps>): ReactNode {
  const locale = useAppLocale();
  return (
    <Stack sx={{ gap: 1, width: "100%" }}>
      <SummaryRow label={t.planLabel} value={newest.plan.title} />
      <SummaryRow label={t.statusColumn} value={statusChipLabel(newest.status, t)} />
      <SummaryRow
        label={t.startDateColumn}
        value={newest.startDate === null ? t.emptyValue : formatSubscriptionDate(newest.startDate, locale)}
      />
      <SummaryRow
        label={t.endDateColumn}
        value={newest.endDate === null ? t.emptyValue : formatSubscriptionDate(newest.endDate, locale)}
      />
    </Stack>
  );
}

/** One label/value summary row. */
function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>): ReactNode {
  return (
    <Stack
      direction="row"
      sx={theme => ({
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        width: "100%",
        borderBottom: "1px solid",
        borderColor: theme.palette.divider,
        py: 1,
      })}
    >
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="p"
        sx={theme => ({ color: theme.palette.text.primary, fontWeight: 600, textAlign: "right" })}
      >
        {value}
      </Typography>
    </Stack>
  );
}
