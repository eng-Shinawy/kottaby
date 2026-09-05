"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import {
  cancelParentLinkRequestMutationDocument,
  myOutgoingParentLinkRequestsQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { OutgoingLinkRequestCancelDialog } from "@/frontend/views/parent/handshake/OutgoingLinkRequestCancelDialog";
import {
  OutgoingLinkRequestCard,
  type PendingCancellation,
} from "@/frontend/views/parent/handshake/OutgoingLinkRequestCard";
import {
  OutgoingDenialAlert,
  OutgoingEmptyState,
  OutgoingSettledList,
  OutgoingSuccessToast,
} from "@/frontend/views/parent/handshake/OutgoingSectionStates";
import { OutgoingUnsettledBody } from "@/frontend/views/parent/handshake/OutgoingSectionStates.parts";
import { Common, Errors, ParentLink, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * OutgoingLinkRequestsSection — the "requests you've sent" list of the
 * parent handshake surface.
 *
 * A stateful `useQuery` fetches the caller's OWN outgoing parent-link
 * requests (zero-argument — the parent id is derived server-side from the
 * verified context, identity NEVER crosses the wire; rows carry the MASKED
 * student name (masked-name contract), and a `useMutation(cancelParentLinkRequest)`
 * drives the silent withdrawal (the backend folds the row to `rejected`
 * with ZERO notifications). No `useLazyQuery` anywhere; the mutation→list
 * refresh is the plain `refetch()` (no cache surgery).
 *
 * Outcome state machine (derived per render — no stored list state):
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | query error `UNAUTHORIZED`/`FORBIDDEN` | shared `PermissionDeniedFallback` replaces the section (never bare `null`) |
 * | 2 | rows not settled, retryable query error | shared `RetryableNotice` (retry refetches) |
 * | 3 | rows not settled, any other query error | localized inline `Alert` (`errors.internalServerError`) + retry affordance |
 * | 4 | rows not settled | skeleton region (`component="output"` + `aria-busy`) |
 * | 5 | zero rows | empty state (`outgoingEmptyTitle`/`outgoingEmptyBody`) |
 * | 6 | rows settled | per-row cards in the `component="output"` list region (single column) |
 *
 * Cancel flow: the submitted row's affordance (and the dialog) disable while
 * in flight; on success the dialog closes, the localized success toast fires
 * (`cancelSuccessToast`) and the list refetches — the withdrawn row returns
 * with the `rejected` chip (the withdrawal fold); on denial the dialog
 * closes and `extensions.code` maps to a localized inline `Alert` from the
 * `errors` namespace (shared parent-link denial copy).
 *
 * MUI v9 discipline: `sx`-only styling, colors ONLY through theme palette
 * roles, `focusVisibleRingSx` on interactive elements, logical properties
 * for RTL, `dir="auto"` on names, no `console.*`. Every user-facing string
 * resolves through the compile-time `ParentLink` / `Errors` / `Common`
 * namespace handles (property access only — never call-by-key). The
 * presentational states live in `OutgoingSectionStates.tsx` (+ its
 * `OutgoingSectionStates.parts.tsx` unsettled-branch sibling).
 */

export function OutgoingLinkRequestsSection(): ReactNode {
  const t = useAppTranslation(ParentLink);
  const te = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();

  const { data, error, loading, refetch } = useQuery(myOutgoingParentLinkRequestsQueryDocument);
  const [cancelRequest] = useMutation(cancelParentLinkRequestMutationDocument);

  // The request whose cancel mutation is in flight (row-level + dialog-level
  // in-flight disable).
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  // The open cancel decision (null = no dialog).
  const [cancelDecision, setCancelDecision] = useState<PendingCancellation | null>(null);
  // Localized copy of the success toast (null = hidden).
  const [successToast, setSuccessToast] = useState<string | null>(null);
  // `extensions.code` of the last mutation denial (null = no inline alert).
  const [denialCode, setDenialCode] = useState<string | null>(null);
  // Retry-after-query-error refetch in flight (disables the affordance).
  const [retryPending, setRetryPending] = useState(false);
  // Read purity: ONE `now` captured at mount (lazy initializer — no
  // impure calls during render). The expired verdict stays stable for the
  // mount's lifetime; server-side materialization + refetch settle the
  // authoritative states.
  const [nowMs] = useState(() => Date.now());

  // Denial class — replaces the whole section, mirroring the denial-surface
  // precedent on the student incoming container.
  const queryErrorCode = error === undefined ? null : extractErrorCode(error);
  if (queryErrorCode === "UNAUTHORIZED" || queryErrorCode === "FORBIDDEN") {
    return <PermissionDeniedFallback />;
  }

  const rows = data?.myOutgoingParentLinkRequests;
  const cancelInFlight = cancellingRequestId !== null;

  const handleRetry = (): void => {
    setRetryPending(true);
    void refetch()
      .catch(() => undefined)
      .finally(() => setRetryPending(false));
  };

  /**
   * The dialog form submit (React 19 `SubmitEvent` discipline — never
   * `FormEvent`). The cancel mutation error projects into the localized
   * inline Alert — never an unhandled rejection.
   */
  const handleCancelSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const submitted = cancelDecision;
    if (submitted === null || cancellingRequestId !== null) {
      return;
    }
    setCancellingRequestId(submitted.requestId);
    setDenialCode(null);
    void cancelSubmitted(submitted);
  };

  const cancelSubmitted = async (submitted: PendingCancellation): Promise<void> => {
    try {
      await cancelRequest({ variables: { requestId: submitted.requestId } });
    } catch (mutationError: unknown) {
      setCancelDecision(null);
      setDenialCode(extractErrorCode(mutationError));
      return;
    } finally {
      setCancellingRequestId(null);
    }
    // The withdrawal is COMMITTED above — the fold already restyled the row.
    // The list refresh runs OUTSIDE the mutation try-block (6.3-F2): a
    // refetch failure folds silently instead of being caught by the denial
    // handler, where an unmapped code would surface a misleading "internal
    // server error" alert and suppress the success toast.
    setCancelDecision(null);
    setSuccessToast(t.cancelSuccessToast);
    await refetch().catch(() => undefined);
  };

  // The section body branch (flat if/else chain — no nested ternary,
  // mirroring the student IncomingBody): unsettled states → empty state →
  // the settled `component="output"` list region.
  let sectionBody: ReactNode;
  if (rows === undefined) {
    sectionBody = (
      <OutgoingUnsettledBody
        queryErrorCode={queryErrorCode}
        errorLabels={te}
        retryLabel={commonT.retry}
        onRetry={handleRetry}
        retryPending={retryPending}
      />
    );
  } else if (rows.length === 0) {
    sectionBody = <OutgoingEmptyState labels={t} />;
  } else {
    sectionBody = (
      <OutgoingSettledList
        listLabel={t.outgoingTitle}
        busy={loading || cancelInFlight}
        rowNodes={rows.map(row => (
          <OutgoingLinkRequestCard
            key={row.id}
            row={row}
            labels={t}
            locale={locale}
            nowMs={nowMs}
            cancelInFlight={cancelInFlight}
            onCancel={setCancelDecision}
          />
        ))}
      />
    );
  }

  return (
    <Stack spacing={2} sx={{ width: "100%" }} data-testid="parent-outgoing-section">
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
        {t.outgoingTitle}
      </Typography>

      {denialCode !== null ? <OutgoingDenialAlert denialCode={denialCode} errorLabels={te} /> : null}

      {sectionBody}

      <OutgoingLinkRequestCancelDialog
        requestId={cancelDecision === null ? null : cancelDecision.requestId}
        labels={t}
        commonLabels={commonT}
        pending={cancelInFlight}
        onSubmit={handleCancelSubmit}
        onClose={() => setCancelDecision(null)}
      />

      <OutgoingSuccessToast copy={successToast} onClose={() => setSuccessToast(null)} />
    </Stack>
  );
}
