"use client";

import { useQuery } from "@apollo/client/react";
import { Alert, Box } from "@mui/material";
import { type ReactNode, useState } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { myIncomingParentLinkRequestsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { resolveParentLinkDenialCopy } from "@/frontend/lib/parent-link-denials";
import { IncomingBody } from "@/frontend/views/students/link-requests/IncomingBody";
import { IncomingHeader, SuccessToast } from "@/frontend/views/students/link-requests/IncomingStates";
import { LinkRequestDecisionDialog } from "@/frontend/views/students/link-requests/LinkRequestDecisionDialog";
import { useLinkRequestDecision } from "@/frontend/views/students/link-requests/useLinkRequestDecision";
import { Common, Errors, ParentLink, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * StudentLinkRequestsContainer — the client heart of
 * `/student/link-requests`.
 *
 * A stateful `useQuery` fetches the caller's OWN incoming parent-link
 * requests (zero-argument — the student id is derived server-side from the
 * verified context, identity NEVER crosses the wire), and a
 * `useMutation(respondToParentLinkRequest)` drives the Confirm/Reject
 * transitions. No `useLazyQuery` anywhere; the mutation→list refresh is the
 * plain `refetch()` (no cache surgery).
 *
 * Outcome state machine (derived per render — no stored list state):
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | query error `UNAUTHORIZED`/`FORBIDDEN` | shared `PermissionDeniedFallback` replaces the container (never bare `null`) |
 * | 2 | rows not settled, retryable query error | shared `RetryableNotice` (retry refetches) |
 * | 3 | rows not settled, any other query error | localized inline `Alert` (`errors.internalServerError`), retry affordance |
 * | 4 | rows not settled | skeleton region (`component="output"` + `aria-busy`) |
 * | 5 | zero rows | empty state (`incomingEmptyTitle`/`incomingEmptyBody`) |
 * | 6 | rows settled | per-row cards in the `component="output"` list region (`IncomingBody`) |
 *
 * Row rendering lives in `LinkRequestCard` (computed status chip,
 * `dir="auto"` name, ≥44px CTAs with the in-flight disable); the
 * confirm/reject gate in `LinkRequestDecisionDialog` (function-slot copy);
 * the shell states + list branches in `IncomingStates` / `IncomingBody`; the
 * confirm/reject mutation flow (decision state, in-flight disable, denial
 * projection, success toast) in `useLinkRequestDecision`.
 *
 * Mutation flow: the submitted row's affordances (and the dialog) disable
 * while in flight; on success the dialog closes, the localized success
 * toast fires (`confirmSuccessToast`/`rejectSuccessToast`) and the list
 * refetches; on denial the dialog closes and `extensions.code` maps to a
 * localized inline `Alert` from the `errors` namespace
 * (`PARENT_LINK_REQUEST_EXPIRED` / `PARENT_LINK_REQUEST_ALREADY_RESOLVED` /
 * `PARENT_LINK_REQUEST_NOT_FOUND`; anything else falls back to
 * `internalServerError`).
 *
 * MUI v9 discipline: `sx`-only styling, colors ONLY through theme palette
 * roles, `*Outlined` icons, `focusVisibleRingSx` on interactive elements,
 * logical properties for RTL, `dir="auto"` on names, no `console.*`. Every
 * user-facing string resolves through the compile-time `ParentLink` /
 * `Errors` / `Common` namespace handles (property access only — never
 * call-by-key, never `next-intl`).
 */

/**
 * Denial-code → copy resolution is SHARED across the parent-link surfaces
 * (`resolveParentLinkDenialCopy`) — the send affordance and the outgoing
 * section on the parent side map the SAME wire codes to the SAME localized
 * copy (constant-shape denial discipline).
 */

export function StudentLinkRequestsContainer(): ReactNode {
  const t = useAppTranslation(ParentLink);
  const te = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();

  const { data, error, loading, refetch } = useQuery(myIncomingParentLinkRequestsQueryDocument);
  // Retry-after-query-error refetch in flight (disables the affordance).
  const [retryPending, setRetryPending] = useState(false);
  // Read purity: ONE `now` captured at mount (lazy initializer — no
  // impure calls during render). The expired verdict stays stable for the
  // mount's lifetime; server-side materialization + refetch settle the
  // authoritative states.
  const [nowMs] = useState(() => Date.now());

  const {
    decision,
    setDecision,
    inFlight,
    denialCode,
    successToast,
    handleDecisionSubmit,
    closeDecision,
    dismissSuccessToast,
  } = useLinkRequestDecision(refetch, t);

  // Denial class — replaces the whole container, mirroring the
  // denial-surface precedent on the parent handshake discovery container.
  const queryErrorCode = error === undefined ? null : extractErrorCode(error);
  if (queryErrorCode === "UNAUTHORIZED" || queryErrorCode === "FORBIDDEN") {
    return <PermissionDeniedFallback />;
  }

  const rows = data?.myIncomingParentLinkRequests;

  const handleRetry = (): void => {
    setRetryPending(true);
    void refetch()
      .catch(() => undefined)
      .finally(() => {
        setRetryPending(false);
      });
  };

  return (
    // Content column is width-capped and centered: at tablet/desktop the
    // sparse request inbox previously stretched full-width, reading as dead
    // space under a single card (visual QA deduction @768/1440). From `sm`
    // up the column fills the content area's height and the settled body
    // centers itself in the space UNDER the page header (`my: auto`) — the
    // title stays anchored to the app bar like every dashboard page, while
    // the remaining whitespace splits evenly around the composition instead
    // of pooling at the bottom. The column is a gap-based flex Box
    // (not a margin-spacing Stack) so `my: auto` isn't fought by the
    // child-spacing margins, and `display: none` summary/hint children on
    // xs generate no boxes (CSS gap ignores them) — the 375 layout stays
    // pixel-identical to its 10/10 capture.
    <Box
      sx={{
        width: "100%",
        maxWidth: 880,
        mx: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minHeight: { sm: "calc(100dvh - 113px)", md: "calc(100dvh - 129px)" }, // AppBar 65 + Container py (sm 2×24 / md 2×32)
      }}
    >
      <IncomingHeader labels={t} />

      {denialCode !== null ? (
        <Alert
          severity="error"
          variant="outlined"
          data-testid="student-link-requests-denial-alert"
          sx={{ borderRadius: 2 }}
        >
          {resolveParentLinkDenialCopy(denialCode, te)}
        </Alert>
      ) : null}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, my: { sm: "auto" } }}>
        <IncomingBody
          rows={rows}
          queryErrorCode={queryErrorCode}
          loading={loading}
          locale={locale}
          nowMs={nowMs}
          respondInFlight={inFlight}
          retryPending={retryPending}
          labels={t}
          errorLabels={te}
          commonLabels={commonT}
          onRetry={handleRetry}
          onDecide={setDecision}
        />
      </Box>

      <LinkRequestDecisionDialog
        decision={decision}
        labels={t}
        commonLabels={commonT}
        pending={inFlight}
        onSubmit={handleDecisionSubmit}
        onClose={closeDecision}
      />

      <SuccessToast copy={successToast} onClose={dismissSuccessToast} />
    </Box>
  );
}
