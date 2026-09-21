import type { ParentSessionTargetQuery_parentSessionTarget } from "@/frontend/graphql/generated/gql/graphql";
import { buildDetailUrl } from "@/frontend/views/parent/monitoring/ParentChildDetailContainer.helpers";

/**
 * Portal-root session deep-link resolution — the pure decision layer of
 * `ParentChildrenRootContainer` (consumed through `useSessionResolution`
 * and the container's auto-select effect).
 *
 * A completion-notification deep link enters the portal as
 * `/parent/children?session=<id>` (the row's session pointer). The root
 * container resolves that pointer through the `parentSessionTarget` read
 * and, on success, replaces the URL with the session's report landing
 * `/parent/children/<studentId>?tab=reports&session=<id>` — composed by
 * the SAME `buildDetailUrl` the detail container uses, so the deep-link
 * landing and the tab switches never drift into parallel URL shapes.
 *
 * Navigation ownership (single-writer rule): while a `?session=` pointer
 * is present and unresolved, the session flow OWNS navigation and the
 * pre-existing first-child auto-select is suppressed — the two effects
 * must never both replace. Ownership releases on resolution failure: the
 * localized unavailability notice renders and the portal falls through to
 * the existing auto-select predicate. The pre-feature shape (no pointer)
 * keeps the original rule byte-for-byte.
 */

/**
 * The resolution flow's phase:
 *  - `idle` — no `?session=` pointer; the pre-feature portal root.
 *  - `pending` — pointer present, resolution in flight; silent, navigation
 *    owned by the session flow.
 *  - `succeeded` — the linked-child pair resolved; the landing replace is
 *    the session flow's single navigation.
 *  - `failed` — malformed pointer, denial, or network failure; the
 *    transient notice renders and navigation ownership releases.
 */
export type SessionResolutionPhase = "idle" | "pending" | "succeeded" | "failed";

/** The resolved pair — the session id echoed back plus the linked child it belongs to. */
export type SessionTarget = ParentSessionTargetQuery_parentSessionTarget;

/**
 * Parses the raw `?session=` value into the session id the resolution read
 * consumes. A pointer is usable only as a positive safe integer — an empty,
 * non-numeric, non-positive, or out-of-range value yields `null`, which the
 * flow treats as an immediate resolution FAILURE (the localized notice +
 * auto-select fallback), never a crash and never a network probe.
 */
export function parseSessionId(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Everything the resolution decision reads — all derived state, no behavior. */
export interface SessionResolutionInputs {
  /** `props.session !== null` — the raw `?session=` prop arrived. */
  readonly sessionPresent: boolean;
  /** `parseSessionId(props.session)` — `null` when absent or malformed. */
  readonly sessionId: number | null;
  /** The resolution read's pair, once it lands (`undefined` while absent). */
  readonly target: SessionTarget | undefined;
  /** The resolution read failed (denial or network — one fallback covers all). */
  readonly targetFailed: boolean;
}

/** The resolution-side decision for one render pass. */
export interface SessionResolutionDecision {
  readonly phase: SessionResolutionPhase;
  /**
   * The resolved pair to land on, non-null ONLY while `succeeded` — the
   * effect writes its landing URL exactly once (gated by
   * `landingReplaceDue`). Null in every other phase: a failure arms no
   * navigation, so the probed id and its (non-)child never surface.
   */
  readonly landingTarget: SessionTarget | null;
  /** Whether the transient localized unavailability notice renders. */
  readonly showUnavailableNotice: boolean;
}

/** Folds the raw inputs into the flow's phase (kept ternary-free). */
function resolvePhase(inputs: SessionResolutionInputs): SessionResolutionPhase {
  if (!inputs.sessionPresent) return "idle";
  // Failure wins any tie with stale data — the fail-closed posture: a
  // denial (or a malformed pointer) always degrades to the fallback, and
  // the resolution read carries no refetch path that could resurrect data
  // beside a later error.
  if (inputs.sessionId === null || inputs.targetFailed) return "failed";
  if (inputs.target !== undefined) return "succeeded";
  return "pending";
}

/**
 * Derives the resolution decision for one render pass: the phase, the
 * landing pair it may navigate with, and whether the notice renders. The
 * auto-select counterpart of the single-writer rule is
 * `autoSelectPermitted` — between the two, a success pass and a pending
 * pass can never release navigation to the list.
 */
export function resolveSessionFlow(inputs: SessionResolutionInputs): SessionResolutionDecision {
  const phase = resolvePhase(inputs);
  return {
    phase,
    landingTarget: inputs.target !== undefined && phase === "succeeded" ? inputs.target : null,
    showUnavailableNotice: phase === "failed",
  };
}

/**
 * The pre-existing first-child auto-select gate, extended by the
 * single-writer rule: it fires only in the phases where navigation
 * ownership has been RELEASED (no pointer, or a pointer that failed to
 * resolve) AND under the original predicate — no explicit `?student=`
 * browsing marker and at least one linked child. While a pointer is
 * pending or has landed, this is false, so the two effects never both
 * replace.
 */
export function autoSelectPermitted(
  phase: SessionResolutionPhase,
  hasStudentParam: boolean,
  childrenReady: boolean
): boolean {
  const navigationReleased = phase === "idle" || phase === "failed";
  return navigationReleased && !hasStudentParam && childrenReady;
}

/**
 * The exactly-once gate for the landing replace: the URL is written the
 * first time a resolved pair appears and never again for the same session
 * id — re-renders and dev-mode effect re-invocations stay
 * navigation-free once the ledger has recorded the id.
 */
export function landingReplaceDue(landingTarget: SessionTarget | null, landingReplacedFor: number | null): boolean {
  return landingTarget !== null && landingReplacedFor !== landingTarget.sessionId;
}

/**
 * The canonical session report landing URL for a resolved pair —
 * `/parent/children/<studentId>?tab=reports&session=<id>` — composed by the
 * detail container's URL builder so the deep-link landing and the tab
 * switches share one URL shape.
 */
export function buildSessionLandingUrl(target: SessionTarget): string {
  return buildDetailUrl(target.studentId, "reports", String(target.sessionId));
}
