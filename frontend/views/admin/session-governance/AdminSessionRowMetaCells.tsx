"use client";

import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import type { AdminSessionsQuery_adminSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import { useAppLocale } from "@/shared/locale";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionRowMetaCells — the governance row's payload meta cells (fee,
 * created, start, end, confirmation deadline, client-derived duration,
 * participants) rendered through the shared `SessionMetaCell` vocabulary.
 * The duration derives client-side from `startedAt`/`endedAt`
 * (presentation-only — D-07: `durationMinutes` is not on the wire);
 * participant ids render verbatim (the admin surface is trusted — the
 * directory is intentionally unscoped per-row). Extracted verbatim from
 * `AdminSessionRow`; behavior is unchanged.
 */

/** Typographic placeholder for nullable payload values (NOT locale copy). */
const NO_VALUE_PLACEHOLDER = "—";

/** Rounded whole minutes between two ISO instants, or null when derivable data is missing. */
function durationMinutesBetween(startedAt: string | null, endedAt: string | null): number | null {
  if (startedAt === null || endedAt === null) return null;
  const startedMs = new Date(startedAt).getTime();
  const endedMs = new Date(endedAt).getTime();
  if (Number.isNaN(startedMs) || Number.isNaN(endedMs) || endedMs <= startedMs) return null;
  return Math.round((endedMs - startedMs) / 60000);
}

interface AdminSessionRowMetaCellsProps {
  readonly session: AdminSessionsQuery_adminSessions_items;
  readonly t: AdminSessionGovernanceLabels;
  readonly tSessions: SessionsLabels;
}

/** The row's payload meta cells — a transparent fragment for the row's meta strip. */
export function AdminSessionRowMetaCells({
  session,
  t,
  tSessions,
}: Readonly<AdminSessionRowMetaCellsProps>): ReactNode {
  const locale = useAppLocale();
  const feeText = session.fee === null ? NO_VALUE_PLACEHOLDER : `${session.fee} ${SESSION_FEE_CURRENCY}`;
  const createdText = formatApplicantDate(session.createdAt, locale);
  const startedText =
    session.startedAt === null ? NO_VALUE_PLACEHOLDER : formatApplicantDate(session.startedAt, locale);
  const endedText = session.endedAt === null ? NO_VALUE_PLACEHOLDER : formatApplicantDate(session.endedAt, locale);
  const deadlineText =
    session.confirmationDeadline === null
      ? NO_VALUE_PLACEHOLDER
      : formatApplicantDate(session.confirmationDeadline, locale);
  const durationMinutes = durationMinutesBetween(session.startedAt, session.endedAt);
  const participantsText = `${session.studentId} · ${session.teacherId}`;

  return (
    <>
      <SessionMetaCell label={tSessions.fee} value={feeText} />
      <SessionMetaCell label={tSessions.createdAt} value={createdText} />
      <SessionMetaCell label={t.rowStartLabel} value={startedText} />
      <SessionMetaCell label={t.rowEndLabel} value={endedText} />
      <SessionMetaCell label={t.rowDeadlineLabel} value={deadlineText} />
      <SessionMetaCell
        label={t.rowDurationLabel}
        value={durationMinutes === null ? NO_VALUE_PLACEHOLDER : t.durationMinutesValue(durationMinutes)}
      />
      <SessionMetaCell label={tSessions.participantsLabel} value={participantsText} />
    </>
  );
}
