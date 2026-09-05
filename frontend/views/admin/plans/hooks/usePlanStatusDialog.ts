"use client";

/**
 * usePlanStatusDialog — Status-confirmation dialog orchestration for the admin
 * plan catalog.
 *
 * Extracted from PlanCatalogContainer (Task 4.3).
 *  - Dialog visibility & target-plan selection
 *  - setPlanActiveStatus mutation with inline error surface
 *  - Per-row pending tracking (`actionLoadingId`)
 *  - Success toast hand-off via `onSuccess`
 */

"use client";

import { useMutation } from "@apollo/client/react";
import { useState } from "react";
import type { AdminPlansQuery } from "@/frontend/graphql/generated/gql/graphql";
import { setPlanActiveStatusMutationDocument } from "@/frontend/graphql/sharedDocuments/billing";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface UsePlanStatusDialogOptions {
  readonly onSuccess: (message: string) => void;
}

export function usePlanStatusDialog({ onSuccess }: UsePlanStatusDialogOptions): {
  readonly statusOpen: boolean;
  readonly selectedPlanForStatus: PlanItem | null;
  readonly targetActive: boolean;
  readonly statusError: string | null;
  readonly statusLoading: boolean;
  readonly actionLoadingId: string | null;
  readonly handleOpenStatus: (plan: PlanItem, nextActive: boolean) => void;
  readonly handleCloseStatus: () => void;
  readonly handleStatusConfirm: (plan: PlanItem, nextActive: boolean) => Promise<void>;
} {
  const t = useAppTranslation(Plans);

  // Mutations
  const [setStatus, { loading: statusLoading }] = useMutation(setPlanActiveStatusMutationDocument);

  // Dialog & state management
  const [statusOpen, setStatusOpen] = useState(false);
  const [selectedPlanForStatus, setSelectedPlanForStatus] = useState<PlanItem | null>(null);
  const [targetActive, setTargetActive] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const handleOpenStatus = (plan: PlanItem, nextActive: boolean) => {
    setSelectedPlanForStatus(plan);
    setTargetActive(nextActive);
    setStatusError(null);
    setStatusOpen(true);
  };

  const handleCloseStatus = () => setStatusOpen(false);

  const handleStatusConfirm = async (plan: PlanItem, nextActive: boolean) => {
    setStatusError(null);
    setActionLoadingId(plan.id);
    try {
      await setStatus({
        variables: {
          id: plan.id,
          isActive: nextActive,
        },
      });
      onSuccess(t.statusChangeSuccessToast);
      setStatusOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setStatusError(err.message);
      } else {
        setStatusError(t.statusChangeErrorMessage);
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  return {
    statusOpen,
    selectedPlanForStatus,
    targetActive,
    statusError,
    statusLoading,
    actionLoadingId,
    handleOpenStatus,
    handleCloseStatus,
    handleStatusConfirm,
  };
}
