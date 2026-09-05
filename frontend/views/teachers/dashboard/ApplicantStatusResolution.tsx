"use client";

import {
  ErrorOutlined as ErrorIcon,
  RateReviewOutlined as EvaluationIcon,
  HourglassEmptyOutlined as PendingIcon,
  SchoolOutlined as SchoolIcon,
  type SvgIconComponent,
} from "@mui/icons-material";
import { Stack } from "@mui/material";
import type { Palette } from "@mui/material/styles";
import type { ReactNode } from "react";
import {
  ApplicantStatus,
  type MyApplicantProfileQuery_myApplicantProfile,
} from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { StatusTone } from "@/frontend/views/teachers/dashboard/ApplicantStatusShell";
import {
  AttemptsRow,
  CertifiedNarrative,
  CooldownZone,
  CorruptStatusNotice,
  EligibleZone,
  PromptPanel,
} from "@/frontend/views/teachers/dashboard/ApplicantStatusZones";
import type { ApplicantLabels } from "@/shared/locale/types/applicant";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * ICU placeholder contract with `applicant.cooldownExpiryLine`
 * (`{cooldownUntil}` — exactly one token per locale, pinned by the
 * server/client parity suites). Expansion happens HERE, client-side, through
 * {@link formatApplicantDate} so stamps stay byte-consistent with the
 * server-side lifecycle formatter.
 */
const COOLDOWN_PLACEHOLDER = "{cooldownUntil}";

// ----------------------------------------------------------------------------
// Status-body resolution (branches 5–9)
// ----------------------------------------------------------------------------

interface ResolvedStatusBody {
  /** Localized chip label for the lifecycle status. */
  readonly chipLabel: string;
  /** Semantically-matching outlined status icon. */
  readonly chipIcon: SvgIconComponent;
  /** Tone family mapping onto `theme.palette.*Container/on*Container`. */
  readonly tone: StatusTone;
  /** Accent-bar color resolver for the card shell's top edge highlight. */
  readonly accent: (palette: Palette) => string;
  /** Branch-specific body content (prompt / attempts / cooldown / CTA zone). */
  readonly content: ReactNode;
}

/**
 * Selects the per-status presentation for a payload whose status SHOULD be a
 * validated `ApplicantStatus` member (the service fails closed before junk
 * reaches the wire). The `switch` over a same-type enum mirrors the
 * established `ProfileView.getRoleLabel` precedent; the default arm stays
 * defensive-corrupt rather than crashing or claiming anything false.
 */
export function resolveStatusBody(
  status: ApplicantStatus,
  profile: MyApplicantProfileQuery_myApplicantProfile,
  t: ApplicantLabels,
  te: ErrorsLabels,
  locale: string
): ResolvedStatusBody {
  switch (status) {
    case ApplicantStatus.Pending:
      return {
        chipLabel: t.statusPending,
        chipIcon: PendingIcon,
        tone: "pending",
        accent: palette => palette.status.pendingContainer,
        content: <PromptPanel>{t.pendingPrompt}</PromptPanel>,
      };
    case ApplicantStatus.InEvaluation:
      return {
        chipLabel: t.statusInEvaluation,
        chipIcon: EvaluationIcon,
        tone: "info",
        accent: palette => palette.info.main,
        content: (
          <Stack spacing={2}>
            <AttemptsRow attemptCountLabel={t.attemptCountLabel} attempts={profile.verificationAttempts} />
            <PromptPanel>{t.inEvaluationHint}</PromptPanel>
          </Stack>
        ),
      };
    case ApplicantStatus.Failed:
      // Sub-branches keyed off SERVER-COMPUTED flags: clients
      // never re-derive cooldown math locally.
      if (profile.cooldownActive && profile.cooldownUntil !== null) {
        return {
          chipLabel: t.statusFailed,
          chipIcon: ErrorIcon,
          tone: "warning",
          accent: palette => palette.warning.main,
          content: (
            <CooldownZone
              expiryText={expandCooldownUntil(profile.cooldownUntil, t, locale)}
              reapplyLabel={t.reapplyCta}
            />
          ),
        };
      }
      if (profile.cooldownActive || !profile.canPurchaseVerification) {
        // Active cooldown with an unparseable/null instant cannot honestly
        // render a date; fail closed to the bare warning status (no copy
        // that promises anything about timing).
        return {
          chipLabel: t.statusFailed,
          chipIcon: ErrorIcon,
          tone: "warning",
          accent: palette => palette.warning.main,
          content: null,
        };
      }
      // Eligible re-application affordance (purchase route not wired yet).
      return {
        chipLabel: t.statusFailed,
        chipIcon: ErrorIcon,
        tone: "success",
        accent: palette => palette.success.main,
        content: <EligibleZone eligibleText={t.eligibleToReapply} reapplyLabel={t.reapplyCta} />,
      };
    case ApplicantStatus.Passed:
      // Explicit truthfulness branch instead of fall-through.
      return {
        chipLabel: t.statusPassed,
        chipIcon: SchoolIcon,
        tone: "success",
        accent: palette => palette.success.main,
        content: <CertifiedNarrative />,
      };
    default:
      // Defensive corruption arm — unreachable behind the service boundary,
      // yet never crashes if reached (standard mapped error copy).
      return {
        chipLabel: t.statusFailed,
        chipIcon: ErrorIcon,
        tone: "warning",
        accent: palette => palette.error.main,
        content: <CorruptStatusNotice te={te} />,
      };
  }
}

/**
 * Expands the localized `cooldownExpiryLine` ICU template with the
 * locale-formatted re-application instant. The token replace is
 * safe on FIRST occurrence only because both parity suites pin exactly one
 * `{cooldownUntil}` placeholder per locale.
 */
function expandCooldownUntil(cooldownUntil: string, t: ApplicantLabels, locale: string): string {
  return t.cooldownExpiryLine.replace(COOLDOWN_PLACEHOLDER, formatApplicantDate(cooldownUntil, locale));
}
