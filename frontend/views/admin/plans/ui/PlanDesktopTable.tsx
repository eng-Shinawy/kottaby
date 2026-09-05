/**
 * PlanDesktopTable — Desktop table view (visible md and up) for the admin plan catalog.
 *
 * Extracted from PlanCatalogTable (Task 4.3).
 *  - Theme-callback token styling (zero hardcoded hex/strings)
 */

"use client";

import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";
import type { AdminPlansQuery } from "@/frontend/graphql/generated/gql/graphql";
import { PlanDesktopRow } from "@/frontend/views/admin/plans/ui/PlanDesktopRow";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanDesktopTableProps {
  readonly plans: readonly PlanItem[];
  readonly actionLoadingId?: string | null;
  readonly onEdit: (plan: PlanItem) => void;
  readonly onToggleStatus: (plan: PlanItem, targetActive: boolean) => void;
}

export function PlanDesktopTable({
  plans,
  actionLoadingId,
  onEdit,
  onToggleStatus,
}: PlanDesktopTableProps): React.ReactElement {
  const t = useAppTranslation(Plans);

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={theme => ({
        display: { xs: "none", md: "block" },
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
      })}
    >
      <Table aria-label={t.pageTitle}>
        <TableHead>
          <TableRow sx={theme => ({ backgroundColor: theme.palette.action.hover })}>
            <TableCell sx={{ fontWeight: 600 }}>{t.titleColumn}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t.sessionCountColumn}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t.priceColumn}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t.intervalDaysColumn}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t.statusColumn}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t.createdAtColumn}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t.deactivatedAtColumn}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              {t.actionsColumn}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {plans.map(plan => (
            <PlanDesktopRow
              key={plan.id}
              plan={plan}
              actionLoadingId={actionLoadingId}
              onEdit={onEdit}
              onToggleStatus={onToggleStatus}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
