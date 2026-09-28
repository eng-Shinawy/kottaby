"use client";

import {
  CheckCircleOutlined as CheckCircleIcon,
  LockOutlined as LockIcon,
  HistoryEduOutlined as ReapplyIcon,
  ScheduleOutlined as ScheduleIcon,
  SchoolOutlined as SchoolIcon,
} from "@mui/icons-material";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { PromptPanel, StatusShell } from "@/frontend/views/teachers/dashboard/ApplicantStatusShell";
import { Applicant, useAppTranslation } from "@/shared/locale";
import type { ApplicantLabels } from "@/shared/locale/types/applicant";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/** Shared CTA metrics — comfortable ≥44px touch target. */
const reapplyButtonSx = { minHeight: 54, px: 3 } as const;

// ----------------------------------------------------------------------------
// Zone compositions + branch sub-components
// ----------------------------------------------------------------------------

interface PendingZoneProps {
  readonly promptText: string;
  readonly purchaseLabel: string;
  /** Opens the verification-purchase confirmation dialog. */
  readonly onPurchaseIntent: () => void;
}

/**
 * Pending body (branch 5): the awaiting-purchase prompt panel plus the
 * ENABLED purchase CTA that opens the verification-purchase dialog.
 */
export function PendingZone({ promptText, purchaseLabel, onPurchaseIntent }: Readonly<PendingZoneProps>): ReactNode {
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <PromptPanel>{promptText}</PromptPanel>
      <Button variant="contained" startIcon={<LockIcon />} onClick={onPurchaseIntent} sx={{ ...reapplyButtonSx }}>
        {purchaseLabel}
      </Button>
    </Stack>
  );
}

interface CooldownZoneProps {
  /** `cooldownExpiryLine` already expanded with the formatted instant. */
  readonly expiryText: string;
  readonly reapplyLabel: string;
}

/**
 * Failed + active-cooldown body (branch 7): warning-tinted expiry line plus
 * the DISABLED re-apply CTA — `eligibleToReapply` is intentionally absent
 * while the waiting period runs.
 */
export function CooldownZone({ expiryText, reapplyLabel }: Readonly<CooldownZoneProps>): ReactNode {
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Box
        sx={theme => ({
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          p: 2,
          borderRadius: 2,
          bgcolor: theme.palette.warningContainer,
          color: theme.palette.onWarningContainer,
        })}
      >
        <ScheduleIcon fontSize="small" />
        <Typography variant="body2">{expiryText}</Typography>
      </Box>
      {/* Disabled affordance mirrors the prototype's locked button: same
          label, unavailable while the cooldown runs. */}
      <Button
        variant="outlined"
        startIcon={<LockIcon />}
        disabled
        sx={theme => ({
          ...reapplyButtonSx,
          "&.Mui-disabled": {
            cursor: "not-allowed",
            borderStyle: "dashed",
            color: theme.palette.action.disabled,
            bgcolor: theme.palette.action.disabledBackground,
            opacity: 0.72,
          },
        })}
      >
        {reapplyLabel}
      </Button>
    </Stack>
  );
}

interface EligibleZoneProps {
  readonly eligibleText: string;
  readonly reapplyLabel: string;
  /** Opens the verification-purchase confirmation dialog. */
  readonly onPurchaseIntent: () => void;
}

/**
 * Failed + eligible body (branch 8): success-tinted explanatory copy plus
 * the ENABLED re-apply CTA that opens the verification-purchase dialog.
 */
export function EligibleZone({ eligibleText, reapplyLabel, onPurchaseIntent }: Readonly<EligibleZoneProps>): ReactNode {
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <PromptPanel icon={<CheckCircleIcon fontSize="small" />}>{eligibleText}</PromptPanel>
      <Button variant="contained" startIcon={<ReapplyIcon />} onClick={onPurchaseIntent} sx={{ ...reapplyButtonSx }}>
        {reapplyLabel}
      </Button>
    </Stack>
  );
}

interface CertifiedBranchProps {
  readonly t: ApplicantLabels;
  /**
   * Renders the informational teaching-surfaces hint. Only the
   * null-payload branch sets it — the explicit `Passed` row does not need
   * surface guidance beyond its known-good narrative.
   */
  readonly showHint?: boolean;
}

/** Certified-summary composition shared by branches 4 and 9 shells. */
export function CertifiedBranch({ t, showHint }: Readonly<CertifiedBranchProps>): ReactNode {
  return (
    <StatusShell accent={palette => palette.success.main}>
      <CertifiedNarrative />
      {/* Informational pointer to the teaching surfaces unlocked by
          certification — mentions NO route; navigation itself stays in the
          existing dashboard sidebar. */}
      {showHint ? (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.certifiedSurfacesHint}
        </Typography>
      ) : null}
    </StatusShell>
  );
}

/** Corrupt-status notice — standard mapped error copy; alerts but never crashes. */
export function CorruptStatusNotice({ te }: { readonly te: ErrorsLabels }): ReactNode {
  return (
    <Alert severity="error" variant="outlined">
      {te.applicantStatusCorrupt}
    </Alert>
  );
}

/** Certified/passed narrative panel (branches 4 and 9). */
export function CertifiedNarrative(): ReactNode {
  const t = useAppTranslation(Applicant);
  return (
    <Box
      sx={theme => ({
        display: "flex",
        alignItems: "flex-start",
        gap: 1.5,
        p: 2,
        borderRadius: 2,
        bgcolor: theme.palette.successContainer,
        color: theme.palette.onSuccessContainer,
      })}
    >
      <SchoolIcon fontSize="small" />
      <Typography variant="body2">{t.certifiedSummary}</Typography>
    </Box>
  );
}
