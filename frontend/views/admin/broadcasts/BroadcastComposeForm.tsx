"use client";

/**
 * BroadcastComposeForm — the compose form element.
 *
 * Composition layer between the stateful container and the presentational
 * pieces: the title/body/audience fields (`BroadcastComposeFields`), the
 * conditional audience companions (`BroadcastComposeCompanions`), the
 * no-count-preview disclaimer, the inline server-failure alert, and the
 * ≥44px submit affordance (disabled while sending or while the selected
 * audience kind's companion is incomplete). Purely controlled — every edit
 * flows up through the change callbacks; submission flows up through
 * `onSubmit`.
 */

import { Alert, Box, Button, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode, SubmitEvent } from "react";
import type { AdminPlansQuery_adminPlans, BroadcastAudienceType } from "@/frontend/graphql/generated/gql/graphql";
import { BroadcastComposeCompanions } from "@/frontend/views/admin/broadcasts/BroadcastComposeCompanions";
import { BroadcastComposeFields } from "@/frontend/views/admin/broadcasts/BroadcastComposeFields";
import type { ComposeFieldErrors, ComposeState } from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { ACTION_BUTTON_SX } from "@/frontend/views/admin/broadcasts/broadcast-compose-skin";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

interface BroadcastComposeFormProps {
  readonly compose: ComposeState;
  readonly fieldErrors: ComposeFieldErrors;
  readonly formError: string | null;
  readonly sending: boolean;
  readonly audienceReady: boolean;
  readonly plansLoading: boolean;
  readonly plans: readonly AdminPlansQuery_adminPlans[];
  readonly labels: AdminBroadcastsLabels;
  readonly sendIcon: ReactNode;
  readonly onDraftChange: (patch: Partial<ComposeState>) => void;
  readonly onAudienceKindChange: (kind: BroadcastAudienceType) => void;
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}

export function BroadcastComposeForm(props: BroadcastComposeFormProps): ReactNode {
  return (
    <Box component="form" noValidate aria-busy={props.sending} onSubmit={props.onSubmit}>
      <Stack sx={{ gap: 3 }}>
        <BroadcastComposeFields
          compose={props.compose}
          fieldErrors={props.fieldErrors}
          labels={props.labels}
          onDraftChange={props.onDraftChange}
          onAudienceKindChange={props.onAudienceKindChange}
        />
        <BroadcastComposeCompanions
          compose={props.compose}
          plansLoading={props.plansLoading}
          plans={props.plans}
          labels={props.labels}
          onDraftChange={props.onDraftChange}
        />
      </Stack>
      {props.formError !== null ? (
        <Alert severity="error" sx={{ marginBlockStart: 2 }}>
          {props.formError}
        </Alert>
      ) : null}
      {/* Form footer: the no-preview disclaimer and the submit affordance share
          one anchored row from sm up (disclaimer inline-start, action
          inline-end); they stack with a full-width touch target on mobile. */}
      <Divider sx={{ marginBlockStart: 3, marginBlockEnd: 2.5 }} />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 2, sm: 3 }}
        sx={{ alignItems: { sm: "center" }, justifyContent: { sm: "space-between" } }}
      >
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 460 })}>
          {props.labels.previewDisclaimer}
        </Typography>
        <Button
          type="submit"
          variant="contained"
          disabled={props.sending || !props.audienceReady}
          startIcon={props.sendIcon}
          sx={[ACTION_BUTTON_SX, { width: { xs: "100%", sm: "auto" }, flexShrink: 0, whiteSpace: "nowrap" }]}
        >
          {props.sending ? props.labels.sendingAction : props.labels.sendAction}
        </Button>
      </Stack>
    </Box>
  );
}
