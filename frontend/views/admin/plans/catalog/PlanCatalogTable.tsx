/**
 * PlanCatalogTable — Data table and responsive card view for admin plan catalog.
 *
 * Implements REQ-054, REQ-060, REQ-062 (Task 4.3).
 * Composes:
 *  - PlanCatalogSkeleton (loading state)
 *  - PlanCatalogEmptyState (accessible empty state with Create CTA)
 *  - PlanMobileCardList (responsive mobile Card Stack)
 *  - PlanDesktopTable (desktop Table)
 */

"use client";

import type { AdminPlansQuery } from "@/frontend/graphql/generated/gql/graphql";
import { PlanCatalogEmptyState } from "@/frontend/views/admin/plans/catalog/PlanCatalogEmptyState";
import { PlanCatalogSkeleton } from "@/frontend/views/admin/plans/catalog/PlanCatalogSkeleton";
import { PlanMobileCardList } from "@/frontend/views/admin/plans/catalog/PlanMobileCardList";
import { PlanDesktopTable } from "@/frontend/views/admin/plans/ui/PlanDesktopTable";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanCatalogTableProps {
  readonly plans: readonly PlanItem[];
  readonly loading: boolean;
  readonly actionLoadingId?: string | null;
  readonly onEdit: (plan: PlanItem) => void;
  readonly onToggleStatus: (plan: PlanItem, targetActive: boolean) => void;
  readonly onCreateNew: () => void;
}

export function PlanCatalogTable({
  plans,
  loading,
  actionLoadingId,
  onEdit,
  onToggleStatus,
  onCreateNew,
}: PlanCatalogTableProps): React.ReactElement {
  // Skeleton loading state
  if (loading && plans.length === 0) {
    return <PlanCatalogSkeleton />;
  }

  // Empty state
  if (!loading && plans.length === 0) {
    return <PlanCatalogEmptyState onCreateNew={onCreateNew} />;
  }

  return (
    <>
      {/* Mobile Card-Stack View (visible below sm) */}
      <PlanMobileCardList
        plans={plans}
        actionLoadingId={actionLoadingId}
        onEdit={onEdit}
        onToggleStatus={onToggleStatus}
      />

      {/* Desktop Table View (visible md and up) */}
      <PlanDesktopTable
        plans={plans}
        actionLoadingId={actionLoadingId}
        onEdit={onEdit}
        onToggleStatus={onToggleStatus}
      />
    </>
  );
}
