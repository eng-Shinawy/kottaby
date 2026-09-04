"use client";

import { useMutation } from "@apollo/client/react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { respondToParentLinkRequestMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import type { PendingDecision } from "@/frontend/views/students/link-requests/LinkRequestCard";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * The confirm/reject seam handed back to the container: dialog state, the
 * in-flight flag, the denial code, the success-toast copy, and the
 * submit/close handlers.
 */
export interface LinkRequestDecisionController {
  /** The open confirm/reject decision (null = no dialog). */
  readonly decision: PendingDecision | null;
  /** Opens the decision dialog for a row (null closes it). */
  readonly setDecision: Dispatch<SetStateAction<PendingDecision | null>>;
  /** The respond mutation is in flight (row-level + dialog-level disable). */
  readonly inFlight: boolean;
  /** `extensions.code` of the last mutation denial (null = no inline alert). */
  readonly denialCode: string | null;
  /** Localized copy of the success toast (null = hidden). */
  readonly successToast: string | null;
  /** The dialog form submit (React 19 `SubmitEvent` discipline — never `FormEvent`). */
  readonly handleDecisionSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  /** Dismisses the dialog without acting. */
  readonly closeDecision: () => void;
  /** Dismisses the success toast. */
  readonly dismissSuccessToast: () => void;
}

/**
 * useLinkRequestDecision — the confirm/reject mutation seam of the student
 * incoming-link inbox.
 *
 * Owns the decision-dialog state, the row whose respond mutation is in
 * flight (`pendingRequestId` — row-level + dialog-level in-flight disable),
 * the denial-code projection, and the localized success toast. The dialog
 * form submit delegates to `respondToDecision` so rejections are caught in
 * ONE place (the admin-dialogs contract: the mutation error projects into
 * the localized inline Alert, never an unhandled rejection); on success the
 * dialog closes, the localized success toast fires
 * (`confirmSuccessToast`/`rejectSuccessToast`) and the list refetches.
 *
 * The transition is COMMITTED inside the try-block — the mutation
 * write-back already restyled the row. The list refresh runs OUTSIDE the
 * mutation try-block: a refetch failure folds silently instead of being
 * caught by the denial handler, where an unmapped code would surface a
 * misleading "internal server error" alert and suppress the success toast.
 */
export function useLinkRequestDecision(
  refetch: () => Promise<unknown>,
  labels: ParentLinkLabels
): LinkRequestDecisionController {
  const [respond] = useMutation(respondToParentLinkRequestMutationDocument);

  // The row whose respond mutation is in flight (row-level + dialog-level
  // in-flight disable).
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  // The open confirm/reject decision (null = no dialog).
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  // Localized copy of the success toast (null = hidden).
  const [successToast, setSuccessToast] = useState<string | null>(null);
  // `extensions.code` of the last mutation denial (null = no inline alert).
  const [denialCode, setDenialCode] = useState<string | null>(null);

  const inFlight = pendingRequestId !== null;

  const respondToDecision = async (submitted: PendingDecision): Promise<void> => {
    try {
      await respond({ variables: { requestId: submitted.requestId, accept: submitted.accept } });
    } catch (mutationError: unknown) {
      setDecision(null);
      setDenialCode(extractErrorCode(mutationError));
      return;
    } finally {
      setPendingRequestId(null);
    }
    setDecision(null);
    setSuccessToast(submitted.accept ? labels.confirmSuccessToast : labels.rejectSuccessToast);
    await refetch().catch(() => undefined);
  };

  const handleDecisionSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const submitted = decision;
    if (submitted === null || pendingRequestId !== null) {
      return;
    }
    setPendingRequestId(submitted.requestId);
    setDenialCode(null);
    void respondToDecision(submitted);
  };

  const closeDecision = (): void => {
    setDecision(null);
  };

  const dismissSuccessToast = (): void => {
    setSuccessToast(null);
  };

  return {
    decision,
    setDecision,
    inFlight,
    denialCode,
    successToast,
    handleDecisionSubmit,
    closeDecision,
    dismissSuccessToast,
  };
}
