"use client";

/**
 * AdminApplicantDetailCells — the applicant-queue detail column contents:
 * the attempts count, the last-attempt timestamp, the cooldown (date or
 * cooling-down chip), and the joined timestamp — the same semantic content
 * the desktop table and the mobile card list render per row.
 *
 * The em-dash/timestamp fallback is shared: `ApplicantTimestampText` renders
 * the localized timestamp for a present value and the honest em-dash before
 * the first one.
 *
 * Hydration note (cooldown chip): the chip's visibility depends on a clock
 * comparison, so the `now` tick comes from `useMountedClockTick` — "never
 * cooling" on the server render and the first client render (deterministic
 * markup), then settles post-mount — the chip appears after hydration when
 * the window is live, never flickers a mismatch.
 */

import { Typography } from "@mui/material";
import type { ReactNode } from "react";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { ApplicantDirectoryItem } from "@/frontend/views/admin/teachers/AdminApplicantIdentityCell";
import { isCoolingDown } from "@/frontend/views/admin/teachers/adminApplicants.helpers";
import { useMountedClockTick } from "@/frontend/views/admin/teachers/hooks/useMountedClockTick";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AppLocale } from "@/shared/locale";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface ApplicantTimestampTextProps {
  /** The wire timestamp — `null` renders the honest em-dash. */
  readonly value: string | null;
  readonly locale: AppLocale;
}

/** Localized timestamp content — honest em-dash before the first value. */
function ApplicantTimestampText({ value, locale }: ApplicantTimestampTextProps): ReactNode {
  if (value === null) {
    return (
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        —
      </Typography>
    );
  }
  return (
    <Typography variant="body2" component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
      {formatApplicantDate(value, locale)}
    </Typography>
  );
}

interface ApplicantAttemptsTextProps {
  readonly applicant: ApplicantDirectoryItem;
}

/** Attempts content — the wire count rendered verbatim (0 is honest data). */
export function ApplicantAttemptsText({ applicant }: ApplicantAttemptsTextProps): ReactNode {
  return (
    <Typography variant="body2" component="span" sx={theme => ({ color: theme.palette.text.primary, fontWeight: 500 })}>
      {applicant.verificationAttempts}
    </Typography>
  );
}

interface ApplicantLastAttemptTextProps {
  readonly applicant: ApplicantDirectoryItem;
  readonly locale: AppLocale;
}

/** Last-attempt content — localized timestamp, honest em-dash before the first attempt. */
export function ApplicantLastAttemptText({ applicant, locale }: ApplicantLastAttemptTextProps): ReactNode {
  return <ApplicantTimestampText value={applicant.lastAttemptAt} locale={locale} />;
}

interface ApplicantCooldownContentProps {
  readonly applicant: ApplicantDirectoryItem;
  readonly locale: AppLocale;
  readonly labels: Pick<AdminTeachersLabels, "applicantStatus">;
}

/**
 * Cooldown content — the cooling-down chip while the window is still in the
 * future, the localized expiry timestamp once set, or the honest em-dash
 * before any cooldown was granted.
 */
export function ApplicantCooldownContent({ applicant, locale, labels }: ApplicantCooldownContentProps): ReactNode {
  // `Number.POSITIVE_INFINITY` until mounted — the SSR + first-client
  // render must stay byte-identical, so the clock-dependent chip only
  // turns on post-hydration.
  const mountedNow = useMountedClockTick();
  if (isCoolingDown(applicant.cooldownUntil, mountedNow)) {
    return <TonalChip tone="warning" label={labels.applicantStatus.coolingDown} />;
  }
  return <ApplicantTimestampText value={applicant.cooldownUntil} locale={locale} />;
}

interface ApplicantJoinedTextProps {
  readonly applicant: ApplicantDirectoryItem;
  readonly locale: AppLocale;
}

/** Joined content — localized timestamp via the shared frontend date util. */
export function ApplicantJoinedText({ applicant, locale }: ApplicantJoinedTextProps): ReactNode {
  return <ApplicantTimestampText value={applicant.createdAt} locale={locale} />;
}
