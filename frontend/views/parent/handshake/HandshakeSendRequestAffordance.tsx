"use client";

import { SendOutlined as SendIcon } from "@mui/icons-material";
import { Alert, Button, Snackbar, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { resolveParentLinkDenialCopy } from "@/frontend/lib/parent-link-denials";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * The send-affordance outcome (derived from the mutation result — no stored
 * request state):
 *
 * | kind | Condition | Surface |
 * |---|-----------|---------|
 * | `idle` | no send attempted on this discovered result | the CTA alone |
 * | `in-flight` | the request mutation is running | CTA disabled + loading |
 * | `unavailable` | mutation resolved with `payload === null` (the collapse) | info `Alert` — `sendUnavailableNotice` |
 * | `pending` | mutation resolved with a row | info `Alert` — `requestPendingNotice` + success toast |
 * | `denied` | mutation threw | error `Alert` — shared parent-link denial copy |
 */
export type SendOutcomeState =
  | { readonly kind: "idle" }
  | { readonly kind: "in-flight" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "pending" }
  | { readonly kind: "denied"; readonly code: string | null };

/** Success-toast auto-hide cadence (host toast posture). */
const SEND_TOAST_AUTOHIDE_MS = 6000;

export interface SendRequestAffordanceProps {
  /** The current send-outcome branch (drives the CTA + the outcome alert). */
  readonly outcome: SendOutcomeState;
  /** `parentLink` namespace labels (property access only). */
  readonly labels: ParentLinkLabels;
  /** `errors` namespace labels (denial copy). */
  readonly errorLabels: ErrorsLabels;
  /** Send handler — fires the request mutation with the validated code. */
  readonly onSend: () => void;
  /** Localized success-toast copy (null = hidden). */
  readonly toastCopy: string | null;
  /** Dismisses the success toast. */
  readonly onToastClose: () => void;
}

/**
 * SendRequestAffordance — the send seam on a `linkable: true`
 * discovery result: the ≥44px Send CTA (LoadingButton-style in-flight
 * disable) plus the derived outcome alert —
 *
 *  - `unavailable` (mutation payload `null`, the collapse) → INFO alert
 *    with `sendUnavailableNotice`;
 *  - `pending` (mutation resolved with a row) → INFO alert with
 *    `requestPendingNotice` + the localized success toast;
 *  - `denied` → ERROR alert with the shared parent-link denial copy
 *    (`PARENT_LINK_ALREADY_PENDING` / `PARENT_LINK_TARGET_ALREADY_LINKED`;
 *    anything else falls back to `internalServerError`).
 *
 * The CTA stays rendered after every settled outcome (a second submit is a
 * legitimate probe — the server answers with the constant conflict shape).
 */
export function SendRequestAffordance({
  outcome,
  labels,
  errorLabels,
  onSend,
  toastCopy,
  onToastClose,
}: Readonly<SendRequestAffordanceProps>): ReactNode {
  const inFlight = outcome.kind === "in-flight";

  return (
    <Stack spacing={1.5} sx={{ width: "100%" }} data-testid="parent-link-send-affordance">
      <Button
        type="button"
        variant="contained"
        fullWidth
        disabled={inFlight}
        loading={inFlight}
        startIcon={<SendIcon />}
        onClick={onSend}
        sx={{ ...focusVisibleRingSx, minHeight: 44 }}
      >
        {labels.sendRequestAction}
      </Button>
      {outcome.kind === "unavailable" ? (
        <Alert severity="info" variant="outlined" data-testid="parent-link-send-outcome" sx={{ borderRadius: 2 }}>
          {labels.sendUnavailableNotice}
        </Alert>
      ) : null}
      {outcome.kind === "pending" ? (
        <Alert severity="info" variant="outlined" data-testid="parent-link-send-outcome" sx={{ borderRadius: 2 }}>
          {labels.requestPendingNotice}
        </Alert>
      ) : null}
      {outcome.kind === "denied" ? (
        <Alert severity="error" variant="outlined" data-testid="parent-link-send-outcome" sx={{ borderRadius: 2 }}>
          {resolveParentLinkDenialCopy(outcome.code, errorLabels)}
        </Alert>
      ) : null}
      <Snackbar
        open={toastCopy !== null}
        autoHideDuration={SEND_TOAST_AUTOHIDE_MS}
        onClose={(_, reason) => {
          if (reason !== "clickaway") {
            onToastClose();
          }
        }}
      >
        <Alert
          severity="success"
          variant="outlined"
          data-testid="parent-link-send-success-toast"
          sx={{ borderRadius: 2 }}
        >
          {toastCopy}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
