"use client";

import { FormControl, FormControlLabel, Radio, RadioGroup, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DisputeResolution } from "@/frontend/graphql/generated/gql/graphql";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * ResolveDisputeOptionGroup — the arbitration decision radios of the
 * `ResolveDisputeDialog` (R-104 semantics, localized helper texts; the
 * server behavior per outcome is documented on the dialog). Extracted
 * verbatim from the dialog for the `max-lines-per-function` budget;
 * behavior is unchanged.
 *
 * | Radio          | Server behavior on submit |
 * |----------------|---------------------------|
 * | `Cancel`       | the session is cancelled and any held fee is refunded to its original balance lane (the SAME same-lane primitive `cancelSession` uses, inside the arbitration transaction) |
 * | `Complete`     | the session is completed and its fee hold is consumed — only sessions that actually started can be completed (server `VALIDATION` otherwise) |
 */

interface ResolveDisputeOptionGroupProps {
  /** Chosen resolution — `null` means nothing chosen (arbitration has NO default). */
  readonly value: DisputeResolution | null;
  /** Selection intent — the dialog owns the state; unknown wire strings fall back to Cancel. */
  readonly onChange: (next: DisputeResolution) => void;
  /** Localized sessions-namespace labels (the decision vocabulary). */
  readonly t: SessionsLabels;
}

/** The arbitration decision radios — EXACTLY ONE terminal outcome. */
export function ResolveDisputeOptionGroup({ value, onChange, t }: Readonly<ResolveDisputeOptionGroupProps>): ReactNode {
  return (
    <FormControl component="fieldset">
      {/* The fieldset's accessible name is the dialog's own decision
          vocabulary — the banner in the dialog already explains the
          semantics. */}
      <RadioGroup
        aria-label={t.resolveDisputeTitle}
        value={value ?? ""}
        onChange={event => {
          const wireValue = event.target.value;
          // MUI radios hand back a plain wire string — compare against the
          // enum member's string VALUE (string-vs-string), keeping the
          // whitelist shape: anything unknown falls back to Cancel.
          onChange(
            wireValue === DisputeResolution.Complete.toString() ? DisputeResolution.Complete : DisputeResolution.Cancel
          );
        }}
        sx={{ gap: 1 }}
      >
        <Stack
          sx={theme => ({
            gap: 0.25,
            p: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
          })}
        >
          <FormControlLabel
            value={DisputeResolution.Cancel}
            control={<Radio data-testid="resolve-dispute-radio-cancel" />}
            label={t.resolutionCancelLabel}
            sx={{ "& .MuiFormControlLabel-label": { fontWeight: 600 } }}
          />
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.resolutionCancelHelper}
          </Typography>
        </Stack>
        <Stack
          sx={theme => ({
            gap: 0.25,
            p: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
          })}
        >
          <FormControlLabel
            value={DisputeResolution.Complete}
            control={<Radio data-testid="resolve-dispute-radio-complete" />}
            label={t.resolutionCompleteLabel}
            sx={{ "& .MuiFormControlLabel-label": { fontWeight: 600 } }}
          />
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.resolutionCompleteHelper}
          </Typography>
        </Stack>
      </RadioGroup>
    </FormControl>
  );
}
