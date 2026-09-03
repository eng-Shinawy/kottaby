import { useMutation } from "@apollo/client/react";
import { useRef } from "react";
import { adminBroadcastNotificationMutationDocument } from "@/frontend/graphql/sharedDocuments/notifications/broadcast.documents";
import {
  applyBroadcastFieldErrors,
  buildAudienceInput,
  randomUUID,
  trimmedOrNullable,
} from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import type { BroadcastComposeDraft } from "@/frontend/views/admin/broadcasts/useBroadcastComposeDraft";

/**
 * useBroadcastComposeSend — the send flow behind the confirmation dialog,
 * extracted from `BroadcastComposeContainer` (150-line view-file convention).
 *
 * Owns the `useMutation(adminBroadcastNotificationMutationDocument)` wiring
 * carrying the compose-session idempotency key via the Apollo context header
 * `x-idempotency-key` — the key is minted once per compose session and
 * regenerated ONLY after a successful send (failed submits keep the same key
 * so the server-side replay dedupe stays effective), and it never rides the
 * input DTO — plus the outcome transitions: success closes the dialog,
 * raises the pluralized-toast state (count + remount epoch) and resets the
 * draft; the VALIDATION field-error projection flows through the shared
 * `mutationFieldErrors` seam (never a bespoke renderer), and broadcast
 * domain rejections fall through to the global fallback copy.
 */

/** The send flow's surface consumed by the compose controller. */
export interface BroadcastComposeSend {
  readonly sending: boolean;
  readonly handleConfirmSend: () => void;
}

export function useBroadcastComposeSend(draft: BroadcastComposeDraft, errorTitle: string): BroadcastComposeSend {
  const composeKeyRef = useRef(randomUUID());
  const [broadcastMutation, { loading: sending }] = useMutation(adminBroadcastNotificationMutationDocument);

  const send = async (): Promise<void> => {
    draft.setFormError(null);
    try {
      const result = await broadcastMutation({
        variables: {
          input: {
            title: draft.compose.title.trim(),
            body: trimmedOrNullable(draft.compose.body),
            audience: buildAudienceInput(draft.compose),
          },
        },
        context: { headers: { "x-idempotency-key": composeKeyRef.current } },
      });
      const deliveredCount = result.data?.adminBroadcastNotification;
      if (typeof deliveredCount !== "number") {
        draft.setConfirmOpen(false);
        draft.setFormError(errorTitle);
        return;
      }
      draft.setConfirmOpen(false);
      draft.setSuccessCount(deliveredCount);
      draft.setSuccessEpoch(epoch => epoch + 1);
      draft.resetDraft();
      // Rotation happens ONLY on success — failed submits keep the same
      // compose-session key so the server-side replay dedupe stays effective.
      composeKeyRef.current = randomUUID();
    } catch (mutationError: unknown) {
      draft.setConfirmOpen(false);
      // Server tier first: per-field mapping applies only when a VALIDATION
      // error carries a `fields[]` projection (whitelisted paths, first-wins);
      // broadcast domain rejections — localized codes without a fields
      // payload — fall through to the global fallback copy.
      if (!applyBroadcastFieldErrors(mutationError, draft.setFieldErrors)) {
        draft.setFormError(errorTitle);
      }
    }
  };

  /** Dialog confirmation — the only path that fires the mutation. */
  const handleConfirmSend = (): void => {
    if (sending) {
      return;
    }
    void send();
  };

  return { sending, handleConfirmSend };
}
