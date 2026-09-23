"use client";

import LockOutlined from "@mui/icons-material/LockOutlined";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { PlanPurchaseCardList } from "@/frontend/views/student/plans/PlanPurchaseCardList";
import { PlansEmptyState } from "@/frontend/views/student/plans/PlansEmptyState";
import { PlansLoadingSkeleton } from "@/frontend/views/student/plans/PlansLoadingSkeleton";
import { PLANS_ERROR_TEST_ID } from "@/frontend/views/student/plans/plansViewIds";
import { Checkout, useAppTranslation } from "@/shared/locale";

export interface PlansCatalogBodyProps {
  readonly loading: boolean;
  readonly queryError: unknown;
  readonly plans: readonly PlanCatalogQuery_planCatalog[];
  readonly onBuy: (plan: PlanCatalogQuery_planCatalog) => void;
  readonly buying: boolean;
  readonly onRetry: () => void;
  readonly onRefresh: () => void;
}

/** Centers the settled non-grid bodies (error alert, empty state) in the remaining viewport height. */
const CENTERED_BODY_SX = {
  minHeight: "calc(100dvh - 220px)",
  justifyContent: "center",
  alignItems: "stretch",
};

/**
 * The swapping body below the always-on chrome — skeleton / denial
 * fallback / error alert / empty state / plan grid.
 */
export function PlansCatalogBody({
  loading,
  queryError,
  plans,
  onBuy,
  buying,
  onRetry,
  onRefresh,
}: Readonly<PlansCatalogBodyProps>): ReactNode {
  const t = useAppTranslation(Checkout);
  if (loading && plans.length === 0) {
    return <PlansLoadingSkeleton />;
  }
  // Apollo settles queries with data-or-error; the truthy gate keeps the
  // compiler informed without unsafe assertions.
  if (queryError) {
    const rawCode = extractErrorCode(queryError);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return (
      <Stack data-testid={PLANS_ERROR_TEST_ID} sx={{ ...CENTERED_BODY_SX, py: 4, gap: 2 }}>
        <Alert
          severity="error"
          variant="outlined"
          sx={theme => ({ borderColor: theme.palette.error.main, bgcolor: alpha(theme.palette.error.main, 0.08) })}
        >
          {t.genericError}
        </Alert>
        <Button
          variant="outlined"
          color="error"
          onClick={onRetry}
          sx={{ minHeight: 44, alignSelf: { sm: "flex-start" }, px: 2 }}
        >
          {t.retryButton}
        </Button>
      </Stack>
    );
  }
  if (!loading && plans.length === 0) {
    return (
      <Stack sx={CENTERED_BODY_SX}>
        <PlansEmptyState onRefresh={onRefresh} />
      </Stack>
    );
  }
  return (
    <Stack sx={{ gap: 3 }}>
      <PlanPurchaseCardList plans={plans} onBuy={onBuy} buying={buying} />
      <TrustNote />
    </Stack>
  );
}

/** The hosted-checkout trust note under the plan grid. */
function TrustNote(): ReactNode {
  const t = useAppTranslation(Checkout);
  return (
    <Stack
      direction="row"
      sx={theme => ({
        gap: 1,
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        px: 2,
        py: 1.5,
      })}
    >
      <LockOutlined sx={theme => ({ fontSize: 18, color: theme.palette.text.secondary })} />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, textAlign: "center" })}>
        {t.paymobTrustNote}
      </Typography>
    </Stack>
  );
}
