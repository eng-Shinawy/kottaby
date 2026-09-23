"use client";

import LockOutlined from "@mui/icons-material/LockOutlined";
import SchoolOutlined from "@mui/icons-material/SchoolOutlined";
import { Alert, Avatar, Box, Stack, Typography } from "@mui/material";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import { formatPlanAmount } from "@/frontend/views/student/plans/planPresentation";
import { useAppTranslation } from "@/shared/locale/client";
import { Checkout } from "@/shared/locale/namespaces/checkout";

export interface PlanPurchaseSummaryBodyProps {
  readonly plan: PlanCatalogQuery_planCatalog;
  readonly error: string | null;
}

/**
 * PlanPurchaseSummaryBody — the confirm dialog's summary content: the
 * plan header block, the server-provided price line, the secure-redirect
 * explainer, and the optional mutation-error alert.
 *
 * The price renders from the catalog row's decimal string — the money
 * display discipline: never parsed for math, never a client-owned value.
 */
export function PlanPurchaseSummaryBody({ plan, error }: Readonly<PlanPurchaseSummaryBodyProps>): React.ReactElement {
  const t = useAppTranslation(Checkout);

  return (
    <Stack sx={{ gap: 2.5 }}>
      <Stack
        direction="row"
        sx={theme => ({
          gap: 2,
          alignItems: "center",
          p: 1.5,
          borderRadius: 2,
          bgcolor: theme.palette.surfaceContainerLow,
        })}
      >
        <Avatar
          variant="rounded"
          sx={theme => ({
            bgcolor: theme.palette.secondaryContainer,
            color: theme.palette.onSecondaryContainer,
            width: 44,
            height: 44,
            borderRadius: 2,
          })}
        >
          <SchoolOutlined fontSize="small" />
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {plan.title}
          </Typography>
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.sessionsIncludedLine(plan.sessionCount)}{" "}
            <Box component="span" sx={{ whiteSpace: "nowrap" }}>
              · {t.validityLine(plan.intervalDays)}
            </Box>
          </Typography>
        </Box>
      </Stack>
      <Stack
        direction="row"
        sx={theme => ({
          justifyContent: "space-between",
          alignItems: "baseline",
          borderTop: 1,
          borderColor: theme.palette.divider,
          pt: 1.5,
        })}
      >
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.amountDueLabel}
        </Typography>
        <Typography
          variant="h6"
          sx={theme => ({
            fontWeight: 700,
            color: theme.palette.onSurface,
            fontVariantNumeric: "tabular-nums",
          })}
        >
          <span dir="ltr">
            {formatPlanAmount(plan.price, plan.currency, plan.currency === "EGP" ? t.currencyEgp : undefined)}
          </span>
        </Typography>
      </Stack>
      <Alert
        icon={<LockOutlined fontSize="inherit" />}
        severity="info"
        variant="standard"
        sx={theme => ({ color: theme.palette.onSurfaceVariant, textAlign: "start", alignItems: "center" })}
      >
        {t.confirmDialogSecureNote}
      </Alert>
      {error !== null && (
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      )}
    </Stack>
  );
}
