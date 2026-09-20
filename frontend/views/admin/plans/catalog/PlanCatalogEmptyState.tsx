/**
 * PlanCatalogEmptyState — Accessible empty state with Create CTA for the admin plan catalog.
 *
 * Extracted from PlanCatalogTable (Task 4.3). Shell around the shared
 * `CatalogEmptyState` with the plans namespace copy and CTA.
 */

"use client";

import { VerifiedOutlined as EmptyIcon } from "@mui/icons-material";
import { CatalogEmptyState } from "@/frontend/components/ui/CatalogEmptyState";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

export interface PlanCatalogEmptyStateProps {
  readonly onCreateNew: () => void;
}

export function PlanCatalogEmptyState({ onCreateNew }: PlanCatalogEmptyStateProps): React.ReactElement {
  const t = useAppTranslation(Plans);

  return (
    <CatalogEmptyState
      icon={<EmptyIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />}
      title={t.emptyTitle}
      description={t.emptyDescription}
      actionLabel={t.createPlanButton}
      onAction={onCreateNew}
    />
  );
}
