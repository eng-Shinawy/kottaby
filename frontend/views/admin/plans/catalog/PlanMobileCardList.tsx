/**
 * PlanMobileCardList — Mobile card-stack view (visible below sm) for the admin plan catalog.
 *
 * Extracted from PlanCatalogTable (Task 4.3).
 *  - Row-level action buttons (Edit, Activate/Deactivate) with pending spinners
 *  - Theme-callback token styling (zero hardcoded hex/strings)
 */

"use client";

import {
  CheckCircleOutlined as ActivateIcon,
  BlockOutlined as DeactivateIcon,
  EditOutlined as EditIcon,
} from "@mui/icons-material";
import { Box, Button, Card, CardActions, CardContent, Stack, Typography } from "@mui/material";
import type { AdminPlansQuery } from "@/frontend/graphql/generated/gql/graphql";
import { formatPlanDate } from "@/frontend/views/admin/plans/catalog/planCatalogFormatting";
import { PlanStatusChip } from "@/frontend/views/admin/plans/ui/PlanStatusChip";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanMobileCardListProps {
  readonly plans: readonly PlanItem[];
  readonly actionLoadingId?: string | null;
  readonly onEdit: (plan: PlanItem) => void;
  readonly onToggleStatus: (plan: PlanItem, targetActive: boolean) => void;
}

export function PlanMobileCardList({
  plans,
  actionLoadingId,
  onEdit,
  onToggleStatus,
}: PlanMobileCardListProps): React.ReactElement {
  const t = useAppTranslation(Plans);

  return (
    <Box sx={{ display: { xs: "flex", md: "none" }, flexDirection: "column", gap: 2 }}>
      {plans.map(plan => {
        const isActionPending = actionLoadingId === plan.id;
        return (
          <Card
            key={plan.id}
            elevation={0}
            sx={theme => ({
              border: 1,
              borderColor: theme.palette.divider,
              borderRadius: 2,
            })}
          >
            <CardContent sx={{ pb: 1 }}>
              <Stack sx={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {plan.title}
                </Typography>
                <PlanStatusChip
                  isActive={plan.isActive}
                  activeLabel={t.activeStatus}
                  inactiveLabel={t.inactiveStatus}
                />
              </Stack>
              <Stack sx={{ gap: 0.5 }}>
                <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
                  {t.sessionCountColumn}: <strong>{plan.sessionCount}</strong>
                </Typography>
                <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
                  {t.priceColumn}:{" "}
                  <strong>
                    <span dir="ltr">
                      {plan.price} {plan.currency}
                    </span>
                  </strong>
                  {" · "}
                  {plan.intervalDays} {t.intervalDaysShort}
                </Typography>
                <Typography
                  variant="caption"
                  sx={theme => ({ color: theme.palette.text.secondary, whiteSpace: "nowrap" })}
                >
                  {t.createdAtColumn}: {formatPlanDate(plan.createdAt, t.emptyValue)}
                </Typography>
                {!plan.isActive && plan.deactivatedAt && (
                  <Typography
                    variant="caption"
                    sx={theme => ({ color: theme.palette.error.main, whiteSpace: "nowrap" })}
                  >
                    {t.deactivatedAtColumn}: {formatPlanDate(plan.deactivatedAt, t.emptyValue)}
                  </Typography>
                )}
              </Stack>
            </CardContent>
            <CardActions sx={{ px: 2, pb: 2, pt: 0, justifyContent: "flex-end" }}>
              <Button
                size="small"
                startIcon={<EditIcon />}
                onClick={() => onEdit(plan)}
                disabled={isActionPending}
                sx={{ minHeight: 44 }}
              >
                {t.editPlanButton}
              </Button>
              <Button
                size="small"
                startIcon={plan.isActive ? <DeactivateIcon /> : <ActivateIcon />}
                onClick={() => onToggleStatus(plan, !plan.isActive)}
                disabled={isActionPending}
                sx={theme => ({
                  color: plan.isActive ? theme.palette.error.main : theme.palette.primary.main,
                  minHeight: 44,
                })}
              >
                {plan.isActive ? t.deactivatePlanButton : t.activatePlanButton}
              </Button>
            </CardActions>
          </Card>
        );
      })}
    </Box>
  );
}
