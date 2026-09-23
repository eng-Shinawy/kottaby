"use client";

/**
 * PlanCatalogHeader — Header section for the admin plan catalog.
 *
 * Renders page title, subtitle, and primary Create Plan action button
 * via the shared CatalogHeader scaffold.
 */

import { CatalogHeader } from "@/frontend/components/ui/CatalogHeader";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

export interface PlanCatalogHeaderProps {
  readonly onCreateNew: () => void;
}

export function PlanCatalogHeader({ onCreateNew }: PlanCatalogHeaderProps): React.ReactElement {
  const t = useAppTranslation(Plans);

  return (
    <CatalogHeader
      title={t.pageTitle}
      subtitle={t.pageSubtitle}
      actionLabel={t.createPlanButton}
      onCreateNew={onCreateNew}
    />
  );
}
