"use client";

import CloseOutlined from "@mui/icons-material/CloseOutlined";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import { PlanPurchaseSummaryBody } from "@/frontend/views/student/plans/PlanPurchaseSummaryBody";
import { useAppTranslation } from "@/shared/locale/client";
import { Checkout } from "@/shared/locale/namespaces/checkout";

/** Accessible dialog title id (aria-labelledby target). */
const PURCHASE_CONFIRM_TITLE_ID = "purchase-confirm-title";

export interface PlanPurchaseConfirmDialogProps {
  readonly open: boolean;
  readonly plan: PlanCatalogQuery_planCatalog | null;
  readonly purchasing: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

/**
 * PlanPurchaseConfirmDialog — the Buy CTA's confirmation dialog.
 *
 * Presents the selected plan's summary (title, session count, validity
 * window) and the server-provided price as a localized amount string, the
 * secure-redirect explainer, and the confirm/cancel pair (the summary
 * content lives in `PlanPurchaseSummaryBody`). Cancel keeps the purchase
 * attempt's idempotency key alive (the hook rotates only on success), so a
 * retried submit replays the same server-side attempt.
 *
 * Money-mutation safety: the dialog NEVER mutates plan state — it renders
 * the catalog row verbatim and hands the plan id to the container's
 * `onConfirm`, which drives the mutation through `usePurchaseSubscription`.
 */
export function PlanPurchaseConfirmDialog({
  open,
  plan,
  purchasing,
  error,
  onClose,
  onConfirm,
}: Readonly<PlanPurchaseConfirmDialogProps>): React.ReactElement | null {
  const t = useAppTranslation(Checkout);

  if (!plan) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={PURCHASE_CONFIRM_TITLE_ID}
      fullWidth
      maxWidth="xs"
      slotProps={{
        backdrop: {
          sx: theme => ({ backgroundColor: alpha(theme.palette.common.black, 0.65) }),
        },
        paper: {
          elevation: 24,
          sx: theme => ({
            bgcolor:
              theme.palette.mode === "dark"
                ? theme.palette.surfaceContainerHighest
                : theme.palette.surfaceContainerHigh,
            border: 1,
            borderColor: theme.palette.divider,
          }),
        },
      }}
    >
      <DialogTitle id={PURCHASE_CONFIRM_TITLE_ID} sx={{ fontWeight: 700, pr: 6 }}>
        {t.confirmDialogTitle}
      </DialogTitle>
      <IconButton
        aria-label={t.cancelButton}
        onClick={onClose}
        disabled={purchasing}
        sx={theme => ({
          position: "absolute",
          top: 8,
          right: 8,
          p: 1.5,
          color: theme.palette.text.secondary,
          "& svg": { fontSize: 20 },
        })}
      >
        <CloseOutlined fontSize="small" />
      </IconButton>
      <DialogContent sx={{ pt: 1 }}>
        <PlanPurchaseSummaryBody plan={plan} error={error} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, pt: 1 }}>
        <Button
          onClick={onClose}
          disabled={purchasing}
          sx={theme => ({
            minHeight: 44,
            fontWeight: 600,
            color: theme.palette.text.primary,
            border: 1,
            borderColor: theme.palette.divider,
            borderRadius: 2,
            flex: { xs: 1 },
          })}
        >
          {t.cancelButton}
        </Button>
        <Button onClick={onConfirm} variant="contained" disabled={purchasing} sx={{ minHeight: 44, flex: { xs: 1 } }}>
          {purchasing ? t.confirmBusyButton : t.confirmButton}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
