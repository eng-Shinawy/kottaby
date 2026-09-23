"use client";

/**
 * SubscriptionExpiryBadge — the relative expiry-window badge of the admin
 * drawer's subscription rows: the counted day copy resolves through the
 * namespace's CLDR forms (the final day reads as the zero arm of
 * `upcoming`; the past arm only ever receives a strictly positive elapsed
 * count), and the tone lanes mirror the status semantics (elapsed →
 * error, the final week → warning, otherwise neutral). The absolute
 * absolute bound rides the tooltip (the badge itself stays relative).
 *
 * Presentational: the bound + locale arrive via props; the day math rides
 * the pure `daysUntil`/`expiryBadgeKind` helpers. MUI v9 `sx`-only
 * styling with the shared directory tone lanes.
 */
import { Chip, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { daysUntil, expiryBadgeKind } from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { type DirectoryTone, toneColors } from "@/frontend/views/admin/users/utils";
import type { AppLocale } from "@/shared/locale";

interface SubscriptionExpiryBadgeProps {
  /** The period's end bound (the badge only renders when it exists). */
  readonly endDate: string;
  readonly locale: AppLocale;
  readonly labels: {
    readonly upcoming: (days: number) => string;
    readonly past: (days: number) => string;
  };
}

/** Which lane the badge rides: elapsed rows scream, the final week warns. */
function expiryBadgeTone(kind: "upcoming" | "past", days: number): DirectoryTone {
  if (kind === "past") {
    return "error";
  }
  return days <= 7 ? "warning" : "neutral";
}

export function SubscriptionExpiryBadge({ endDate, locale, labels }: SubscriptionExpiryBadgeProps): ReactNode {
  const days = daysUntil(endDate);
  const kind = expiryBadgeKind(endDate);
  const text = kind === "past" ? labels.past(Math.abs(days)) : labels.upcoming(days);
  return (
    <Tooltip title={formatApplicantDate(endDate, locale)} placement="top">
      <Chip
        label={text}
        size="small"
        sx={theme => {
          const colors = toneColors(theme, expiryBadgeTone(kind, days));
          return {
            bgcolor: colors.bg,
            color: colors.fg,
            fontSize: "0.75rem",
            height: 22,
            fontVariantNumeric: "tabular-nums",
          };
        }}
      />
    </Tooltip>
  );
}
