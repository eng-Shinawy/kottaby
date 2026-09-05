/**
 * PlanDesktopRow — Single desktop table row for the admin plan catalog.
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
import { IconButton, Stack, TableCell, TableRow, Tooltip } from "@mui/material";
import type { AdminPlansQuery } from "@/frontend/graphql/generated/gql/graphql";
import { formatPlanDate } from "@/frontend/views/admin/plans/catalog/planCatalogFormatting";
import { PlanStatusChip } from "@/frontend/views/admin/plans/ui/PlanStatusChip";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanDesktopRowProps {
  readonly plan: PlanItem;
  readonly actionLoadingId?: string | null;
  readonly onEdit: (plan: PlanItem) => void;
  readonly onToggleStatus: (plan: PlanItem, targetActive: boolean) => void;
}

export function PlanDesktopRow({
  plan,
  actionLoadingId,
  onEdit,
  onToggleStatus,
}: PlanDesktopRowProps): React.ReactElement {
  const t = useAppTranslation(Plans);
  const isActionPending = actionLoadingId === plan.id;

  return (
    <TableRow
      hover
      sx={theme => ({
        opacity: plan.isActive ? 1 : 0.75,
        "&:last-child td, &:last-child th": { border: 0 },
        backgroundColor: plan.isActive ? theme.palette.background.paper : theme.palette.action.hover,
      })}
    >
      <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
        {plan.title}
      </TableCell>
      <TableCell>{plan.sessionCount}</TableCell>
      <TableCell>
        <span dir="ltr">
          {plan.price} {plan.currency}
        </span>
      </TableCell>
      <TableCell>{plan.intervalDays}</TableCell>
      <TableCell>
        <PlanStatusChip isActive={plan.isActive} activeLabel={t.activeStatus} inactiveLabel={t.inactiveStatus} />
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>{formatPlanDate(plan.createdAt, t.emptyValue)}</TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>{formatPlanDate(plan.deactivatedAt, t.emptyValue)}</TableCell>
      <TableCell align="right">
        <Stack sx={{ flexDirection: "row", justifyContent: "flex-end", gap: 1 }}>
          <Tooltip title={t.editPlanButton}>
            <span>
              <IconButton
                size="small"
                onClick={() => onEdit(plan)}
                disabled={isActionPending}
                aria-label={`${t.editPlanButton} ${plan.title}`}
                sx={{ width: 44, height: 44 }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={plan.isActive ? t.deactivatePlanButton : t.activatePlanButton}>
            <span>
              <IconButton
                size="small"
                onClick={() => onToggleStatus(plan, !plan.isActive)}
                disabled={isActionPending}
                aria-label={
                  plan.isActive ? `${t.deactivatePlanButton} ${plan.title}` : `${t.activatePlanButton} ${plan.title}`
                }
                sx={theme => ({
                  width: 44,
                  height: 44,
                  color: plan.isActive ? theme.palette.error.main : theme.palette.primary.main,
                })}
              >
                {plan.isActive ? <DeactivateIcon fontSize="small" /> : <ActivateIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </TableCell>
    </TableRow>
  );
}
