"use client";

/**
 * SubscriptionPlanFactsLine — the row card's plan-snapshot summary line:
 * the composed price display (the exact-decimal wire amount grouped
 * through the shared money formatter + the wire currency code verbatim),
 * the plan's credited session count, and its renewal cycle length — each
 * counted fragment resolved through the namespace's `planFacts` forms so
 * the CLDR counted copy stays single-sourced with the rest of the
 * surface.
 *
 * Presentational: the wire values arrive via the row; the card renders
 * the line as a muted caption between the header and the status row —
 * the admin reads "what this plan grants" before touching lifecycle
 * actions. MUI v9 `sx`-only styling, theme tokens only.
 */
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import {
  planPriceDisplay,
  type SubscriptionRow,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

interface SubscriptionPlanFactsLineProps {
  readonly row: SubscriptionRow;
  /** The counted `planFacts` forms (pre-resolved in the owning card). */
  readonly planFactsLabels: SubscriptionAdminLabels["planFacts"];
}

/** The joiner between the line's value fragments (a caption, not a sentence). */
const FACTS_JOINER = " · ";

export function SubscriptionPlanFactsLine({ row, planFactsLabels }: SubscriptionPlanFactsLineProps): ReactNode {
  // Fragments render as SEPARATE isolated spans inside the flex row instead of
  // one joined string: the price fragment is Latin-heavy while the counted
  // fragments are Arabic, and a single mixed-direction string lets the bidi
  // algorithm interleave the runs (price digits visually colliding with the
  // session count in RTL). Flex rows mirror with the document direction, so
  // the fragment order stays logical in both locales; each fragment is a
  // bidi island (`unicodeBidi: isolate`) so its internal runs never bleed
  // across the joiners.
  const fragments = [
    { key: "price", node: planPriceDisplay(row.plan.price, row.plan.currency), dir: "ltr" as const },
    { key: "sessions", node: planFactsLabels.sessions(row.plan.sessionCount), dir: undefined },
    { key: "cycle", node: planFactsLabels.cycle(row.plan.intervalDays), dir: undefined },
  ];

  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.25, mb: 0.75 }}
      aria-label={fragments.map(f => f.node).join(FACTS_JOINER)}
    >
      {fragments.map((fragment, index) => (
        <Stack key={fragment.key} direction="row" sx={{ alignItems: "center", gap: 0.25 }}>
          {index > 0 && (
            <Typography
              variant="caption"
              component="span"
              aria-hidden
              sx={theme => ({ color: theme.palette.text.secondary })}
            >
              {FACTS_JOINER.trim()}
            </Typography>
          )}
          <Typography
            variant="caption"
            component="span"
            dir={fragment.dir}
            sx={theme => ({
              color: theme.palette.text.secondary,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: 0.1,
              unicodeBidi: "isolate",
            })}
          >
            {fragment.node}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
