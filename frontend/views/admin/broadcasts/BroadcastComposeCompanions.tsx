"use client";

/**
 * BroadcastComposeCompanions — the conditional audience companions. Exactly
 * ONE renders per non-`All` audience kind (fragment + `null` for the `All`
 * default, so nothing companions it): the role select fed by the codegen
 * `UserRole` members (labels from the admin directory's `roleLabels` group),
 * the exact-match country free-text with the ≤100-character helper copy, and
 * the plan select fed by the EXISTING `adminPlansQueryDocument` — Skeletons
 * on an `aria-busy` `output` while the plan options load.
 */

import { FormControl, InputLabel, MenuItem, Select, Skeleton, Stack, TextField, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { type AdminPlansQuery_adminPlans, BroadcastAudienceType } from "@/frontend/graphql/generated/gql/graphql";
import {
  COUNTRY_MAX_LENGTH,
  type ComposeState,
  isUserRoleValue,
  PLAN_SELECT_LABEL_ID,
  ROLE_OPTIONS,
  ROLE_SELECT_LABEL_ID,
  roleOptionLabel,
} from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { MENU_ITEM_SX } from "@/frontend/views/admin/broadcasts/broadcast-compose-skin";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { Common } from "@/shared/locale/namespaces/common";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

interface BroadcastComposeCompanionsProps {
  readonly compose: ComposeState;
  readonly plansLoading: boolean;
  readonly plans: readonly AdminPlansQuery_adminPlans[];
  readonly labels: AdminBroadcastsLabels;
  readonly onDraftChange: (patch: Partial<ComposeState>) => void;
}

export function BroadcastComposeCompanions(props: BroadcastComposeCompanionsProps): ReactNode {
  const tu = useAppTranslation(AdminUsers);
  const tc = useAppTranslation(Common);

  if (props.compose.audienceType === BroadcastAudienceType.Role) {
    return (
      <FormControl fullWidth>
        <InputLabel id={ROLE_SELECT_LABEL_ID}>{props.labels.roleLabel}</InputLabel>
        <Select
          labelId={ROLE_SELECT_LABEL_ID}
          label={props.labels.roleLabel}
          value={props.compose.role ?? ""}
          onChange={event => {
            const nextRole = event.target.value;
            if (isUserRoleValue(nextRole)) {
              props.onDraftChange({ role: nextRole });
            }
          }}
          sx={focusVisibleRingSx}
        >
          {ROLE_OPTIONS.map(option => (
            <MenuItem key={option} value={option} sx={MENU_ITEM_SX}>
              {roleOptionLabel(option, tu.roleLabels)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }
  if (props.compose.audienceType === BroadcastAudienceType.Country) {
    return (
      <TextField
        label={props.labels.countryLabel}
        placeholder={props.labels.countryPlaceholder}
        helperText={props.labels.countryHelperText}
        value={props.compose.country}
        onChange={event => props.onDraftChange({ country: event.target.value })}
        slotProps={{ htmlInput: { dir: "auto", maxLength: COUNTRY_MAX_LENGTH } }}
      />
    );
  }
  if (props.compose.audienceType === BroadcastAudienceType.Plan) {
    if (props.plansLoading) {
      return (
        <Stack component="output" aria-busy sx={{ gap: 1 }}>
          <Skeleton variant="rounded" sx={{ borderRadius: 1, height: 44 }} />
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {props.labels.planLoading}
          </Typography>
          <Skeleton variant="rounded" sx={{ borderRadius: 1, height: 44 }} />
        </Stack>
      );
    }
    return (
      <FormControl fullWidth>
        <InputLabel id={PLAN_SELECT_LABEL_ID}>{props.labels.planLabel}</InputLabel>
        <Select
          labelId={PLAN_SELECT_LABEL_ID}
          label={props.labels.planLabel}
          value={props.compose.planId ?? ""}
          onChange={event => {
            const nextPlanId = event.target.value;
            props.onDraftChange({ planId: nextPlanId === "" ? null : nextPlanId });
          }}
          sx={focusVisibleRingSx}
        >
          {props.plans.length === 0 ? (
            <MenuItem disabled value="" sx={MENU_ITEM_SX}>
              {tc.noResults}
            </MenuItem>
          ) : (
            props.plans.map(plan => (
              <MenuItem key={plan.id} value={plan.id} sx={MENU_ITEM_SX}>
                {plan.title}
              </MenuItem>
            ))
          )}
        </Select>
      </FormControl>
    );
  }
  return null;
}
