/**
 * PlanDesktopTable — Desktop table view (visible md and up) for the admin plan catalog.
 *
 * Extracted from PlanCatalogTable (Task 4.3).
 *  - Theme-callback token styling (zero hardcoded hex/strings)
 */

"use client";

import { TableBody } from "@mui/material";
import { AdminDesktopTable } from "@/frontend/components/ui/AdminDesktopTable";
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
    <AdminDesktopTable
      ariaLabel={t.pageTitle}
      headers={[
        { label: t.titleColumn },
        { label: t.sessionCountColumn },
        { label: t.priceColumn },
        { label: t.intervalDaysColumn },
        { label: t.statusColumn },
        { label: t.createdAtColumn },
        { label: t.deactivatedAtColumn },
        { label: t.actionsColumn, align: "right" },
      ]}
    >
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
    </AdminDesktopTable>
  );
}
