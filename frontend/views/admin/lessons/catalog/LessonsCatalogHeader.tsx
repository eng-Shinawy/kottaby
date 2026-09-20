/**
 * LessonsCatalogHeader — Header section for the admin lessons catalog.
 *
 * Renders page title, subtitle, and the primary Create Lesson action button
 * (disabled while no plan is selectable) via the shared CatalogHeader scaffold.
 */

"use client";

import { CatalogHeader } from "@/frontend/components/ui/CatalogHeader";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

export interface LessonsCatalogHeaderProps {
  readonly onCreateNew: () => void;
  /** Nothing can be created until a plan id is available to attach it to. */
  readonly canCreate: boolean;
}

export function LessonsCatalogHeader({ onCreateNew, canCreate }: LessonsCatalogHeaderProps): React.ReactElement {
  const t = useAppTranslation(Lessons);

  return (
    <CatalogHeader
      title={t.pageTitle}
      subtitle={t.pageSubtitle}
      actionLabel={t.createLessonButton}
      onCreateNew={onCreateNew}
      canCreate={canCreate}
    />
  );
}
