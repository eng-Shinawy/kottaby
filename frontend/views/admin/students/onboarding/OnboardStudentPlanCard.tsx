"use client";

/**
 * OnboardStudentPlanCard — one selectable catalog card of the onboarding
 * plan picker: title, counted facts (sessions · renewal cycle · balance
 * lane) and the price line. The picked card carries the selected fill and
 * a check glyph; the constant 2px border keeps selection reflow-free.
 */

import { CheckCircleOutlined as CheckIcon } from "@mui/icons-material";
import { Card, CardActionArea, Chip, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { type PlanCatalogQuery_planCatalog, SubscriptionCreditLane } from "@/frontend/graphql/generated/gql/graphql";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** Narrow label-key slice of the balance-lane vocabulary. */
type PlanLaneLabelKey = keyof StudentOnboardingLabels["planSection"]["lane"];

/**
 * Lane value → label key. Plain string tokens (no enum comparisons) —
 * a lane-less plan resolves no key and renders without the lane segment.
 */
const LANE_KEY_BY_VALUE: Record<string, PlanLaneLabelKey> = {
  [SubscriptionCreditLane.Hifz]: "hifz",
  [SubscriptionCreditLane.Tajweed]: "tajweed",
  [SubscriptionCreditLane.Reviews]: "reviews",
};

/** Shared styling of the counted-fact chips — primary-outlined on the muted action fill. */
const FACT_CHIP_SX: SxProps<Theme> = theme => ({
  bgcolor: theme.palette.action.selected,
  borderColor: theme.palette.primary.main,
  color: theme.palette.primary.main,
});

export interface OnboardStudentPlanCardProps {
  readonly plan: PlanCatalogQuery_planCatalog;
  readonly selected: boolean;
  readonly submitting: boolean;
  readonly onSelect: () => void;
}

export function OnboardStudentPlanCard({
  plan,
  selected,
  submitting,
  onSelect,
}: OnboardStudentPlanCardProps): ReactNode {
  const t = useAppTranslation(StudentOnboarding);
  const laneKey = LANE_KEY_BY_VALUE[plan.balanceLane ?? ""];
  return (
    <Card
      variant="outlined"
      sx={theme => ({
        // Constant 2px border — only the COLOR flips with selection (no reflow).
        border: `2px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
        transition: theme.transitions.create("box-shadow"),
        "&:hover": { boxShadow: theme.shadows[4] },
      })}
    >
      <CardActionArea
        aria-pressed={selected}
        disabled={submitting}
        onClick={onSelect}
        sx={theme => ({
          p: 2,
          // Keyboard parity for the hover elevation — the ring rides the card's border token.
          "&.Mui-focusVisible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
          backgroundColor: selected ? theme.palette.primaryContainer : undefined,
          color: selected ? theme.palette.onPrimaryContainer : undefined,
        })}
      >
        <Stack sx={{ gap: 1 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {plan.title}
            </Typography>
            {selected ? (
              // Decorative — `aria-pressed` already announces the state.
              <CheckIcon aria-hidden sx={{ marginInlineStart: "auto", fontSize: 20 }} />
            ) : null}
          </Stack>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
            {[t.planSection.sessions(plan.sessionCount), t.planSection.intervalDays(plan.intervalDays)].map(
              factLabel => (
                <Chip key={factLabel} size="small" variant="outlined" label={factLabel} sx={FACT_CHIP_SX} />
              )
            )}
            {laneKey ? (
              <Typography
                variant="caption"
                sx={theme => ({
                  color: selected ? theme.palette.onPrimaryContainer : theme.palette.text.secondary,
                })}
              >
                {t.planSection.lane[laneKey]}
              </Typography>
            ) : null}
          </Stack>
          <Typography
            variant="body2"
            sx={theme => ({
              color: selected ? theme.palette.onPrimaryContainer : theme.palette.text.primary,
            })}
          >
            {plan.price} {plan.currency}
          </Typography>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
