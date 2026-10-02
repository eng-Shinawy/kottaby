"use client";

/**
 * OnboardStudentSuccessContent — the post-submit state of the onboarding
 * dialog: the created student's identity block, the parent handoff code
 * (the one place the handshake code renders — a copy affordance writes it
 * to the clipboard for the admin to hand to the parent), the offline
 * payment receipt chips, the credited-session line and the batch history
 * (`OnboardStudentRecentOnboardings`), closed by three actions: the
 * handoff-details copy (name + email + code + credited line in ONE
 * clipboard write), the restart affordance ("onboard another" — the same
 * clean-slate reset as a close, minus the close) and the dismiss
 * ("Done").
 *
 * Copy feedback is HONEST: every write rides `copyTextToClipboard`
 * (async API first, legacy bridge on denial) and a failed copy renders
 * the manual-select hint on the failed affordance instead of a false
 * "copied" confirmation. The initial credential is structurally absent
 * from the mutation payload and never renders here — the copied details
 * cannot leak it either.
 */

import {
  CheckOutlined as CheckIcon,
  ContentCopyOutlined as CopyIcon,
  PersonAddOutlined as PersonAddIcon,
  RepeatOutlined as RepeatIcon,
  CheckCircleOutlined as SuccessIcon,
} from "@mui/icons-material";
import { Box, Button, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment } from "@/frontend/graphql/generated/gql/graphql";
import {
  type RecentOnboardingEntry,
  useOnboardingCopyFeedback,
} from "@/frontend/views/admin/students/onboarding/hooks";
import { OnboardStudentRecentOnboardings } from "@/frontend/views/admin/students/onboarding/OnboardStudentRecentOnboardings";
import {
  SuccessHandoffBox,
  SuccessReceiptChips,
} from "@/frontend/views/admin/students/onboarding/OnboardStudentSuccessFacts";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

export interface OnboardStudentSuccessContentProps {
  /** The onboarding mutation payload (student, subscription, credit, code). */
  readonly result: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment;
  /** The remembered batch history (previous onboardings, newest first). */
  readonly recent: readonly RecentOnboardingEntry[];
  readonly onClose: () => void;
  /** Restart seam — clears the dialog for the next onboarding without a close. */
  readonly onOnboardAnother: () => void;
  /** The just-purchased plan's title — renders on the receipt line when known. */
  readonly planTitle?: string | null;
  /** The restart affordance pre-binding the same plan (cohort onboarding). */
  readonly onOnboardAnotherSamePlan?: () => void;
}

/** The success glyph's tinted circular badge — a soft halo with a quiet pulse (reduced-motion safe). */
const SUCCESS_BADGE_SX: SxProps<Theme> = theme => ({
  width: 56,
  height: 56,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  bgcolor: `color-mix(in srgb, ${theme.palette.success.main} 14%, transparent)`,
  color: theme.palette.success.main,
  animation: "onboardSuccessPulse 2.4s ease-in-out infinite",
  "@keyframes onboardSuccessPulse": {
    "0%, 100%": { transform: "scale(1)" },
    "50%": { transform: "scale(1.06)" },
  },
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

/** The one-shot handoff text: identity, contact, code, and the credited line. */
const buildHandoffDetails = (
  result: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment,
  copy: StudentOnboardingLabels["success"]
): string =>
  [
    result.student.fullName,
    result.student.email,
    result.handshakeCode,
    copy.balanceCredited(result.creditedSessions),
  ].join("\n");

/** Resolves the details button's label — one honest state at a time. */
const resolveDetailsLabel = (failed: boolean, copied: boolean, copy: StudentOnboardingLabels["success"]): string => {
  if (failed) return copy.copyFailed;
  if (copied) return copy.detailsCopied;
  return copy.copyDetails;
};

export function OnboardStudentSuccessContent({
  result,
  recent,
  onClose,
  onOnboardAnother,
  planTitle,
  onOnboardAnotherSamePlan,
}: OnboardStudentSuccessContentProps): ReactNode {
  const t = useAppTranslation(StudentOnboarding);
  const { copiedField, failedField, handleCopyText } = useOnboardingCopyFeedback();

  const detailsLabel = resolveDetailsLabel(failedField === "details", copiedField === "details", t.success);

  return (
    <>
      <DialogTitle id="onboard-student-dialog-title" sx={{ fontWeight: 600 }}>
        {t.success.title}
      </DialogTitle>
      <DialogContent sx={theme => ({ paddingInline: theme.spacing(3) })}>
        <Stack sx={{ gap: 2, mt: 1, alignItems: "flex-start" }}>
          <Box sx={SUCCESS_BADGE_SX}>
            <SuccessIcon sx={{ fontSize: 32 }} />
          </Box>
          <Box sx={{ maxWidth: "100%" }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {result.student.fullName}
            </Typography>
            <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
              {result.student.email}
            </Typography>
          </Box>
          <Divider sx={{ width: "100%" }} />
          <SuccessHandoffBox
            code={result.handshakeCode}
            copied={copiedField === "code"}
            failed={failedField === "code"}
            onCopy={() => handleCopyText(result.handshakeCode, "code")}
            labels={t.success}
          />
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.success.balanceCredited(result.creditedSessions)}
          </Typography>
          <SuccessReceiptChips result={result} labels={t.paymentSection} planTitle={planTitle} />
          <OnboardStudentRecentOnboardings entries={recent} excludeCode={result.handshakeCode} labels={t.success} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: "wrap" }}>
        <Button
          variant="text"
          startIcon={copiedField === "details" ? <CheckIcon /> : <CopyIcon />}
          onClick={() => handleCopyText(buildHandoffDetails(result, t.success), "details")}
          sx={theme => (failedField === "details" ? { color: theme.palette.error.main } : {})}
        >
          {detailsLabel}
        </Button>
        {onOnboardAnotherSamePlan ? (
          <Button variant="text" startIcon={<RepeatIcon />} onClick={onOnboardAnotherSamePlan}>
            {t.success.onboardAnotherSamePlan}
          </Button>
        ) : null}
        <Button variant="outlined" startIcon={<PersonAddIcon />} onClick={onOnboardAnother}>
          {t.success.onboardAnother}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t.success.done}
        </Button>
      </DialogActions>
    </>
  );
}
