"use client";

import { useQuery } from "@apollo/client/react";
import {
  CheckCircleOutlined as CheckCircleIcon,
  ErrorOutlined as ErrorIcon,
  RateReviewOutlined as EvaluationIcon,
  LockOutlined as LockIcon,
  HourglassEmptyOutlined as PendingIcon,
  HistoryEduOutlined as ReapplyIcon,
  ScheduleOutlined as ScheduleIcon,
  SchoolOutlined as SchoolIcon,
  CardMembershipOutlined as StorefrontIcon,
  type SvgIconComponent,
} from "@mui/icons-material";
import { Alert, Box, Button, Card, CardContent, Chip, Skeleton, Stack, Typography } from "@mui/material";
import type { Palette } from "@mui/material/styles";
import Link from "next/link";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import {
  ApplicantStatus,
  type MyApplicantProfileQuery_myApplicantProfile,
} from "@/frontend/graphql/generated/gql/graphql";
import { myApplicantProfileQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { Applicant, Errors, useAppLocale, useAppTranslation } from "@/shared/locale";
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

/** Shared CTA metrics — comfortable ≥44px touch target. */
const reapplyButtonSx = { minHeight: 44, px: 3 } as const;

/**
 * ApplicantStatusCard — the teacher-applicant verification-lifecycle status
 * card mounted above the fold on `/teacher/dashboard`.
 *
 * Self-contained client component: NO props, NO client-side role logic and
 * NO locally derived lifecycle booleans — the page-level server guards remain
 * the ONLY authorization boundary and the `myApplicantProfile` zero-argument
 * query answers identity server-side; every rendered fact comes straight from
 * the payload.
 *
 * Render branches (visual state matrix):
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | query in flight | Skeleton card (`aria-busy`) |
 * | 2 | error code `UNAUTHORIZED` / `FORBIDDEN` | shared `PermissionDeniedFallback` — never bare `null` |
 * | 3 | any other transport error | inline `Alert` carrying `errors.internalServerError` |
 * | 4 | `myApplicantProfile === null` (one answer for never-applied + certified) | certified summary + informational teaching-surfaces hint |
 * | 5 | `Pending` | pending chip + awaiting-purchase prompt + storefront CTA → `/plans` (the verification plan lives there) |
 * | 6 | `InEvaluation` | info chip + attempt counter + progress hint |
 * | 7 | `Failed` + `cooldownActive` | warning chip + `{cooldownUntil}` expanded via {@link formatApplicantDate} + DISABLED re-apply CTA; `eligibleToReapply` deliberately suppressed — the truthful message is WHEN re-application unlocks |
 * | 8 | `Failed` + `canPurchaseVerification` | success affordance + ENABLED re-apply CTA navigating to `/plans` (re-application begins by purchasing the verification plan on the storefront) |
 * | 9 | `Passed` (explicit truthfulness branch) | passed chip + certified-summary narrative |
 * | — | unknown status value (defensive; server fails closed) | inline `Alert` carrying `errors.applicantStatusCorrupt` — never crashes |
 *
 * The re-apply CTA on the eligible branch navigates to the `/plans`
 * storefront — re-application begins by acquiring the verification plan
 * (DEV1-005 storefront; the DEV1-006 purchase flow will take over the
 * checkout step itself). No branch claims an action the product cannot
 * perform yet.
 *
 * MUI v9 discipline: `sx`-only styling (no direct style props), colors
 * exclusively through `theme.palette.*` callbacks, `*Outlined` icons only,
 * RTL-safe logical composition (flex/grid mirroring — no physical margins),
 * and every user-facing string resolved through compile-time i18n handles
 * (`useAppTranslation(Applicant)` property access — NEVER `t('key')`).
 */
export function ApplicantStatusCard(): ReactNode {
  const t = useAppTranslation(Applicant);
  const te = useAppTranslation(Errors);
  const locale = useAppLocale();
  const { data, loading, error } = useQuery(myApplicantProfileQueryDocument);

  // Branch 1 — in flight: skeleton placeholder announces busy semantics.
  if (loading) {
    return <LoadingSkeleton />;
  }

  // Branches 2–3 — settled failures: denial class vs generic surfaced copy.
  if (error) {
    const code = extractErrorCode(error);
    if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
      return <PermissionDeniedFallback />;
    }
    return (
      <StatusShell>
        <Alert severity="error" variant="outlined">
          {te.internalServerError}
        </Alert>
      </StatusShell>
    );
  }

  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return <LoadingSkeleton />;
  }

  const profile: MyApplicantProfileQuery_myApplicantProfile | null = data.myApplicantProfile;

  // Branch 4 — the single-null answer: a verified teacher with no
  // applicants row sees the certified summary. NEVER pending/evaluation
  // copy, and NEVER a "passed" claim — null does not distinguish the two.
  if (profile === null) {
    return <CertifiedBranch t={t} showHint />;
  }

  const resolved = resolveStatusBody(profile.status, profile, t, te, locale);

  return (
    <StatusShell accent={resolved.accent}>
      <BranchHeaderRow chip={<StatusChip label={resolved.chipLabel} Icon={resolved.chipIcon} tone={resolved.tone} />}>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          {t.statusCardTitle}
        </Typography>
      </BranchHeaderRow>
      {resolved.content}
    </StatusShell>
  );
}

// ----------------------------------------------------------------------------
// Status-body resolution (branches 5–9)
// ----------------------------------------------------------------------------

/** Visual tone family driving chip + accent-bar colors (theme-palette only). */
type StatusTone = "pending" | "info" | "warning" | "success";

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
function resolveStatusBody(
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
        content: <PendingZone prompt={t.pendingPrompt} ctaLabel={t.pendingPlansCta} />,
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

/** The `/plans` storefront route — the verification plan's consumer home. */
const PLANS_STOREFRONT_ROUTE = "/plans";

// ----------------------------------------------------------------------------
// Zone compositions + branch sub-components
// ----------------------------------------------------------------------------

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
function CooldownZone({ expiryText, reapplyLabel }: Readonly<CooldownZoneProps>): ReactNode {
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
      <Button variant="outlined" startIcon={<LockIcon />} disabled sx={{ ...reapplyButtonSx }}>
        {reapplyLabel}
      </Button>
    </Stack>
  );
}

interface EligibleZoneProps {
  readonly eligibleText: string;
  readonly reapplyLabel: string;
}

/**
 * Failed + eligible body (branch 8): success-tinted explanatory copy plus
 * the ENABLED re-apply CTA — a real navigation into the `/plans` storefront
 * (re-application begins by acquiring the verification plan).
 */
function EligibleZone({ eligibleText, reapplyLabel }: Readonly<EligibleZoneProps>): ReactNode {
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <PromptPanel icon={<CheckCircleIcon fontSize="small" />}>{eligibleText}</PromptPanel>
      {/* Re-application begins on the storefront: acquire the verification
          plan (DEV1-006 will own the checkout step itself). */}
      <Button
        variant="contained"
        startIcon={<ReapplyIcon />}
        component={Link}
        href={PLANS_STOREFRONT_ROUTE}
        sx={{ ...reapplyButtonSx }}
      >
        {reapplyLabel}
      </Button>
    </Stack>
  );
}

interface PendingZoneProps {
  /** `pendingPrompt` — awaiting-purchase copy from the applicant namespace. */
  readonly prompt: string;
  /** `pendingPlansCta` — storefront navigation label. */
  readonly ctaLabel: string;
}

/**
 * Pending body (branch 5): the awaiting-purchase prompt panel PLUS a real
 * destination — the storefront CTA navigates to `/plans`, where the
 * verification plan (and every other active plan) is browsable. Replaces
 * the former dead-end copy-only panel now that the storefront ships.
 */
function PendingZone({ prompt, ctaLabel }: Readonly<PendingZoneProps>): ReactNode {
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <PromptPanel>{prompt}</PromptPanel>
      <Button
        variant="contained"
        startIcon={<StorefrontIcon />}
        component={Link}
        href={PLANS_STOREFRONT_ROUTE}
        sx={{ ...reapplyButtonSx }}
      >
        {ctaLabel}
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
function CertifiedBranch({ t, showHint }: Readonly<CertifiedBranchProps>): ReactNode {
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
function CorruptStatusNotice({ te }: { readonly te: ErrorsLabels }): ReactNode {
  return (
    <Alert severity="error" variant="outlined">
      {te.applicantStatusCorrupt}
    </Alert>
  );
}

interface PanelProps {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
}

/** Tinted body panel echoing the prototypes' inner copy bubble. */
function PromptPanel({ children, icon }: Readonly<PanelProps>): ReactNode {
  return (
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
      {icon}
      <Typography variant="body2">{children}</Typography>
    </Box>
  );
}

interface AttemptsRowProps {
  readonly attemptCountLabel: string;
  readonly attempts: number;
}

/** Verification-attempts counter — label/value pair mirrored by flex wrap. */
function AttemptsRow({ attemptCountLabel, attempts }: Readonly<AttemptsRowProps>): ReactNode {
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 1 }}>
      <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
        {attemptCountLabel}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {attempts}
      </Typography>
    </Box>
  );
}

/** Certified/passed narrative panel (branches 4 and 9). */
function CertifiedNarrative(): ReactNode {
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

// ----------------------------------------------------------------------------
// Shell + chrome primitives
// ----------------------------------------------------------------------------

interface StatusChipProps {
  readonly label: string;
  readonly Icon: SvgIconComponent;
  readonly tone: StatusTone;
}

/** Tone-resolved status chip using Material 3 container/on-container pairs. */
function StatusChip({ label, Icon, tone }: Readonly<StatusChipProps>): ReactNode {
  const toneColors = resolveToneColors(tone);
  return (
    <Chip
      icon={<Icon fontSize="small" />}
      label={label}
      size="small"
      sx={theme => ({
        fontWeight: 600,
        bgcolor: toneColors.bg(theme.palette),
        color: toneColors.fg(theme.palette),
        "& .MuiChip-icon": {
          color: toneColors.fg(theme.palette),
        },
      })}
    />
  );
}

/** Maps a tone family onto its container color pair (ProfileView pattern). */
function resolveToneColors(tone: StatusTone): {
  readonly bg: (palette: Palette) => string;
  readonly fg: (palette: Palette) => string;
} {
  switch (tone) {
    case "pending":
      return { bg: p => p.status.pendingContainer, fg: p => p.status.onPendingContainer };
    case "info":
      return { bg: p => p.infoContainer, fg: p => p.onInfoContainer };
    case "warning":
      return { bg: p => p.warningContainer, fg: p => p.onWarningContainer };
    default:
      return { bg: p => p.successContainer, fg: p => p.onSuccessContainer };
  }
}

interface BranchHeaderRowProps {
  readonly children: ReactNode;
  readonly chip?: ReactNode;
}

/** Title (+ optional status chip) header that wraps to columns on mobile. */
function BranchHeaderRow({ children, chip }: Readonly<BranchHeaderRowProps>): ReactNode {
  return (
    <Stack
      spacing={1.5}
      sx={{
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "flex-start", sm: "center" },
        justifyContent: "space-between",
      }}
    >
      {children}
      {chip}
    </Stack>
  );
}

interface StatusShellProps {
  readonly children: ReactNode;
  /** Accent-bar resolver painted onto the shell's top edge highlight. */
  readonly accent?: (palette: Palette) => string;
}

/** Outer card shell shared by every settled branch (uniform dashboard slot). */
function StatusShell({ children, accent }: Readonly<StatusShellProps>): ReactNode {
  return (
    <Card
      elevation={0}
      data-testid="applicant-status-card"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
        borderTopWidth: 3,
        borderTopStyle: "solid",
        borderTopColor: accent ? accent(theme.palette) : theme.palette.primary.main,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>{children}</CardContent>
    </Card>
  );
}

/** Loading skeleton — title line + badge pill + body panel + CTA placeholder. */
function LoadingSkeleton(): ReactNode {
  return (
    <Card
      elevation={0}
      aria-busy="true"
      data-testid="applicant-status-card-loading"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>
        <Skeleton variant="text" sx={{ fontSize: "1.75rem", maxWidth: 280 }} />
        <Skeleton variant="rounded" sx={{ height: 26, width: 180, borderRadius: 999 }} />
        <Skeleton variant="rounded" sx={{ height: 64, borderRadius: 2 }} />
        <Skeleton variant="rectangular" sx={{ height: 44, width: 170, borderRadius: 2 }} />
      </CardContent>
    </Card>
  );
}
