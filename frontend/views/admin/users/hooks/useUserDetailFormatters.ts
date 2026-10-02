"use client";

/**
 * useUserDetailFormatters — the locale-bound timestamp/date/relative-time
 * formatter trio of the admin user-detail surfaces, extracted from
 * `useAdminUserDetail` (the 150-line view-file convention; the
 * `PanelCard`/`DeleteConfirmDialogBody` extraction precedent).
 *
 * Intl.DateTimeFormat instances are locale-bound; recreating per render is
 * fine for ~10 timestamps per page. useMemo guards against re-creating
 * for the same locale on every keystroke re-render.
 */

import { useMemo } from "react";
import { useAppLocale } from "@/frontend/hooks/locale";
import { formatDirectoryRelativeTime } from "@/frontend/views/admin/users/utils/adminUsersDirectory.helpers";
import { formatTimestamp } from "@/frontend/views/admin/users/utils/userDetailFormatters";

export function useUserDetailFormatters() {
  const locale = useAppLocale();
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale]
  );
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  // Server timestamps (lastActiveAt, createdAt, updatedAt, deletedAt,
  // suspendedAt, blockedAt, applicant.lastAttemptAt, applicant.cooldownUntil)
  // arrive as ISO-8601 strings; `dateOfBirth` is a Drizzle `date` column —
  // a calendar `YYYY-MM-DD` string the user reads as a date literal. Both
  // share the same null-guard + NaN-guard + format pipeline.
  const fmtTimestamp = (raw: string | null | undefined): string => formatTimestamp(raw, dateTimeFormatter);
  const fmtDate = (raw: string | null | undefined): string => formatTimestamp(raw, dateFormatter);
  const fmtRelative = (raw: string | null | undefined): string => formatDirectoryRelativeTime(raw, locale);

  return { fmtTimestamp, fmtDate, fmtRelative };
}
