"use client";

import { GavelOutlined as DisputeIcon } from "@mui/icons-material";
import { Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { Sessions, useAppTranslation } from "@/shared/locale";
import type { AppLocale } from "@/shared/locale/AppLocale";

interface SessionRowDisputeReasonProps {
  /** Row identity (testid suffix). */
  readonly sessionId: string;
  /** Persisted dispute reason — never empty here (service-side required). */
  readonly reason: string;
  /** The moment the dispute was opened (rendered locale-aware, muted). */
  readonly disputedAt: string;
  /** Active request locale — drives the date formatter. */
  readonly locale: AppLocale;
}

/**
 * Participant-side dispute line — rendered ONLY while the row carries a
 * persisted dispute reason (open OR already-arbitrated: the claimed reason
 * stays part of the case story). Truncated to one line with the FULL reason
 * reachable through the tooltip; the disputed moment sits at the line end
 * (flexShrink:0 — the truncation ellipsis always lands on the reason run,
 * never on the date). Mirrors `SessionRowCancelReason`'s RTL-safe clamp
 * (min-width:0 + xs full-bleed pin) so the line cannot push the card wider
 * inside the wrap-friendly flex row.
 *
 * Both surfaces (student + teacher) share this row part — the dispute was
 * previously visible ONLY through the status chip, leaving the non-filing
 * participant without the "why".
 */
export function SessionRowDisputeReason({
  sessionId,
  reason,
  disputedAt,
  locale,
}: Readonly<SessionRowDisputeReasonProps>): ReactNode {
  const t = useAppTranslation(Sessions);

  return (
    <Tooltip
      title={
        // Portal-rendered tooltip shares the row's RTL base direction — the
        // isolated auto-dir span keeps the free-text story readable there too.
        <span dir="auto">{reason}</span>
      }
      placement="top"
    >
      <Stack
        data-testid={`session-dispute-reason-${sessionId}`}
        sx={{
          gap: 0.5,
          flexDirection: "row",
          // Mobile (xs): the row WRAPS — the reason takes its own full-width
          // line below the icon+label+stamp header instead of starved
          // truncation against the unshrinkable stamp min-content (the
          // round-4 mobile QA finding; the single-line anatomy returns at
          // sm). The xs full-bleed pin below stays for the stretched
          // column child (same reasoning as the cancel-reason line).
          flexWrap: { xs: "wrap", sm: "nowrap" },
          alignItems: "baseline",
          minWidth: 0,
          maxWidth: "100%",
          width: { xs: "100%", sm: "auto" },
          overflow: "hidden",
        }}
      >
        <DisputeIcon
          fontSize="small"
          sx={theme => ({ color: theme.palette.warning.main, fontSize: 16, flexShrink: 0, alignSelf: "center" })}
        />
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary, flexShrink: 0 })}>
          {t.disputeReasonLine}
        </Typography>
        <Typography
          variant="body2"
          noWrap
          dir="auto"
          sx={theme => ({
            color: theme.palette.text.secondary,
            minWidth: 0,
            // Mobile (xs): the reason takes its OWN full-width line (the
            // wrap anatomy — the truncation window widens from "Teach…" to
            // the full card); from sm up it shares the single line with a
            // living flex ratio.
            flex: { xs: "1 1 100%", sm: "1 1 0" },
            // Free-text run (Latin OR Arabic) inside an RTL row: an unisolated
            // Latin sentence's trailing punctuation resolves to the RTL base
            // direction and jumps to the visual run start ("…fee ." → ". …fee")
            // — the round-4 dispute-row QA finding. `dir="auto"` picks the
            // first-strong-character direction (the HTML attribute survives
            // the Arabic cache's cssjanus flip; a CSS `direction` would not),
            // the isolate detaches the run from the row's base direction.
            unicodeBidi: "isolate",
          })}
        >
          {reason}
        </Typography>
        <Typography
          variant="body2"
          noWrap
          dir="ltr"
          title={formatApplicantDate(disputedAt, locale)}
          sx={theme => ({
            color: theme.palette.text.secondary,
            flexShrink: 0,
            opacity: 0.75,
            // Mobile (xs): the stamp jumps BESIDE the label (line 1's
            // inline end) via the order + auto inline-margin pair — the
            // wrap anatomy's full-width reason line would otherwise strand
            // it below (DOM order). From sm up the DOM order returns.
            order: { xs: 2, sm: 0 },
            marginInlineStart: { xs: "auto", sm: 0 },
            // ASCII stamp in an isolated LTR box — the ICU `ar` stamp's RLM
            // controls scramble the visible punctuation against the row's
            // RTL base direction (round-1 wallet QA finding, same class).
            unicodeBidi: "isolate",
            fontVariantNumeric: "tabular-nums",
          })}
        >
          {formatLedgerStamp(disputedAt)}
        </Typography>
      </Stack>
    </Tooltip>
  );
}
