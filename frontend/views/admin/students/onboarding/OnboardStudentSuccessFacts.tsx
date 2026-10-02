"use client";

/**
 * OnboardStudentSuccessFacts — the success screen's data artifacts,
 * extracted from the success content so each stays small and testable:
 *
 *  - `SuccessHandoffBox` — the parent handoff code's bordered box (the
 *    one place the code renders): monospace, select-on-tap, with the
 *    copy affordance whose state is owned by the caller (copied check /
 *    failure hint) so the code box and the details button share ONE
 *    honest-feedback machine.
 *
 *  - `SuccessReceiptChips` — the offline-payment receipt line: outlined
 *    chips naming the method (the same vocabulary the payment section
 *    offered) and the reference the admin typed, closing the loop on
 *    what was recorded for the subscription.
 */

import {
  CheckOutlined as CheckIcon,
  ContentCopyOutlined as CopyIcon,
  MenuBookOutlined as PlanChipIcon,
} from "@mui/icons-material";
import { Box, Chip, IconButton, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import {
  type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment,
  PaymentGateway,
} from "@/frontend/graphql/generated/gql/graphql";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** The handoff code's bordered box — the muted fill keeps it a quiet artifact. */
const HANDOFF_BOX_SX: SxProps<Theme> = theme => ({
  width: "100%",
  alignItems: "center",
  gap: 1,
  p: 1.5,
  borderRadius: 1,
  border: `1px solid ${theme.palette.divider}`,
  bgcolor: theme.palette.action.hover,
  transition: theme.transitions.create(["border-color", "background-color"]),
  "&:hover": {
    borderColor: `color-mix(in srgb, ${theme.palette.primary.main} 45%, transparent)`,
  },
});

export interface SuccessHandoffBoxProps {
  /** The created parent-handoff code (renders verbatim). */
  readonly code: string;
  /** `true` right after a resolved copy — flips the glyph to a check. */
  readonly copied: boolean;
  /** `true` when every copy path failed — swaps the hint under the box. */
  readonly failed: boolean;
  /** The copy affordance's action (the caller owns the clipboard seam). */
  readonly onCopy: () => void;
  /** The success labels block (code line + copy feedback vocabulary). */
  readonly labels: StudentOnboardingLabels["success"];
}

export function SuccessHandoffBox({ code, copied, failed, onCopy, labels }: SuccessHandoffBoxProps): ReactNode {
  return (
    <Stack sx={{ width: "100%", gap: 0.5 }}>
      <Typography variant="body2">{labels.handshakeCode(code)}</Typography>
      <Stack direction="row" sx={HANDOFF_BOX_SX}>
        <Typography
          variant="body2"
          // Select-on-tap: the code is a handoff token, so the whole
          // line lifts into the clipboard selection in one gesture.
          sx={{ fontFamily: "monospace", letterSpacing: 1, userSelect: "all" }}
        >
          {code}
        </Typography>
        <IconButton
          size="small"
          aria-label={labels.copyCode}
          onClick={onCopy}
          sx={theme => ({ marginInlineStart: "auto", color: theme.palette.primary.main })}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
      </Stack>
      {failed ? (
        <Typography variant="caption" sx={theme => ({ color: theme.palette.error.main })}>
          {labels.copyFailed}
        </Typography>
      ) : null}
      {copied ? (
        <Typography variant="caption" sx={theme => ({ color: theme.palette.success.main })}>
          {labels.codeCopied}
        </Typography>
      ) : null}
    </Stack>
  );
}

/** The method chip — one outlined chip using the payment section's tone. */
const METHOD_CHIP_SX: SxProps<Theme> = theme => ({
  borderColor: theme.palette.divider,
  bgcolor: theme.palette.background.default,
  "& .MuiChip-label": { fontWeight: 500 },
});

/** The reference chip — the receipt token reads as a monospace artifact. */
const REFERENCE_CHIP_SX: SxProps<Theme> = theme => ({
  borderColor: theme.palette.divider,
  bgcolor: theme.palette.background.default,
  "& .MuiChip-label": { fontFamily: "monospace", letterSpacing: 0.5 },
});

/** The plan chip — what was bought, riding the primary tint ahead of the payment facts. */
const PLAN_CHIP_SX: SxProps<Theme> = theme => ({
  borderColor: `color-mix(in srgb, ${theme.palette.primary.main} 35%, transparent)`,
  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, transparent)`,
  color: theme.palette.primary.main,
  "& .MuiChip-label": { fontWeight: 600 },
});

/** Maps the recorded gateway onto the payment section's own vocabulary. */
const methodLabel = (method: PaymentGateway, labels: StudentOnboardingLabels["paymentSection"]): string | null => {
  if (method === PaymentGateway.OfflineCash) return labels.methods.offlineCash;
  if (method === PaymentGateway.BankTransfer) return labels.methods.bankTransfer;
  if (method === PaymentGateway.Scholarship) return labels.methods.scholarship;
  return null;
};

export interface SuccessReceiptChipsProps {
  /** The mutation payload — rides the subscription's recorded facts. */
  readonly result: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment;
  /** The payment-section labels (method names + reference title). */
  readonly labels: StudentOnboardingLabels["paymentSection"];
  /** The just-purchased plan's title (resolved by the dialog host) — optional. */
  readonly planTitle?: string | null;
}

export function SuccessReceiptChips({ result, labels, planTitle }: SuccessReceiptChipsProps): ReactNode {
  const method = result.subscription.paymentMethod;
  const reference = result.subscription.paymentReference;
  if (method === null && reference === null && !planTitle) return null;
  const methodText = method === null ? null : methodLabel(method, labels);
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {planTitle ? (
        <Chip
          size="small"
          variant="outlined"
          icon={<PlanChipIcon sx={{ fontSize: 15 }} />}
          label={planTitle}
          aria-label={planTitle}
          sx={PLAN_CHIP_SX}
        />
      ) : null}
      {methodText ? (
        <Chip size="small" variant="outlined" label={methodText} aria-label={methodText} sx={METHOD_CHIP_SX} />
      ) : null}
      {reference ? (
        <Chip
          size="small"
          variant="outlined"
          label={reference}
          aria-label={`${labels.reference}: ${reference}`}
          sx={REFERENCE_CHIP_SX}
        />
      ) : null}
    </Box>
  );
}
