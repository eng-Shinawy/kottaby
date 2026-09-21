"use client";

import { useMutation } from "@apollo/client/react";
import { useCallback, useState } from "react";
import { adminStopBroadcastMutationDocument } from "@/frontend/graphql/sharedDocuments/notifications/broadcast.documents";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { isNotFoundErrorFamily, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import type { BroadcastHistoryNotice } from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { Errors } from "@/shared/locale/namespaces/errors";

/**
 * useStopBroadcast — the one-way lifecycle mutation + toast seam of the
 * broadcast history surface. Confirming the stop dialog fires the
 * `adminStopBroadcast` mutation and converges the read model through
 * Apollo's cache refetch:
 *
 * | Outcome (extensions.code) | Behavior |
 * |---------------------------|----------|
 * | success | the returned retracted count rides the pluralized `stopSuccessToast(count)` success snackbar; `refetchQueries` re-runs BOTH the directory list and the drawer's detail read, so the row's `stopped` chip, the honest total and the live counters converge together |
 * | `BROADCAST_ALREADY_STOPPED` | `errors.broadcastAlreadyStopped` error snackbar (another admin raced the stop); the refetch still fires — the row converges to the truthful stopped state |
 * | not-found family (`BROADCAST_NOT_FOUND`) | `errors.broadcastNotFound` error snackbar; the row is refetched away |
 * | `FORBIDDEN` / anything else | `errors.forbidden` / `errors.validation` / `errors.internalServerError` error snackbar per the canonical taxonomy — never the server `message` |
 *
 * The notice is a transient snackbar slot (the shared `NoticeSnackbar`
 * renders it); the caller owns nothing but rendering + dismissal.
 */

/** The stop flow's surface contract. */
export interface StopBroadcastController {
  /** True while the mutation round-trip is in flight. */
  readonly stopping: boolean;
  /** The transient outcome notice, or `null` while idle (the snackbar closes). */
  readonly notice: BroadcastHistoryNotice | null;
  /** Clears the notice (the snackbar's dismiss/close path). */
  readonly dismissNotice: () => void;
  /** Fires the stop for one broadcast (the stop dialog's confirm affordance). */
  readonly stopBroadcast: (broadcastId: number) => void;
}

/** Owns the stop mutation, its outcome classification and the toast slot. */
export function useStopBroadcast(): StopBroadcastController {
  const t = useAppTranslation(AdminBroadcasts);
  const tErrors = useAppTranslation(Errors);
  const [notice, setNotice] = useState<BroadcastHistoryNotice | null>(null);

  const [stopBroadcastMutation, { loading: stopping }] = useMutation(adminStopBroadcastMutationDocument, {
    refetchQueries: ["AdminBroadcasts", "AdminBroadcastDetail"],
    awaitRefetchQueries: false,
    onError: stopError => {
      const rawCode = extractErrorCode(stopError);
      const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
      if (code === "BROADCAST_ALREADY_STOPPED") {
        setNotice({ message: tErrors.broadcastAlreadyStopped, severity: "error" });
        return;
      }
      if (isNotFoundErrorFamily(code)) {
        setNotice({ message: tErrors.broadcastNotFound, severity: "error" });
        return;
      }
      if (code === "FORBIDDEN") {
        setNotice({ message: tErrors.forbidden, severity: "error" });
        return;
      }
      if (code === "VALIDATION") {
        setNotice({ message: tErrors.validation, severity: "error" });
        return;
      }
      setNotice({ message: tErrors.internalServerError, severity: "error" });
    },
  });

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const stopBroadcast = useCallback(
    (broadcastId: number): void => {
      if (stopping) {
        return;
      }
      void (async (): Promise<void> => {
        try {
          const result = await stopBroadcastMutation({ variables: { broadcastId } });
          const retractedCount = result.data?.adminStopBroadcast;
          // The bare `Int!` payload IS the retracted-recipient count — the
          // only interpolated value the pluralized toast may carry.
          if (typeof retractedCount !== "number") {
            setNotice({ message: tErrors.internalServerError, severity: "error" });
            return;
          }
          setNotice({ message: t.stopSuccessToast(retractedCount), severity: "success" });
        } catch {
          // Apollo routed the failure through `onError` — classified there.
        }
      })();
    },
    [stopping, stopBroadcastMutation, t, tErrors]
  );

  return { stopping, notice, dismissNotice, stopBroadcast };
}
