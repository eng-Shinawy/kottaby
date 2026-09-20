"use client";

/**
 * AuditTrailMobileFacts — the mobile audit card's label/value fact rows:
 * `CardFact` (the plain label + value line) and `WhenFact` (the two-line
 * relative + absolute stamp, the mobile mirror of the table's When cell).
 * Kept OUT of the owning card file (the 150-line view-file convention) and
 * OUT of each other so the value Typographies render as their own block
 * elements, never nested `<p>`s.
 */

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { formatRelativeAuditStamp } from "@/frontend/lib/i18n/relative-time";

/** Row label + value line shared by the card's fact grid. */
export function CardFact({
  label,
  value,
  muted = false,
}: Readonly<{ label: string; value: ReactNode; muted?: boolean }>): ReactNode {
  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
      <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="p"
        sx={muted ? theme => ({ color: theme.palette.text.secondary }) : { fontWeight: 600 }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * When-fact line: the label caption at the inline-start edge and the two-line
 * relative + absolute value stack at the inline-end edge — the mobile mirror
 * of the table's two-line When cell (kept OUT of `CardFact` so the value
 * Typographies render as their own block elements, never nested `<p>`s).
 */
export function WhenFact({ label, iso, locale }: Readonly<{ label: string; iso: string; locale: string }>): ReactNode {
  const relative = formatRelativeAuditStamp(iso, locale);
  const absolute = formatApplicantDate(iso, locale);
  return (
    <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
      <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      {relative === null ? (
        <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
          {absolute}
        </Typography>
      ) : (
        <Stack spacing={0.25}>
          <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
            {relative}
          </Typography>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {absolute}
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}
