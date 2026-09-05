import { type Dispatch, type SetStateAction, useState } from "react";
import type { BroadcastAudienceType } from "@/frontend/graphql/generated/gql/graphql";
import {
  type ComposeFieldErrors,
  type ComposeState,
  initialComposeState,
} from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";

/**
 * useBroadcastComposeDraft — the compose surface's state bundle, extracted
 * from `BroadcastComposeContainer` (150-line view-file convention).
 *
 * Owns every piece of compose state:
 *  - the controlled draft (title/body copy + audience kind + companions);
 *  - the per-field inline errors and the global form error;
 *  - the confirmation-dialog gate and the success-toast state (recipient
 *    count + remount epoch).
 *
 * The send orchestration (mutation + idempotency key + outcome transitions)
 * stays in `useBroadcastComposeSend`; the raw setters are therefore part of
 * this bundle's contract — the hook layer is the only consumer.
 */

/** The compose state bundle, plus the setters the flow hooks orchestrate. */
export interface BroadcastComposeDraft {
  readonly compose: ComposeState;
  readonly fieldErrors: ComposeFieldErrors;
  readonly formError: string | null;
  readonly confirmOpen: boolean;
  readonly successCount: number | null;
  readonly successEpoch: number;
  readonly changeDraft: (patch: Partial<ComposeState>) => void;
  readonly changeAudienceKind: (kind: BroadcastAudienceType) => void;
  readonly resetDraft: () => void;
  readonly setFieldErrors: Dispatch<SetStateAction<ComposeFieldErrors>>;
  readonly setFormError: Dispatch<SetStateAction<string | null>>;
  readonly setConfirmOpen: Dispatch<SetStateAction<boolean>>;
  readonly setSuccessCount: Dispatch<SetStateAction<number | null>>;
  readonly setSuccessEpoch: Dispatch<SetStateAction<number>>;
}

export function useBroadcastComposeDraft(): BroadcastComposeDraft {
  const [compose, setCompose] = useState<ComposeState>(initialComposeState);
  const [fieldErrors, setFieldErrors] = useState<ComposeFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  // Bumped per accepted send so each toast remounts with a FRESH auto-hide
  // timer (a reused Snackbar inherits the previous toast's remaining time).
  const [successEpoch, setSuccessEpoch] = useState(0);

  const changeDraft = (patch: Partial<ComposeState>): void => setCompose(current => ({ ...current, ...patch }));

  const changeAudienceKind = (kind: BroadcastAudienceType): void => {
    // Switching the audience kind keeps the authored copy (title/body) and
    // resets only the kind-specific companions — the copy fields render
    // above the selector, so a full reset would silently destroy them.
    setCompose(current => ({
      ...current,
      audienceType: kind,
      role: null,
      country: "",
      planId: null,
    }));
    setFieldErrors({});
  };

  const resetDraft = (): void => setCompose(initialComposeState);

  return {
    compose,
    fieldErrors,
    formError,
    confirmOpen,
    successCount,
    successEpoch,
    changeDraft,
    changeAudienceKind,
    resetDraft,
    setFieldErrors,
    setFormError,
    setConfirmOpen,
    setSuccessCount,
    setSuccessEpoch,
  };
}
