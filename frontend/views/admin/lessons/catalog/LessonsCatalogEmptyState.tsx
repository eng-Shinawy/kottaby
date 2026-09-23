/**
 * LessonsCatalogEmptyState — Accessible empty state with Create CTA for the
 * admin lessons catalog.
 *
 * Shell around the shared `CatalogEmptyState` with the lessons namespace copy
 * and CTA. The create CTA stays hidden while no plan is selectable (there is
 * nothing to create a lesson under).
 */

"use client";

import { MenuBookOutlined as EmptyIcon } from "@mui/icons-material";
import { CatalogEmptyState } from "@/frontend/components/ui/CatalogEmptyState";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

export interface LessonsCatalogEmptyStateProps {
  readonly onCreateNew: () => void;
  /** Nothing can be created until a plan id is available to attach it to. */
  readonly canCreate: boolean;
}

export function LessonsCatalogEmptyState({
  onCreateNew,
  canCreate,
}: LessonsCatalogEmptyStateProps): React.ReactElement {
  const t = useAppTranslation(Lessons);

  return (
    <CatalogEmptyState
      icon={<EmptyIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />}
      title={t.emptyTitle}
      description={t.emptyDescription}
      actionLabel={canCreate ? t.createLessonButton : undefined}
      onAction={canCreate ? onCreateNew : undefined}
    />
  );
}
