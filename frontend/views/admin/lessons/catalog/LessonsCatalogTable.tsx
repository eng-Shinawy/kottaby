/**
 * LessonsCatalogTable — Data table and responsive card view for the admin
 * lessons catalog.
 *
 * Clone of the plans-admin `PlanCatalogTable` lineage, translated to lessons.
 * Composes:
 *  - LessonsCatalogSkeleton (loading state)
 *  - LessonsCatalogEmptyState (accessible empty state with Create CTA)
 *  - LessonsMobileCardList (responsive mobile Card stack)
 *  - LessonsDesktopTable (desktop Table)
 */

"use client";

import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { LessonsCatalogEmptyState } from "@/frontend/views/admin/lessons/catalog/LessonsCatalogEmptyState";
import { LessonsCatalogSkeleton } from "@/frontend/views/admin/lessons/catalog/LessonsCatalogSkeleton";
import { LessonsDesktopTable } from "@/frontend/views/admin/lessons/catalog/LessonsDesktopTable";
import { LessonsMobileCardList } from "@/frontend/views/admin/lessons/catalog/LessonsMobileCardList";

type LessonItem = PlanLessonsQuery["planLessons"][number];

export interface LessonsCatalogTableProps {
  readonly lessons: readonly LessonItem[];
  readonly loading: boolean;
  readonly actionLoadingId?: string | null;
  readonly onEdit: (lesson: LessonItem) => void;
  readonly onDelete: (lesson: LessonItem) => void;
  readonly onCreateNew: () => void;
  /** Nothing can be created until a plan id is available to attach it to. */
  readonly canCreate: boolean;
}

export function LessonsCatalogTable({
  lessons,
  loading,
  actionLoadingId,
  onEdit,
  onDelete,
  onCreateNew,
  canCreate,
}: LessonsCatalogTableProps): React.ReactElement {
  // Skeleton loading state
  if (loading && lessons.length === 0) {
    return <LessonsCatalogSkeleton />;
  }

  // Empty state
  if (!loading && lessons.length === 0) {
    return <LessonsCatalogEmptyState onCreateNew={onCreateNew} canCreate={canCreate} />;
  }

  return (
    <>
      {/* Mobile Card-Stack View (visible below md) */}
      <LessonsMobileCardList lessons={lessons} actionLoadingId={actionLoadingId} onEdit={onEdit} onDelete={onDelete} />

      {/* Desktop Table (visible md and up) */}
      <LessonsDesktopTable lessons={lessons} actionLoadingId={actionLoadingId} onEdit={onEdit} onDelete={onDelete} />
    </>
  );
}
