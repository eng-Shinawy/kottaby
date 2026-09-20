"use client";

import { Alert, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";

/**
 * Dispute-case family primitives — the building blocks every surface's
 * case dialog shares (the admin review dialog, the two participant
 * mirrors): the evidence-section shell, the evidence blocks, the
 * generic-error slot, and the `aria-busy` skeleton. Extracted as the
 * family's jscpd clone elimination — the arbitration vocabulary stays ONE
 * definition site, so the tri-party story (admin queue → teacher dialog →
 * student dialog) never forks its copy.
 */

/** Typographic placeholder for nullable payload values (NOT locale copy). */
export const NO_VALUE_PLACEHOLDER = "—";

/** One evidence section: heading + body (the caller owns the empty state). */
export function CaseSection({
  title,
  testId,
  children,
}: Readonly<{
  title: string;
  testId: string;
  children: ReactNode;
}>): ReactNode {
  return (
    <Stack data-testid={testId} sx={{ gap: 1 }}>
      <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

/** The structural homework evidence the family renders (wire shapes agree). */
export interface DisputeCaseHomeworkShape {
  readonly currentFromAyah: number | null;
  readonly currentToAyah: number | null;
  readonly currentGrade: number | null;
  readonly currentSurahJuz: string | null;
  readonly revisionFromAyah: number | null;
  readonly revisionToAyah: number | null;
  readonly revisionGrade: number | null;
  readonly revisionSurahJuz: string | null;
}

/** Ayah-range value line — verbatim numbers with the em-dash for unset leaves. */
function homeworkRangeText(from: number | null, to: number | null): string {
  return `${from ?? NO_VALUE_PLACEHOLDER} – ${to ?? NO_VALUE_PLACEHOLDER}`;
}

/** One homework block (current or revision): label over the verbatim evidence line. */
export function DisputeCaseHomeworkBlock({
  label,
  homework,
  rangeFromKey,
}: Readonly<{
  label: string;
  homework: DisputeCaseHomeworkShape;
  rangeFromKey: "current" | "revision";
}>): ReactNode {
  const from = rangeFromKey === "current" ? homework.currentFromAyah : homework.revisionFromAyah;
  const to = rangeFromKey === "current" ? homework.currentToAyah : homework.revisionToAyah;
  const grade = rangeFromKey === "current" ? homework.currentGrade : homework.revisionGrade;
  const surahJuz = rangeFromKey === "current" ? homework.currentSurahJuz : homework.revisionSurahJuz;

  return (
    <SessionMetaCell
      label={label}
      value={`${homeworkRangeText(from, to)} · ${grade ?? NO_VALUE_PLACEHOLDER} · ${surahJuz ?? NO_VALUE_PLACEHOLDER}`}
    />
  );
}

/** One report block: the authored notes over the attribution meta cell. */
export function DisputeCaseReportBlock({
  notes,
  rating,
  ratingLabel,
}: Readonly<{
  notes: string;
  rating: number;
  ratingLabel: string;
}>): ReactNode {
  return (
    <Stack sx={{ gap: 1.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, unicodeBidi: "isolate" }} dir="auto">
        {notes}
      </Typography>
      <SessionMetaCell label={ratingLabel} value={rating.toString()} />
    </Stack>
  );
}

/** One recitation block: the name over the honest description line. */
export function DisputeCaseRecitationBlock({
  recitation,
}: Readonly<{
  recitation: { readonly name: string; readonly description: string | null };
}>): ReactNode {
  return (
    <Stack sx={{ gap: 0.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {recitation.name}
      </Typography>
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.secondary, unicodeBidi: "isolate" })}
        dir="auto"
      >
        {recitation.description ?? NO_VALUE_PLACEHOLDER}
      </Typography>
    </Stack>
  );
}

/** The family's generic inline failure alert (the masked transport surface). */
export function DisputeCaseErrorSlot({
  testId,
  message,
}: Readonly<{
  testId: string;
  message: string;
}>): ReactNode {
  return (
    <Stack data-testid={testId} sx={{ py: 4 }}>
      <Alert severity="error" variant="outlined">
        {message}
      </Alert>
    </Stack>
  );
}

/** The case dialog's `aria-busy` loading slot — bare skeleton lines, stable keys. */
export function DisputeCaseLoadingSkeleton({
  surface,
  testId,
}: Readonly<{
  surface: string;
  testId: string;
}>): ReactNode {
  const loadingKeys = [
    `${surface}-case-loading-session`,
    `${surface}-case-loading-decision`,
    `${surface}-case-loading-report`,
  ];

  return (
    <Stack aria-busy="true" data-testid={testId} sx={{ gap: 2, py: 2 }}>
      {loadingKeys.map(key => (
        <Skeleton key={key} variant="rounded" sx={{ height: 56 }} />
      ))}
    </Stack>
  );
}
