/**
 * Pure display plumbing for the admin academic-tracking surfaces — the
 * mapping layer between the read-model GraphQL payloads and the localized
 * label slots the `adminAcademic` namespace exposes. Everything here is
 * display-only: no fetching, no mutation, no formatting side effects.
 *
 *  - Count/rating numbers go through `Intl.NumberFormat` for digit
 *    localization (presentation only; the wire values are never rewritten).
 *  - Surah/Juz references render through the shared `formatSurahJuzRef`
 *    vocabulary (`Juz30` → `Juz 30`), never raw wire codes.
 *  - Null scalars render as the honest em-dash placeholder or a dedicated
 *    localized label — a null is never coerced into a fabricated `0`.
 */

import { AdminAcademicAttentionReason, type SurahJuzRef } from "@/frontend/graphql/generated/gql/graphql";
import { formatCount, formatRatingAverage } from "@/frontend/views/admin/analytics/platform-analytics-display";
import { formatSurahJuzRef } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

/** Honest placeholder for a null scalar cell — an em-dash, never a fabricated `0`. */
export const NULL_VALUE_PLACEHOLDER = "—";

/** Structural shape shared by the dashboard's latest-position slot and the homework track block. */
export interface AcademicPositionFields {
  readonly surahJuz: SurahJuzRef | null;
  readonly fromAyah: number | null;
  readonly toAyah: number | null;
}

/** Attention-reason enum value → the localized label slot on the namespace. */
const ATTENTION_REASON_LABEL_KEYS: Readonly<
  Record<AdminAcademicAttentionReason, "attentionReasonLowGrade" | "attentionReasonStaleProgress">
> = {
  [AdminAcademicAttentionReason.LowGrade]: "attentionReasonLowGrade",
  [AdminAcademicAttentionReason.StaleProgress]: "attentionReasonStaleProgress",
};

/**
 * Resolves the localized label for one attention reason. Both canonical
 * reasons may co-occur on one flag; the caller renders one chip per reason.
 */
export function attentionReasonLabel(reason: AdminAcademicAttentionReason, labels: AdminAcademicLabels): string {
  return labels[ATTENTION_REASON_LABEL_KEYS[reason]];
}

/**
 * The two PARTS of a latest-position run — the surah/juz reference and the
 * localized ayah range — for surfaces that stack them on two lines (the
 * dense desktop table) instead of joining them into one run. Same
 * fail-closed shape as {@link formatAcademicPositionText}: an absent slot
 * or missing reference yields `null`.
 */
export function formatAcademicPositionParts(
  position: AcademicPositionFields | null,
  ayahRangeLabel: string,
  locale: string
): { reference: string; range: string | null } | null {
  if (position?.surahJuz == null) {
    return null;
  }
  const reference = formatSurahJuzRef(position.surahJuz);
  if (position.fromAyah === null && position.toAyah === null) {
    return { reference, range: null };
  }
  const fromAyah = position.fromAyah === null ? NULL_VALUE_PLACEHOLDER : formatCount(position.fromAyah, locale);
  const toAyah = position.toAyah === null ? NULL_VALUE_PLACEHOLDER : formatCount(position.toAyah, locale);
  return { reference, range: `${ayahRangeLabel} ${fromAyah}–${toAyah}` };
}

/**
 * Composes a latest-position run ("Juz 5 · Ayahs 1–20") with localized
 * digits. Returns `null` when the slot is absent or the reference is
 * missing (fail-closed — the caller renders the dedicated none-assigned
 * label instead of a partial fabrication).
 */
export function formatAcademicPositionText(
  position: AcademicPositionFields | null,
  ayahRangeLabel: string,
  locale: string
): string | null {
  if (position === null) {
    return null;
  }
  if (position.surahJuz === null) {
    return null;
  }
  const reference = formatSurahJuzRef(position.surahJuz);
  if (position.fromAyah === null && position.toAyah === null) {
    return reference;
  }
  const fromAyah = position.fromAyah === null ? NULL_VALUE_PLACEHOLDER : formatCount(position.fromAyah, locale);
  const toAyah = position.toAyah === null ? NULL_VALUE_PLACEHOLDER : formatCount(position.toAyah, locale);
  return `${reference} · ${ayahRangeLabel} ${fromAyah}–${toAyah}`;
}

/**
 * Renders one track's grade next to its track name ("Jadid (new
 * memorization): 85"). A wholly-absent track block (or one whose members
 * are all null — the fail-closed wire shape) renders the none-assigned
 * copy; a present-but-ungraded track renders the not-graded-yet copy —
 * the two honest states never share a label.
 */
export function formatHomeworkTrackGradeText(
  track: (AcademicPositionFields & { readonly grade: number | null }) | null,
  trackLabel: string,
  noneAssignedLabel: string,
  notGradedLabel: string,
  locale: string
): string {
  if (
    track === null ||
    (track.surahJuz === null && track.grade === null && track.fromAyah === null && track.toAyah === null)
  ) {
    return `${trackLabel}: ${noneAssignedLabel}`;
  }
  if (track.grade === null) {
    return `${trackLabel}: ${notGradedLabel}`;
  }
  return `${trackLabel}: ${formatCount(track.grade, locale)}`;
}

/** Locale-aware display of a per-track grade average (up to two fraction digits). */
export function formatAcademicAverage(average: number, locale: string): string {
  return formatRatingAverage(average, locale);
}

/**
 * Normalizes the dashboard search draft into the applied wire value: the
 * trimmed term, or `null` when empty so the backend filter drops out
 * (the unfiltered listing — never an empty-string pattern).
 */
export function normalizeDashboardSearch(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Coerces the wire `ID` of a dashboard row into the numeric student id the
 * drill-down route argument expects. Returns `null` for anything that is
 * not a positive integer — the row then renders without its drill-down
 * link (fail-closed, never a broken route).
 */
export function parseStudentId(rawId: string): number | null {
  const parsed = Number(rawId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** History date — the session-start stamp with the row-creation fallback. */
export function academicHistoryDateIso(entry: {
  readonly sessionStartedAt: string | null;
  readonly createdAt: string;
}): string {
  return entry.sessionStartedAt ?? entry.createdAt;
}
