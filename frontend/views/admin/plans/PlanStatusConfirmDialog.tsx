"use client";

import { useMutation } from "@apollo/client/react";
import {
  PublishedWithChangesOutlined as ActivateIcon,
  CloseOutlined as CloseIcon,
  UnpublishedOutlined as DeactivateIcon,
  type SvgIconComponent,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
} from "@mui/material";
import { type ReactNode, useState } from "react";
import type { AdminPlansQuery_adminPlans } from "@/frontend/graphql/generated/gql/graphql";
import { setPlanActiveStatusMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { Errors, useAppTranslation } from "@/shared/locale";
import type { PlansLabels } from "@/shared/locale/types/plans";

/**
 * `PlanStatusConfirmDialog` — the localized deactivate/reactivate confirmation
 * (DEV1-005 REQ-050 lifecycle flows), mounted by `PlanCatalogContainer`.
 *
 * Copy: BOTH flows resolve from the `plans` namespace — an ACTIVE plan gets
 * `deactivateConfirmTitle` + `deactivateConfirmBody(planTitle)`; a deactivated
 * plan gets `activateConfirmTitle` + `activateConfirmBody(planTitle)` (the
 * parity suite pins the single plan-title interpolation on both).
 *
 * Mutation: `setPlanActiveStatus(id, isActive = !plan.isActive)`. The
 * canonical RETURNING row normalizes onto `Plan:<id>` — the admin list's
 * existing reference converges (chip + deactivatedAt flip) with NO refetch.
 *
 * Error-class posture (mirrors {@link PlanFormDialog}):
 *  - `PLAN_ALREADY_INACTIVE` / `PLAN_ALREADY_ACTIVE` / `PLAN_NOT_FOUND` →
 *    localized inline Alert INSIDE the dialog (severity via the theme's MUI
 *    error tokens); the row stays list-converged (e.g. an
 *    `PLAN_ALREADY_INACTIVE` reject means the row already flipped elsewhere);
 *  - `FORBIDDEN` / `UNAUTHORIZED` → global errorLink posture (mutation
 *    FORBIDDEN → global toast; UNAUTHORIZED → deduped auth recovery) — never
 *    caught-and-toasted locally;
 *  - masked `INTERNAL_SERVER_ERROR` + unmapped codes → inline Alert with the
 *    plans-namespace `toastActionFailed` copy (global host adds the masked
 *    toast + correlation guidance).
 *
 * Success: `onStatusChanged(row)` hands the container the canonical row (its
 * `isActive`/`title` drive the localized toast); the container closes the
 * dialog. The confirm button is `loading` + `disabled` while in flight
 * (REQ-043 double-submit mitigation).
 *
 * Fresh-state contract: the CONTAINER remounts this dialog per opening via a
 * monotonic React `key` (see PlanCatalogContainer) — the inline alert state
 * initializes once per mount (no setState-in-effect resets).
 *
 * MUI v9 discipline: `sx`-only styling, `*Outlined` icons, full-width action
 * buttons on mobile, zero hardcoded strings/colors.
 */

/**
 * Copy helper — the flow-specific dialog title. `plan === null` is the
 * defensive shell (container contract violation): it falls back to the edit
 * title rather than crashing.
 */
function confirmTitleOf(plan: AdminPlansQuery_adminPlans | null, labels: PlansLabels): string {
  if (plan === null) return labels.editDialogTitle;
  return plan.isActive ? labels.deactivateConfirmTitle : labels.activateConfirmTitle;
}

export interface PlanStatusConfirmDialogProps {
  /** Mount state — the container owns open/close. */
  readonly open: boolean;
  /** The row whose lifecycle is being confirmed; `null` renders nothing. */
  readonly plan: AdminPlansQuery_adminPlans | null;
  /** Full plans-namespace labels (container's merged tree — property access). */
  readonly labels: PlansLabels;
  /** Dismiss intent (cancel / backdrop / escape). */
  readonly onClose: () => void;
  /** Success hand-off with the canonical post-toggle row (new `isActive`). */
  readonly onStatusChanged: (plan: AdminPlansQuery_adminPlans) => void;
}

export function PlanStatusConfirmDialog({
  open,
  plan,
  labels,
  onClose,
  onStatusChanged,
}: Readonly<PlanStatusConfirmDialogProps>): ReactNode {
  const errorsT = useAppTranslation(Errors);
  // Alert state lives once per mount — the container's remount `key` gives
  // every opening a fresh dialog (no setState-in-effect reset).
  const [alertCopy, setAlertCopy] = useState<string | null>(null);

  const [setPlanActiveStatus, { loading }] = useMutation(setPlanActiveStatusMutationDocument);

  // Null-plan while open is a container contract violation — render the
  // shell without confirm copy rather than crashing.
  const isActive = plan?.isActive ?? true;

  const handleConfirm = async (): Promise<void> => {
    if (plan === null || loading) return; // REQ-043 belt (disabled button braces)
    setAlertCopy(null);
    try {
      const result = await setPlanActiveStatus({
        variables: { id: plan.id, isActive: !plan.isActive },
      });
      const updated = result.data?.setPlanActiveStatus;
      if (updated) onStatusChanged(updated);
    } catch (mutationError) {
      const code = extractErrorCode(mutationError);
      if (code === "PLAN_ALREADY_INACTIVE") {
        setAlertCopy(errorsT.planAlreadyInactive);
        return;
      }
      if (code === "PLAN_ALREADY_ACTIVE") {
        setAlertCopy(errorsT.planAlreadyActive);
        return;
      }
      if (code === "PLAN_NOT_FOUND") {
        setAlertCopy(errorsT.planNotFound);
        return;
      }
      // FORBIDDEN / UNAUTHORIZED ride the global posture — no local toast.
      if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
        return;
      }
      setAlertCopy(labels.toastActionFailed);
    }
  };

  const ConfirmIcon: SvgIconComponent = isActive ? DeactivateIcon : ActivateIcon;

  return (
    <Dialog
      open={open && plan !== null}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{ paper: { sx: theme => ({ borderRadius: 3, boxShadow: theme.palette.shadow.card }) } }}
    >
      <DialogTitle component="h2" sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 1 }}>
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          {confirmTitleOf(plan, labels)}
        </Box>
        {/* Header close affordance (X) — mirrors PlanFormDialog; disabled while
            the transition mutation is in flight so the row state stays coherent. */}
        <IconButton aria-label={labels.close} onClick={onClose} disabled={loading} sx={{ mr: -1 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} useFlexGap>
          {alertCopy !== null && (
            <Alert severity="error" variant="outlined" data-testid="plan-status-alert">
              {alertCopy}
            </Alert>
          )}
          {plan !== null && (
            <DialogContentText>
              {isActive ? labels.deactivateConfirmBody(plan.title) : labels.activateConfirmBody(plan.title)}
            </DialogContentText>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: "column-reverse", sm: "row" }, gap: 1, px: 3, pb: 3 }}>
        <Button variant="text" onClick={onClose} sx={{ width: { xs: "100%", sm: "auto" } }}>
          {labels.cancel}
        </Button>
        <Button
          variant="contained"
          startIcon={<ConfirmIcon />}
          loading={loading}
          loadingPosition="start"
          disabled={loading}
          onClick={() => void handleConfirm()}
          sx={{ width: { xs: "100%", sm: "auto" } }}
        >
          {labels.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
