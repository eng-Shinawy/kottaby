"use client";

/**
 * LessonsCatalogContainer — Root client container for admin curriculum lesson
 * management.
 *
 * Clone of the plans-admin `PlanCatalogContainer` lineage, translated to
 * lessons:
 *  - Plan selector (LessonsPlanSelector) fed by `useQuery(adminPlansQueryDocument)`
 *    (active + inactive plans — a lesson may live under any plan)
 *  - Lessons via `useQuery(planLessonsQueryDocument)`, skipped until a plan id
 *    is available (defaults to the first plan once the list loads)
 *  - Catalog views (LessonsCatalogTable: skeleton / empty / table / cards)
 *  - Create & Edit lesson dialogs (LessonFormDialog via useLessonFormDialog)
 *  - Delete confirmation dialog (LessonsDeleteConfirmDialog via useLessonDelete)
 *  - Success snackbar — zero fake data anywhere
 */

import { useQuery } from "@apollo/client/react";
import { Alert, Container, Snackbar } from "@mui/material";
import { useState } from "react";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments/billing";
import { planLessonsQueryDocument } from "@/frontend/graphql/sharedDocuments/classes/lesson.documents";
import { LessonsCatalogHeader } from "@/frontend/views/admin/lessons/catalog/LessonsCatalogHeader";
import { LessonsCatalogTable } from "@/frontend/views/admin/lessons/catalog/LessonsCatalogTable";
import { LessonsPlanSelector } from "@/frontend/views/admin/lessons/catalog/LessonsPlanSelector";
import { LessonsDeleteConfirmDialog } from "@/frontend/views/admin/lessons/dialogs/LessonDeleteConfirmDialog";
import { LessonFormDialog } from "@/frontend/views/admin/lessons/forms/LessonFormDialog";
import { useLessonDelete } from "@/frontend/views/admin/lessons/hooks/useLessonDelete";
import { useLessonFormDialog } from "@/frontend/views/admin/lessons/hooks/useLessonFormDialog";

export function LessonsCatalogContainer(): React.ReactElement {
  // Plan selector source — admin-only query, includes inactive plans so a
  // lesson can be curated under any plan the catalog knows about.
  const {
    data: plansData,
    loading: plansLoading,
    error: plansError,
  } = useQuery(adminPlansQueryDocument, {
    variables: { includeInactive: true },
    fetchPolicy: "cache-and-network",
  });

  const plans = plansData?.adminPlans ?? [];

  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  // Default to the first plan once the list arrives; `""` means "nothing
  // selected AND nothing loadable yet" (the lessons query stays skipped).
  const activePlanId = selectedPlanId || plans[0]?.id || "";
  const parsedPlanId = Number.parseInt(activePlanId, 10);
  // CreateLessonInput.planId is an Int — the plan id arrives as a GraphQL ID
  // string, so the create flow rides the parsed numeric form only.
  const numericPlanId = Number.isSafeInteger(parsedPlanId) ? parsedPlanId : null;

  const {
    data: lessonsData,
    loading: lessonsLoading,
    error: lessonsError,
    refetch,
  } = useQuery(planLessonsQueryDocument, {
    variables: { planId: activePlanId },
    skip: !activePlanId,
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Dialog orchestration
  const formDialog = useLessonFormDialog({ planId: numericPlanId, refetch, onSuccess: setToastMessage });
  const deleteDialog = useLessonDelete({ refetch, onSuccess: setToastMessage });

  const lessons = lessonsData?.planLessons ?? [];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LessonsCatalogHeader onCreateNew={formDialog.handleOpenCreate} canCreate={numericPlanId != null} />

      <LessonsPlanSelector plans={plans} loading={plansLoading} value={activePlanId} onChange={setSelectedPlanId} />

      {/* Query Error Alerts */}
      {plansError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {plansError.message}
        </Alert>
      )}
      {lessonsError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {lessonsError.message}
        </Alert>
      )}

      {/* Catalog views (skeleton / empty / table / cards) */}
      <LessonsCatalogTable
        lessons={lessons}
        loading={plansLoading || lessonsLoading}
        actionLoadingId={deleteDialog.actionLoadingId}
        onEdit={formDialog.handleOpenEdit}
        onDelete={deleteDialog.handleOpenDelete}
        onCreateNew={formDialog.handleOpenCreate}
        canCreate={numericPlanId != null}
      />

      {/* Create / Edit Form Dialog */}
      <LessonFormDialog
        open={formDialog.formOpen}
        lesson={formDialog.selectedLessonForEdit}
        loading={formDialog.formLoading}
        globalError={formDialog.formGlobalError}
        serverFieldErrors={formDialog.serverFieldErrors}
        onClose={formDialog.handleCloseForm}
        onSubmit={formDialog.handleFormSubmit}
      />

      {/* Delete Confirmation Dialog */}
      <LessonsDeleteConfirmDialog
        open={deleteDialog.deleteOpen}
        lesson={deleteDialog.selectedLessonForDelete}
        loading={deleteDialog.deleteLoading}
        error={deleteDialog.deleteError}
        onClose={deleteDialog.handleCloseDelete}
        onConfirm={deleteDialog.handleDeleteConfirm}
      />

      {/* Feedback Toast */}
      <Snackbar
        autoHideDuration={4000}
        open={Boolean(toastMessage)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setToastMessage(null)}
      >
        <Alert severity="success" onClose={() => setToastMessage(null)} sx={{ width: "100%" }}>
          {toastMessage}
        </Alert>
      </Snackbar>
    </Container>
  );
}
