import { useQuery } from "@apollo/client/react";
import type { SubmitEvent } from "react";
import { type AdminPlansQuery_adminPlans, BroadcastAudienceType } from "@/frontend/graphql/generated/gql/graphql";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments/billing";
import { isAudienceReady } from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import {
  type BroadcastComposeDraft,
  useBroadcastComposeDraft,
} from "@/frontend/views/admin/broadcasts/useBroadcastComposeDraft";
import { useBroadcastComposeSend } from "@/frontend/views/admin/broadcasts/useBroadcastComposeSend";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { Common } from "@/shared/locale/namespaces/common";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

/**
 * useBroadcastCompose — the compose controller behind
 * `BroadcastComposeContainer` (150-line view-file convention).
 *
 * Composes the state bundle (`useBroadcastComposeDraft`) and the send flow
 * (`useBroadcastComposeSend`) with the query/validation layer:
 *  - the plans query fed by the EXISTING `adminPlansQueryDocument` (skipped
 *    unless the Plan kind is selected);
 *  - the client-side title validation (`titleRequired` inline copy) gating
 *    the confirmation dialog.
 *
 * ZERO hardcoded user-facing strings — every label flows from the
 * `AdminBroadcasts` / `Common` namespace handles.
 */

/** The compose surface's full controller contract (render + flows). */
export interface BroadcastComposeController {
  readonly compose: BroadcastComposeDraft["compose"];
  readonly fieldErrors: BroadcastComposeDraft["fieldErrors"];
  readonly formError: BroadcastComposeDraft["formError"];
  readonly confirmOpen: BroadcastComposeDraft["confirmOpen"];
  readonly successCount: BroadcastComposeDraft["successCount"];
  readonly successEpoch: BroadcastComposeDraft["successEpoch"];
  readonly sending: boolean;
  readonly audienceReady: boolean;
  readonly plansLoading: boolean;
  readonly plans: readonly AdminPlansQuery_adminPlans[];
  readonly labels: AdminBroadcastsLabels;
  readonly closeLabel: string;
  readonly changeDraft: BroadcastComposeDraft["changeDraft"];
  readonly changeAudienceKind: BroadcastComposeDraft["changeAudienceKind"];
  readonly handleFormSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  readonly handleConfirmSend: () => void;
  readonly closeConfirmDialog: () => void;
  readonly closeSuccessToast: () => void;
}

export function useBroadcastCompose(): BroadcastComposeController {
  const draft = useBroadcastComposeDraft();
  const t = useAppTranslation(AdminBroadcasts);
  const tc = useAppTranslation(Common);
  const { sending, handleConfirmSend } = useBroadcastComposeSend(draft, t.errorTitle);

  const plansQuery = useQuery(adminPlansQueryDocument, {
    variables: { includeInactive: false },
    skip: draft.compose.audienceType !== BroadcastAudienceType.Plan,
  });

  const audienceReady = isAudienceReady(draft.compose);

  /** Client-side inline validation; the confirmation gate opens when valid. */
  const handleFormSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const titleError = draft.compose.title.trim() === "" ? t.titleRequired : undefined;
    draft.setFieldErrors(titleError === undefined ? {} : { title: titleError });
    if (sending || !audienceReady || titleError !== undefined) {
      return;
    }
    draft.setConfirmOpen(true);
  };

  return {
    compose: draft.compose,
    fieldErrors: draft.fieldErrors,
    formError: draft.formError,
    confirmOpen: draft.confirmOpen,
    successCount: draft.successCount,
    successEpoch: draft.successEpoch,
    sending,
    audienceReady,
    plansLoading: plansQuery.loading,
    plans: plansQuery.data?.adminPlans ?? [],
    labels: t,
    closeLabel: tc.close,
    changeDraft: draft.changeDraft,
    changeAudienceKind: draft.changeAudienceKind,
    handleFormSubmit,
    handleConfirmSend,
    closeConfirmDialog: () => draft.setConfirmOpen(false),
    closeSuccessToast: () => draft.setSuccessCount(null),
  };
}
