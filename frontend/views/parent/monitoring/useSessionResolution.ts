"use client";

import { useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { parentSessionTargetQueryDocument } from "@/frontend/graphql/sharedDocuments";
import {
  buildSessionLandingUrl,
  landingReplaceDue,
  parseSessionId,
  resolveSessionFlow,
  type SessionResolutionDecision,
} from "@/frontend/views/parent/monitoring/ParentChildrenRootContainer.helpers";

/**
 * `useSessionResolution` — the portal root's completion-notification
 * deep-link resolution. Reads the raw `?session=` pointer from the route
 * shell's prop, resolves it through the `parentSessionTarget` read, and
 * performs the flow's single navigation: one `router.replace` to the
 * resolved child's report landing, written exactly once per resolved
 * pointer (the ref ledger records the id, so re-renders and dev-mode
 * effect re-invocations cannot re-fire it).
 *
 * The read is skipped entirely while no pointer is present — the
 * pre-feature root fires zero extra network operations — and while the
 * pointer is unusable (an empty / non-numeric / non-positive value takes
 * the failure path without ever reaching the wire). A denial and a
 * network failure share the same fallback decision, so no failure cause
 * is distinguishable client-side.
 *
 * While the pointer is pending or has landed, navigation is OWNED here:
 * the caller's first-child auto-select must stay suppressed
 * (`autoSelectPermitted`) until this flow either lands or releases on
 * failure. The resolution itself stays silent — no loading surface, the
 * portal root keeps rendering its own state underneath.
 */
export function useSessionResolution(session: string | null): SessionResolutionDecision {
  const router = useRouter();

  const sessionId = session === null ? null : parseSessionId(session);
  const { data: targetData, error: targetError } = useQuery(parentSessionTargetQueryDocument, {
    variables: { sessionId: sessionId ?? 0 },
    skip: sessionId === null,
  });

  // The exactly-once ledger for the landing replace: the session id whose
  // landing URL has already been written.
  const landingReplacedForRef = useRef<number | null>(null);

  const flow = resolveSessionFlow({
    sessionPresent: session !== null,
    sessionId,
    target: targetData?.parentSessionTarget,
    targetFailed: targetError !== undefined,
  });
  const landingTarget = flow.landingTarget;

  useEffect(() => {
    if (landingTarget === null) return;
    if (!landingReplaceDue(landingTarget, landingReplacedForRef.current)) return;
    landingReplacedForRef.current = landingTarget.sessionId;
    router.replace(buildSessionLandingUrl(landingTarget));
  }, [landingTarget, router]);

  return flow;
}
