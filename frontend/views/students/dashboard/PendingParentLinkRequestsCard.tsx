"use client";

import { useQuery } from "@apollo/client/react";
import { PendingActionsOutlined as PendingActionsIcon, RefreshOutlined as RefreshIcon } from "@mui/icons-material";
import { Alert, Button, Chip, Skeleton, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { myIncomingParentLinkRequestsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { STUDENT_LINK_REQUESTS_ROUTE } from "@/frontend/lib/notification-route-resolution";
import { resolveParentLinkDenialCopyOrNull } from "@/frontend/lib/parent-link-denials";
import { isLinkRequestActionable } from "@/frontend/lib/parent-link-request-status";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";
import { deriveActionableIncoming } from "@/frontend/views/students/dashboard/pending-parent-link-requests";
import { isolateBidi } from "@/shared/lib/isolate-bidi";
import { Common, Errors, ParentLink, useAppTranslation } from "@/shared/locale";

/** Review-CTA metrics — comfortable ≥44px touch target, full-width on mobile. */
const reviewCtaSx = { ...focusVisibleRingSx, minHeight: 44, px: 3, width: { xs: "100%", sm: "auto" } } as const;

/**
 * `setTimeout` delay ceiling — runtimes clamp longer delays and fire them
 * immediately, so a far-future expiry timer must stay below 2^31−1 ms. An
 * early fire is harmless: the actionable verdict is unchanged until the TRUE
 * expiry instant, and the timer simply reschedules.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Retry affordance metrics — same ≥44px discipline inside the error shell. */
const retryButtonSx = { ...focusVisibleRingSx, minHeight: 44 } as const;

/**
 * PendingParentLinkRequestsCard — the student dashboard's discoverability
 * card for incoming parent-link requests. Mounted in the
 * `RoleDashboardPage` student status slot next to `HandshakeCodeCard`.
 *
 * Self-contained client component: NO props, NO client-side role logic — the
 * page-level server guards remain the ONLY authorization boundary and the
 * zero-argument `myIncomingParentLinkRequests` query answers identity
 * server-side. The SAME id-first list document as the decision page
 (`StudentLinkRequestsContainer`) — one query, no count endpoint, no bespoke
 * invalidation bus: the Apollo normalized cache is the single truth, so the
 * decision page's respond write-back re-renders this card to zero.
 *
 * Derivation: `deriveActionableIncoming` (pure; the card owns `nowMs` as a
 * wall-clock external store — see the `useSyncExternalStore` wiring below —
 * which advances on TWO events — a self-rescheduling timer when the nearest
 * actionable row's `expiresAt` passes (a request expiring while the
 * dashboard stays mounted drops out WITHOUT a refetch), and every row
 * arrival (the snapshot re-reads `Date.now()`, so a request that expired
 * while the query was in flight cannot survive the settled verdict)) reuses
 * the shared computed-status machinery verbatim — a stored `pending` row
 * past its expiry is NOT counted.
 *
 * Render branches:
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | query in flight | Skeleton card (`aria-busy` + `role="status"` labelled `dashboardCardLoading`) mirroring the settled geometry (zero layout-shift target) |
 * | 2 | any query error | ONE localized inline `Alert` (mapped denial codes via `resolveParentLinkDenialCopyOrNull`; UNMAPPED/internal classes fold onto `dashboardCardLoadError` — raw server messages NEVER reach the DOM) + retry via `refetch` |
 * | 3 | zero actionable rows | `null` — the card renders NOTHING (no empty-state chrome on the dashboard) |
 * | 4 | N ≥ 1 actionable | title + count chip + MOST RECENT requester line (bidi-isolated) + review CTA to the shared decision route |
 *
 * The N>1 state deliberately renders NO per-request list — the dashboard card
 * is a discoverability affordance only; the decision route owns the queue.
 *
 * MUI v9 discipline: `sx`-only styling (no direct style props), colors
 * exclusively through `theme.palette.*` tokens, `*Outlined` icons only,
 * logical properties only (RTL via the emotion-cache stylis-plugin-rtl
 * pipeline), and every user-facing string resolved through compile-time i18n
 * handles (`useAppTranslation(ParentLink)` property access — NEVER `t('key')`;
 * retry copy from the `Common` handle; mapped failure copy from the `Errors`
 * handle; unmapped failure copy from `dashboardCardLoadError`.
 */
/**
 * useWallClockStore — the card's `nowMs` as a wall-clock EXTERNAL STORE
 * (`useSyncExternalStore`, the same primitive as the applicant queue's
 * `useMountedClockTick`): the wall clock is not derivable from props/state
 * and is unreadable during render (react/purity), while a synchronous
 * setState on row arrival cascades renders (react/set-state-in-effect).
 * The external-store contract resolves both: the snapshot is a ref-cached
 * `Date.now()` read (stable between notifications — the contract that keeps
 * React from looping), `refreshClock` re-reads the clock and notifies, and
 * the server snapshot is "never" so SSR/hydration stay deterministic (the
 * zero-argument query never runs server-side, so clock-gated UI never owns
 * a server frame).
 */
function useWallClockStore(): { nowMs: number; refreshClock: () => void } {
  const clockMsRef = useRef<number | null>(null);
  const notifyClockRef = useRef<(() => void) | null>(null);
  const refreshClock = useCallback(() => {
    clockMsRef.current = Date.now();
    notifyClockRef.current?.();
  }, []);
  const subscribeClock = useCallback((onStoreChange: () => void) => {
    notifyClockRef.current = onStoreChange;
    return () => {
      notifyClockRef.current = null;
    };
  }, []);
  const nowMs = useSyncExternalStore(
    subscribeClock,
    () => {
      // Lazy one-shot cache — getSnapshot may be consulted several times per
      // render and must return the same value within a pass.
      clockMsRef.current ??= Date.now();
      return clockMsRef.current;
    },
    () => Number.POSITIVE_INFINITY
  );
  return { nowMs, refreshClock };
}

export function PendingParentLinkRequestsCard(): ReactNode {
  const t = useAppTranslation(ParentLink);
  const te = useAppTranslation(Errors);
  const tc = useAppTranslation(Common);
  const { data, error, loading, refetch } = useQuery(myIncomingParentLinkRequestsQueryDocument);
  const { nowMs, refreshClock } = useWallClockStore();

  // Clock refresh on row arrival: liveness verdicts must read the wall
  // clock as of the LATEST rows, not the mount instant — a request that
  // expired while the query was in flight would otherwise flash the review
  // CTA until the overdue expiry timer fires, and background-tab timer
  // throttling can defer that tick for minutes. Re-reading the snapshot and
  // notifying on every rows change makes the first settled verdict correct
  // by construction (the retry-refetch and decision write-back paths ride
  // the same effect).
  useEffect(() => {
    if (data?.myIncomingParentLinkRequests === undefined) {
      return undefined;
    }
    refreshClock();
    return undefined;
  }, [data?.myIncomingParentLinkRequests, refreshClock]);

  // The next instant at which the actionable verdict can CHANGE: the
  // earliest future `expiresAt` among rows the shared liveness predicate
  // (`isLinkRequestActionable`) still counts. Terminal rows never cross it
  // (their verdict is expiry-independent), and re-firing on an irrelevant
  // boundary merely re-derives the SAME summary — harmless. `null` when no
  // actionable row has a future expiry (no timer needed).
  let nearestActionableExpiryMs: number | null = null;
  for (const row of data?.myIncomingParentLinkRequests ?? []) {
    if (!isLinkRequestActionable(row.status, row.expiresAt, nowMs)) {
      continue;
    }
    const expiryMs = new Date(row.expiresAt).getTime();
    if (nearestActionableExpiryMs === null || expiryMs < nearestActionableExpiryMs) {
      nearestActionableExpiryMs = expiryMs;
    }
  }

  // Expiry clock: when the nearest actionable expiry instant passes, re-read
  // the wall clock through the store (the expired row drops out — zero
  // server writes, the materialization stays server-side). Re-derivation on
  // every data change re-schedules automatically (the effect re-runs
  // whenever the nearest boundary or the clock moves).
  useEffect(() => {
    if (nearestActionableExpiryMs === null) {
      return undefined;
    }
    const delayMs = Math.min(nearestActionableExpiryMs - nowMs, MAX_TIMER_DELAY_MS);
    const timerId = setTimeout(refreshClock, delayMs);
    return () => {
      clearTimeout(timerId);
    };
  }, [nearestActionableExpiryMs, nowMs, refreshClock]);

  const handleRetry = () => {
    void refetch().catch(() => undefined);
  };

  // Branch 1 — in flight: skeleton placeholder announces busy semantics.
  if (loading) {
    return (
      <CardShell testId="pending-parent-link-requests-card-loading" busy busyLabel={t.dashboardCardLoading}>
        <Skeleton variant="text" sx={{ fontSize: "1.75rem", maxWidth: 260 }} />
        <Skeleton variant="rounded" sx={{ height: 28, width: 220, borderRadius: 1 }} />
        <Skeleton variant="rectangular" sx={{ height: 44, width: 180, borderRadius: 2 }} />
      </CardShell>
    );
  }

  // Branch 2 — settled failure: ONE localized inline Alert + retry refetch.
  // Mapped denial codes keep their `errors`-namespace copy; every UNMAPPED
  // code (or absent code chain) folds onto the card's own generic failure
  // line — raw server messages never reach the DOM for masked classes.
  if (error) {
    return (
      <CardShell testId="pending-parent-link-requests-card-error">
        <Stack spacing={2}>
          <Alert severity="error" variant="outlined">
            {resolveParentLinkDenialCopyOrNull(extractErrorCode(error), te) ?? t.dashboardCardLoadError}
          </Alert>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleRetry} sx={retryButtonSx}>
            {tc.retry}
          </Button>
        </Stack>
      </CardShell>
    );
  }

  // Branch 3 — settled, zero actionable: render NOTHING (discoverability
  // chrome disappears the moment the queue converges).
  const summary =
    data?.myIncomingParentLinkRequests === undefined
      ? null
      : deriveActionableIncoming(data.myIncomingParentLinkRequests, nowMs);
  if (summary === null) {
    return null;
  }

  // Branch 4 — N ≥ 1: title + count chip + most-recent requester + review CTA.
  return (
    <CardShell testId="pending-parent-link-requests-card">
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <PendingActionsIcon fontSize="small" sx={theme => ({ color: theme.palette.warning.main })} />
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          {t.dashboardCardTitle}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Chip label={t.dashboardCardCount(summary.count)} size="small" color="warning" variant="outlined" />
        {/* The name is isolateBidi-assembled BEFORE interpolation;
            `dir="auto"` adds first-strong isolation where the
            line abuts the card chrome. */}
        <Typography variant="body2" dir="auto" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.dashboardCardLatestRequester(isolateBidi(summary.latestParentFullName))}
        </Typography>
      </Stack>
      <Button variant="contained" href={STUDENT_LINK_REQUESTS_ROUTE} sx={reviewCtaSx}>
        {t.dashboardCardCta}
      </Button>
    </CardShell>
  );
}
