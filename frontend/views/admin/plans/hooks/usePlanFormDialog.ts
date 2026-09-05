"use client";

/**
 * usePlanFormDialog — Create/edit dialog orchestration for the admin plan catalog.
 *
 * Extracted from PlanCatalogContainer (Task 4.3).
 *  - Dialog visibility & edit-target selection
 *  - Create/update Apollo mutations with cache normalization
 *  - Global form error surface (server-specified failures)
 *  - Success toast hand-off via `onSuccess`
 */

"use client";

import { useMutation } from "@apollo/client/react";
import { useState } from "react";
import type { AdminPlansQuery, CreatePlanInput } from "@/frontend/graphql/generated/gql/graphql";
import { createPlanMutationDocument, updatePlanMutationDocument } from "@/frontend/graphql/sharedDocuments/billing";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface UsePlanFormDialogOptions {
  readonly refetch: () => Promise<unknown>;
  readonly onSuccess: (message: string) => void;
}

export function usePlanFormDialog({ refetch, onSuccess }: UsePlanFormDialogOptions): {
  readonly formOpen: boolean;
  readonly selectedPlanForEdit: PlanItem | null;
  readonly formGlobalError: string | null;
  readonly formLoading: boolean;
  readonly handleOpenCreate: () => void;
  readonly handleOpenEdit: (plan: PlanItem) => void;
  readonly handleCloseForm: () => void;
  readonly handleFormSubmit: (input: CreatePlanInput) => Promise<void>;
} {
  const t = useAppTranslation(Plans);

  // Mutations
  const [createPlan, { loading: createLoading }] = useMutation(createPlanMutationDocument);
  const [updatePlan, { loading: updateLoading }] = useMutation(updatePlanMutationDocument);

  // Dialog & state management
  const [formOpen, setFormOpen] = useState(false);
  const [selectedPlanForEdit, setSelectedPlanForEdit] = useState<PlanItem | null>(null);
  const [formGlobalError, setFormGlobalError] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setSelectedPlanForEdit(null);
    setFormGlobalError(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (plan: PlanItem) => {
    setSelectedPlanForEdit(plan);
    setFormGlobalError(null);
    setFormOpen(true);
  };

  const handleCloseForm = () => setFormOpen(false);

  const handleFormSubmit = async (input: CreatePlanInput) => {
    setFormGlobalError(null);
    try {
      if (selectedPlanForEdit) {
        await updatePlan({
          variables: {
            id: selectedPlanForEdit.id,
            input: {
              title: input.title,
              sessionCount: input.sessionCount,
              price: input.price,
              currency: input.currency,
              intervalDays: input.intervalDays,
            },
          },
        });
        onSuccess(t.updateSuccessToast);
      } else {
        await createPlan({
          variables: { input },
        });
        onSuccess(t.createSuccessToast);
        await refetch();
      }
      setFormOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormGlobalError(err.message);
      } else {
        setFormGlobalError(t.unexpectedErrorMessage);
      }
    }
  };

  return {
    formOpen,
    selectedPlanForEdit,
    formGlobalError,
    formLoading: createLoading || updateLoading,
    handleOpenCreate,
    handleOpenEdit,
    handleCloseForm,
    handleFormSubmit,
  };
}
