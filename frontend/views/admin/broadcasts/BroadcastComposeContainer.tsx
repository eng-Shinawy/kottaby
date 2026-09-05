"use client";

/**
 * BroadcastComposeContainer — root client container for the admin broadcast
 * compose surface (`/admin/broadcasts`).
 *
 * Owns the compose flow end-to-end through the controller hook
 * `useBroadcastCompose` (state bundle `useBroadcastComposeDraft` + send flow
 * `useBroadcastComposeSend` beside this file — the 150-line view-file
 * convention):
 *  - the controlled compose draft (title/body copy + audience selector +
 *    companion values) and the plans query fed by the EXISTING
 *    `adminPlansQueryDocument` (skipped unless the Plan kind is selected);
 *  - `useMutation(adminBroadcastNotificationMutationDocument)` carrying the
 *    compose-session idempotency key via the Apollo context header
 *    `x-idempotency-key` — the key is minted once per compose session and
 *    regenerated ONLY after a successful send (failed submits keep the same
 *    key so the server-side replay dedupe stays effective), and it never
 *    rides the input DTO;
 *  - the confirmation dialog gating the send, the client-side title
 *    validation (`titleRequired` inline copy), VALIDATION field-error
 *    projection through `projectMutationFieldErrors` (never a bespoke
 *    renderer), and the success Snackbar with the pluralized
 *    `successToast(count)` label carrying the server-returned recipient
 *    count, then a draft reset.
 *
 * The presentational pieces live beside this file (`BroadcastComposeHeader`,
 * `BroadcastComposeForm`, `BroadcastComposeFields`,
 * `BroadcastComposeCompanions`, `BroadcastComposeConfirmDialog`,
 * `BroadcastComposeSuccessSnackbar`) with pure plumbing in
 * `broadcast-compose.helpers.ts` and `sx` tokens in
 * `broadcast-compose-skin.ts`. ZERO hardcoded user-facing strings — every
 * label flows from the `AdminBroadcasts` / `Common` namespace handles
 * (role-cohort option labels come from the admin directory's `roleLabels`
 * group, consumed inside `BroadcastComposeCompanions`).
 */

import { SendOutlined } from "@mui/icons-material";
import { Box, CircularProgress, Paper } from "@mui/material";
import type { ReactNode } from "react";
import { BroadcastComposeConfirmDialog } from "@/frontend/views/admin/broadcasts/BroadcastComposeConfirmDialog";
import { BroadcastComposeForm } from "@/frontend/views/admin/broadcasts/BroadcastComposeForm";
import { BroadcastComposeHeader } from "@/frontend/views/admin/broadcasts/BroadcastComposeHeader";
import { BroadcastComposeSuccessSnackbar } from "@/frontend/views/admin/broadcasts/BroadcastComposeSuccessSnackbar";
import { useBroadcastCompose } from "@/frontend/views/admin/broadcasts/useBroadcastCompose";

export function BroadcastComposeContainer(): ReactNode {
  const {
    compose,
    fieldErrors,
    formError,
    sending,
    audienceReady,
    plansLoading,
    plans,
    labels,
    closeLabel,
    confirmOpen,
    successCount,
    successEpoch,
    changeDraft,
    changeAudienceKind,
    handleFormSubmit,
    handleConfirmSend,
    closeConfirmDialog,
    closeSuccessToast,
  } = useBroadcastCompose();

  const sendIcon = sending ? <CircularProgress size={18} color="inherit" /> : <SendOutlined />;

  return (
    <Box
      sx={{
        marginInline: "auto",
        maxWidth: 760,
        width: "100%",
        paddingBlock: { xs: 2, md: 4 },
        paddingInline: { xs: 2, sm: 3 },
        display: "flex",
        flexDirection: "column",
        // Optical vertical centering on tall desktop canvases; the surplus
        // collapses naturally on short viewports and mobile (top-aligned).
        minHeight: { md: "calc(100svh - 170px)" },
        justifyContent: { md: "center" },
      }}
    >
      <Paper
        elevation={0}
        sx={theme => ({
          border: 1,
          borderColor: theme.palette.divider,
          borderRadius: 2,
          padding: { xs: 2.5, sm: 4 },
          bgcolor: theme.palette.background.paper,
        })}
      >
        <BroadcastComposeHeader labels={labels} />
        <BroadcastComposeForm
          compose={compose}
          fieldErrors={fieldErrors}
          formError={formError}
          sending={sending}
          audienceReady={audienceReady}
          plansLoading={plansLoading}
          plans={plans}
          labels={labels}
          sendIcon={sendIcon}
          onDraftChange={changeDraft}
          onAudienceKindChange={changeAudienceKind}
          onSubmit={handleFormSubmit}
        />
      </Paper>
      <BroadcastComposeConfirmDialog
        open={confirmOpen}
        sending={sending}
        sendIcon={sendIcon}
        labels={labels}
        onClose={closeConfirmDialog}
        onConfirm={handleConfirmSend}
      />
      <BroadcastComposeSuccessSnackbar
        key={successEpoch}
        count={successCount}
        labels={labels}
        closeLabel={closeLabel}
        onClose={closeSuccessToast}
      />
    </Box>
  );
}
