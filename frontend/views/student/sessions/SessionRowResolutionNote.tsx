"use client";

import { CheckCircleOutlined as ResolvedIcon } from "@mui/icons-material";
import { Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { DisputeResolution as WireDisputeResolution } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { resolutionOutcomeLabel } from "@/frontend/views/shared/disputes/resolution-outcome-label";
import { Sessions, useAppTranslation } from "@/shared/locale";
import type { AppLocale } from "@/shared/locale/AppLocale";

interface SessionRowResolutionNoteProps {
  /** Row identity (testid suffix). */
  readonly sessionId: string;
  /** The formal arbitration decision — null only for pre-CR-5 resolved rows. */
  readonly outcome: WireDisputeResolution | null;
  /**
   * The arbitration note the admin recorded — optional since CR-5: the
   * OUTCOME carries the line; the note is added detail when present.
   */
  readonly note: string | null;
  /** The arbitration moment (rendered locale-aware, muted). */
  readonly resolvedAt: string;
  /** Active request locale — drives the date formatter. */
  readonly locale: AppLocale;
}

/**
 * Participant-side arbitration-outcome line — rendered when the row
 * carries the arbitration terminal stamp (`resolvedAt`) and ANY decision
 * evidence (the stored outcome, or a pre-CR-5 note). The student and the
 * teacher each see HOW the case ended on the row itself: the formal
 * outcome (emphasized), the optional note (truncated, full text through
 * the tooltip), and the resolved moment at the line end (flexShrink:0 —
 * the truncation ellipsis always lands on the note run, never on the
 * date). Mirrors `SessionRowCancelReason`'s RTL-safe clamp (min-width:0 +
 * xs full-bleed pin) so the line cannot push the card wider inside the
 * wrap-friendly flex row.
 *
 * Tone: the check icon picks up `success.main` — the dispute reached a
 * decision; informational emphasis, never an error treatment (the outcome
 * and note copy stay neutral secondary text).
 */
export function SessionRowResolutionNote({
  sessionId,
  outcome,
  note,
  resolvedAt,
  locale,
}: Readonly<SessionRowResolutionNoteProps>): ReactNode {
  const t = useAppTranslation(Sessions);

  return (
    <Tooltip title={note === null ? null : <span dir="auto">{note}</span>} placement="top">
      <Stack
        data-testid={`session-resolution-note-${sessionId}`}
        sx={{
          gap: 0.5,
          flexDirection: "row",
          // Mobile (xs): the row WRAPS into stacked evidence lines — the
          // single-line anatomy's unshrinkable min-contents (label + outcome
          // + note + stamp) exceed the 390px card, and flex would collapse
          // the outcome box to ~0 with its wrapped text overflowing over the
          // stamp (the round-4 mobile QA finding). From sm up the
          // single-line run returns.
          flexWrap: { xs: "wrap", sm: "nowrap" },
          alignItems: "baseline",
          minWidth: 0,
          maxWidth: "100%",
          // Stretched column child (xs): the nowrap run inside an RTL line
          // lifts the stack's min-content width past the card — pin the
          // cross size and clip (same reasoning as the cancel-reason line).
          width: { xs: "100%", sm: "auto" },
          overflow: "hidden",
        }}
      >
        <ResolvedIcon
          fontSize="small"
          sx={theme => ({ color: theme.palette.success.main, fontSize: 16, flexShrink: 0, alignSelf: "center" })}
        />
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary, flexShrink: 0 })}>
          {t.arbitrationOutcomeLine}
        </Typography>
        <Typography
          data-testid={`session-resolution-outcome-${sessionId}`}
          variant="body2"
          sx={theme => ({
            color: theme.palette.text.secondary,
            fontWeight: 700,
            // Mobile (xs): the emphasized outcome takes its OWN full-width
            // wrap-friendly line (the row wraps; see the stack above) —
            // from sm up the single-line inline run returns.
            whiteSpace: { xs: "normal", sm: "nowrap" },
            flex: { xs: "1 1 100%", sm: "0 0 auto" },
            minWidth: 0,
          })}
        >
          {resolutionOutcomeLabel(outcome, t)}
        </Typography>
        {note !== null ? (
          <Typography
            variant="body2"
            noWrap
            dir="auto"
            sx={theme => ({
              color: theme.palette.text.secondary,
              minWidth: 0,
              // Mobile (xs): the note takes its OWN full-width line below
              // the outcome (the wrap anatomy); from sm up it shares the
              // single line with a living flex ratio.
              flex: { xs: "1 1 100%", sm: "1 1 0" },
              opacity: 0.85,
              // Free-text note inside an RTL row — the unisolated Latin note
              // scrambled its punctuation against the base direction (the
              // round-4 QA finding; same treatment as the dispute reason).
              unicodeBidi: "isolate",
            })}
          >
            {`— ${note}`}
          </Typography>
        ) : null}
        <Typography
          variant="body2"
          noWrap
          dir="ltr"
          title={formatApplicantDate(resolvedAt, locale)}
          sx={theme => ({
            color: theme.palette.text.secondary,
            flexShrink: 0,
            opacity: 0.75,
            // Mobile (xs): the stamp jumps BESIDE the label (line 1's
            // inline end) via the order + auto inline-margin pair — the
            // wrap anatomy's full-width outcome/note lines would otherwise
            // strand it below them (DOM order). From sm up the DOM order
            // (stamp at the row's trailing edge) returns.
            order: { xs: 2, sm: 0 },
            marginInlineStart: { xs: "auto", sm: 0 },
            // ASCII stamp in an isolated LTR box — the ICU `ar` stamp's RLM
            // controls scramble the visible punctuation against the row's
            // RTL base direction (round-1 wallet QA finding, same class).
            unicodeBidi: "isolate",
            fontVariantNumeric: "tabular-nums",
          })}
        >
          {formatLedgerStamp(resolvedAt)}
        </Typography>
      </Stack>
    </Tooltip>
  );
}
