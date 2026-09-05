"use client";

/**
 * BroadcastComposeFields — the title/body copy pair and the audience-kind
 * radio group. The title/body inputs carry `dir="auto"` (admin-authored copy
 * is stored verbatim in any script) with the title ceiling shared with the
 * server's validation bound; the radio group maps the four codegen
 * `BroadcastAudienceType` members onto the `audience*` labels. Renders as a
 * fragment so the enclosing form's spacing rhythm owns the gaps.
 */

import { FormControl, FormControlLabel, FormHelperText, FormLabel, Radio, RadioGroup, TextField } from "@mui/material";
import type { ReactNode } from "react";
import type { BroadcastAudienceType } from "@/frontend/graphql/generated/gql/graphql";
import {
  AUDIENCE_KINDS,
  audienceKindLabel,
  type ComposeFieldErrors,
  type ComposeState,
  isAudienceKind,
  TITLE_MAX_LENGTH,
} from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { AUDIENCE_ROW_SX, RADIO_SX } from "@/frontend/views/admin/broadcasts/broadcast-compose-skin";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

/** Stable id linking the audience error text to the radio group (WCAG 3.3.1). */
const AUDIENCE_ERROR_ID = "broadcast-audience-error";

interface BroadcastComposeFieldsProps {
  readonly compose: ComposeState;
  readonly fieldErrors: ComposeFieldErrors;
  readonly labels: AdminBroadcastsLabels;
  readonly onDraftChange: (patch: Partial<ComposeState>) => void;
  readonly onAudienceKindChange: (kind: BroadcastAudienceType) => void;
}

export function BroadcastComposeFields(props: BroadcastComposeFieldsProps): ReactNode {
  return (
    <>
      <TextField
        label={props.labels.titleLabel}
        placeholder={props.labels.titlePlaceholder}
        value={props.compose.title}
        onChange={event => props.onDraftChange({ title: event.target.value })}
        error={props.fieldErrors.title !== undefined}
        helperText={props.fieldErrors.title}
        slotProps={{ htmlInput: { dir: "auto", maxLength: TITLE_MAX_LENGTH } }}
      />
      <TextField
        label={props.labels.bodyLabel}
        placeholder={props.labels.bodyPlaceholder}
        value={props.compose.body}
        onChange={event => props.onDraftChange({ body: event.target.value })}
        multiline
        minRows={4}
        slotProps={{ htmlInput: { dir: "auto" } }}
      />
      <FormControl error={props.fieldErrors.audience !== undefined}>
        <FormLabel>{props.labels.audienceLabel}</FormLabel>
        <RadioGroup
          aria-label={props.labels.audienceLabel}
          aria-describedby={props.fieldErrors.audience !== undefined ? AUDIENCE_ERROR_ID : undefined}
          value={props.compose.audienceType}
          onChange={event => {
            const nextKind = event.target.value;
            if (isAudienceKind(nextKind)) {
              props.onAudienceKindChange(nextKind);
            }
          }}
        >
          {AUDIENCE_KINDS.map(kind => (
            <FormControlLabel
              key={kind}
              value={kind}
              control={<Radio sx={RADIO_SX} />}
              label={audienceKindLabel(kind, props.labels)}
              sx={AUDIENCE_ROW_SX}
            />
          ))}
        </RadioGroup>
        {props.fieldErrors.audience !== undefined ? (
          <FormHelperText id={AUDIENCE_ERROR_ID}>{props.fieldErrors.audience}</FormHelperText>
        ) : null}
      </FormControl>
    </>
  );
}
