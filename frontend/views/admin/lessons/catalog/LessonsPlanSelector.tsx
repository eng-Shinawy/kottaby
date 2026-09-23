/**
 * LessonsPlanSelector — Plan selector feeding the admin lessons catalog.
 *
 * Lessons-specific sibling of the plans-admin catalog helpers: a MUI select
 * over the admin plans list, defaulting its display to the localized
 * placeholder while nothing is selectable.
 */

"use client";

import { MenuItem, TextField } from "@mui/material";
import type { AdminPlansQuery } from "@/frontend/graphql/generated/gql/graphql";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

type PlanOption = AdminPlansQuery["adminPlans"][number];

export interface LessonsPlanSelectorProps {
  readonly plans: readonly PlanOption[];
  readonly loading: boolean;
  readonly value: string;
  readonly onChange: (planId: string) => void;
}

export function LessonsPlanSelector({ plans, loading, value, onChange }: LessonsPlanSelectorProps): React.ReactElement {
  const t = useAppTranslation(Lessons);

  return (
    <TextField
      select
      label={t.planSelectorLabel}
      value={value}
      onChange={event => onChange(event.target.value)}
      disabled={loading || plans.length === 0}
      fullWidth
      sx={{ mb: 3 }}
      slotProps={{
        select: {
          displayEmpty: true,
          renderValue: (option: unknown) =>
            option === ""
              ? t.planSelectorPlaceholder
              : (plans.find(plan => plan.id === option)?.title ?? String(option)),
        },
      }}
    >
      {plans.map(plan => (
        <MenuItem key={plan.id} value={plan.id}>
          {plan.title}
        </MenuItem>
      ))}
    </TextField>
  );
}
