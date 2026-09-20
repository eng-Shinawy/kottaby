"use client";

/**
 * useLessonDelete — Delete-confirmation dialog orchestration for the admin
 * lessons catalog.
 *
 * Clone of the plans-admin `usePlanStatusDialog` lineage, translated to
 * lessons:
 *  - Dialog visibility & delete-target selection
 *  - deleteLesson mutation that EVICTS the removed row's cache entry, then
 *    refetches so the plan's lesson list reflects the server's truth
 *  - Per-row pending tracking (`actionLoadingId`)
 *  - Success toast hand-off via `onSuccess`
 */

import { useMutation } from "@apollo/client/react";
import { useState } from "react";
import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { deleteLessonMutationDocument } from "@/frontend/graphql/sharedDocuments/classes/lesson.documents";
import { refetchAfterWrite } from "@/frontend/views/admin/lessons/hooks/useLessonFormDialog";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

type LessonItem = PlanLessonsQuery["planLessons"][number];

export interface UseLessonDeleteOptions {
  readonly refetch: () => Promise<unknown>;
  readonly onSuccess: (message: string) => void;
}

export function useLessonDelete({ refetch, onSuccess }: UseLessonDeleteOptions): {
  readonly deleteOpen: boolean;
  readonly selectedLessonForDelete: LessonItem | null;
  readonly deleteError: string | null;
  readonly deleteLoading: boolean;
  readonly actionLoadingId: string | null;
  readonly handleOpenDelete: (lesson: LessonItem) => void;
  readonly handleCloseDelete: () => void;
  readonly handleDeleteConfirm: (lesson: LessonItem) => Promise<void>;
} {
  const t = useAppTranslation(Lessons);

  const [deleteLesson, { loading: deleteLoading }] = useMutation(deleteLessonMutationDocument, {
    // Evict the removed row's normalized cache entry so no stale Lesson
    // entity survives the delete; the refetch afterwards rebuilds the
    // plan's lesson list from the server's truth.
    update: (cache, result) => {
      const deleted = result.data?.deleteLesson;
      if (deleted) {
        cache.evict({ id: cache.identify({ __typename: "Lesson", id: deleted.id }) });
        cache.gc();
      }
    },
  });

  // Dialog & state management
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedLessonForDelete, setSelectedLessonForDelete] = useState<LessonItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const handleOpenDelete = (lesson: LessonItem) => {
    setSelectedLessonForDelete(lesson);
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const handleCloseDelete = () => setDeleteOpen(false);

  const handleDeleteConfirm = async (lesson: LessonItem): Promise<void> => {
    setDeleteError(null);
    setActionLoadingId(lesson.id);
    try {
      await deleteLesson({
        variables: { id: lesson.id },
      });
      // The row IS deleted; a refetch rejection never masquerades as a
      // failed delete (logged inside, swallowed).
      await refetchAfterWrite(refetch);
      onSuccess(t.deleteSuccessToast);
      setDeleteOpen(false);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : t.unexpectedErrorMessage);
    } finally {
      setActionLoadingId(null);
    }
  };

  return {
    deleteOpen,
    selectedLessonForDelete,
    deleteError,
    deleteLoading,
    actionLoadingId,
    handleOpenDelete,
    handleCloseDelete,
    handleDeleteConfirm,
  };
}
