"use client";

import { useMutation } from "@apollo/client/react";
import { useState } from "react";
import { adminSessionJoinMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { classifyMutationFailure } from "@/frontend/views/admin/session-governance/useAdminSessionGovernanceActions";
import { AdminSessionGovernance, Errors, useAppTranslation } from "@/shared/locale";

/**
 * useAdminSessionGovernanceJoin — the join-observation mutation of the
 * admin session-governance container, fired from the detail
 * drawer's banner (`JoinObservationAction`): `adminJoinSession` with the
 * drawer's session id.
 *
 * Outcome arms — EVERY outcome surfaces a notice through the container's
 * shared snackbar slot: success keeps the drawer open while the banner
 * leaves, keyed off the MUTATION's returned session id (the payload of
 * THIS call), never the drawer state (the drawer may already render a
 * DIFFERENT row by the time a slow response settles); any failure —
 * including the raced-transition codes — is dialog-less and only surfaces
 * the localized error notice, so the drawer and banner stay mounted for a
 * retry. Codes classify through the shared `extractErrorCode` +
 * `normalizeGraphQLErrorCode` path — the server `message` is NEVER echoed.
 */

interface UseAdminSessionGovernanceJoinArgs {
  /**
   * The container's shared notice slot (the governance-namespace join arm
   * sets it WITHOUT closing any dialog — the join is dialog-less).
   */
  readonly onNotice: (message: string, severity: "success" | "error") => void;
}

/**
 * Owns the `adminJoinSession` mutation + the joined-session marker of the
 * drawer's observation banner. Returns plain state + the trigger — no JSX.
 */
export function useAdminSessionGovernanceJoin({ onNotice }: Readonly<UseAdminSessionGovernanceJoinArgs>) {
  const t = useAppTranslation(AdminSessionGovernance);
  const te = useAppTranslation(Errors);
  const [joinedSessionId, setJoinedSessionId] = useState<string | null>(null);

  const [commitJoin, joinMutation] = useMutation(adminSessionJoinMutationDocument, {
    onCompleted: joinPayload => {
      // Observation continues — the drawer stays open, the banner leaves.
      // Keyed off the MUTATION's returned session id (the payload of THIS
      // call — renamed from the outer-scope-shadowing `data`), never the
      // drawer state: the drawer may already render a DIFFERENT row by the
      // time a slow response settles.
      onNotice(t.joinSuccess, "success");
      setJoinedSessionId(joinPayload.adminJoinSession.id);
    },
    onError: mutationError => {
      // The join has no dialog of its own — even a raced transition keeps
      // the drawer as-is and surfaces only the notice.
      onNotice(classifyMutationFailure(mutationError, t, te).message, "error");
    },
  });

  return { joinedSessionId, joinLoading: joinMutation.loading, commitJoin };
}
