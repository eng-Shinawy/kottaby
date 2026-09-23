"use client";

import { CloseRounded as CloseIcon, ErrorOutlined as ErrorIcon, LockOutlined as LockIcon } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import {
  expandPurchasePlanLine,
  useVerificationPurchase,
} from "@/frontend/views/teachers/dashboard/useVerificationPurchase";
import { Applicant, Common, useAppTranslation } from "@/shared/locale";

/** Snackbar auto-hide cadence shared by the purchase notice lanes. */
const PURCHASE_NOTICE_AUTOHIDE_MS = 6000;

/** A11y + test wiring ids for the single purchase dialog instance. */
const DIALOG_TITLE_ID = "verification-purchase-dialog-title";
const DIALOG_TEST_ID = "verification-purchase-dialog";

interface VerificationPurchaseDialogProps {
  /** Whether the confirmation dialog is open. */
  readonly open: boolean;
  /** Dismisses the dialog (backdrop, close icon, cancel affordance, settled outcomes). */
  readonly onClose: () => void;
  /**
   * Refetches the applicant profile query handle after the outcomes that
   * change the lifecycle row server-side (success + the cooldown rejection).
   */
  readonly refetchProfile: () => Promise<unknown>;
}

interface PurchasePlanBodyProps {
  /** `true` while the ACTIVE catalog snapshot is in flight. */
  readonly catalogLoading: boolean;
  /** The title-matched verification plan row, or `null` when absent. */
  readonly verificationPlan: PlanCatalogQuery_planCatalog | null;
}

/**
 * Dialog body — the catalog progress marker, the missing-plan error
 * posture, and the expanded plan descriptor line (values entirely from the
 * catalog row + the `purchasePlanLine` ICU placeholders).
 */
function PurchasePlanBody({ catalogLoading, verificationPlan }: Readonly<PurchasePlanBodyProps>): ReactNode {
  const t = useAppTranslation(Applicant);
  return (
    <>
      {catalogLoading ? <LinearProgress aria-label={t.purchaseDialogTitle} /> : null}
      {verificationPlan === null && !catalogLoading ? (
        <Alert
          severity="error"
          variant="outlined"
          icon={<ErrorIcon fontSize="small" />}
          data-testid="verification-purchase-missing-plan"
        >
          {t.purchaseGenericError}
        </Alert>
      ) : null}
      {verificationPlan !== null ? (
        <Box
          sx={theme => ({
            display: "flex",
            alignItems: "flex-start",
            gap: 1.5,
            p: 2,
            borderRadius: 2,
            bgcolor: theme.palette.primaryContainer,
            color: theme.palette.onPrimaryContainer,
          })}
        >
          <Typography variant="body1" sx={{ fontWeight: 600 }} dir="auto">
            {expandPurchasePlanLine(t.purchasePlanLine, verificationPlan)}
          </Typography>
        </Box>
      ) : null}
    </>
  );
}

/**
 * VerificationPurchaseDialog — the confirm gate for the teacher-applicant
 * verification-plan purchase, mounted by the applicant status card and
 * opened from its purchase/re-apply affordances.
 *
 * Renders the plan descriptor (the `planCatalog` row title-matched on the
 * shared `VERIFICATION_PLAN_TITLE` resolution constant — a missing catalog
 * plan disables the confirm affordance and renders the localized error
 * posture), the confirm/cancel affordances, and the shared `NoticeSnackbar`
 * notice slot. The purchase write path — mutation, per-attempt idempotency
 * key, outcome lanes — lives in {@link useVerificationPurchase}.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through theme
 * palette callbacks, `CloseRounded`/`ErrorOutlined`/`*Outlined` icons,
 * RTL-safe logical composition, React 19 event handling, and every
 * user-facing string resolved through the compile-time `Applicant`
 * namespace handle (property access only — never `t('key')`).
 */
export function VerificationPurchaseDialog({
  open,
  onClose,
  refetchProfile,
}: Readonly<VerificationPurchaseDialogProps>): ReactNode {
  const t = useAppTranslation(Applicant);
  const commonT = useAppTranslation(Common);
  const { catalogLoading, verificationPlan, purchasing, notice, confirmPurchase, dismissNotice } =
    useVerificationPurchase({ open, onClose, refetchProfile });
  const confirmDisabled = catalogLoading || purchasing || verificationPlan === null;

  const handleConfirm = (): void => {
    void confirmPurchase();
  };

  // Unmount-on-close (the repo's dialog convention): the closed dialog leaves
  // the tree entirely — no exit transition — while the transient purchase
  // notice stays visible through the shared snackbar slot.
  if (!open) {
    return <NoticeSnackbar notice={notice} autoHideDuration={PURCHASE_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />;
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        aria-labelledby={DIALOG_TITLE_ID}
        data-testid={DIALOG_TEST_ID}
      >
        <DialogTitle
          id={DIALOG_TITLE_ID}
          sx={theme => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            fontWeight: 700,
            color: theme.palette.text.primary,
          })}
        >
          {t.purchaseDialogTitle}
          <IconButton
            aria-label={commonT.close}
            onClick={onClose}
            disabled={purchasing}
            sx={theme => ({ ...focusVisibleRingSx, color: theme.palette.text.secondary })}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <PurchasePlanBody catalogLoading={catalogLoading} verificationPlan={verificationPlan} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={onClose}
            disabled={purchasing}
            variant="outlined"
            color="inherit"
            sx={theme => ({ ...focusVisibleRingSx, minHeight: 44, color: theme.palette.text.secondary })}
          >
            {t.purchaseCancelCta}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            disabled={confirmDisabled}
            loading={purchasing}
            autoFocus
            startIcon={<LockIcon />}
            sx={focusVisibleRingSx}
          >
            {t.purchaseConfirmCta}
          </Button>
        </DialogActions>
      </Dialog>
      <NoticeSnackbar notice={notice} autoHideDuration={PURCHASE_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />
    </>
  );
}
