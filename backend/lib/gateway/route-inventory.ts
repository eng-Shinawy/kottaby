/**
 * Route inventory registry — the SINGLE classifying source for every
 * Next.js API route in the tree.
 *
 * Rules:
 *  - One entry per physical route file anywhere under `app/api/`
 *    (convention: `<segment>/route.ts`); the static completeness assertion
 *    FAILS if any real route file is missing here, so no attack surface can
 *    go unclassified.
 *  - Entries use URL-style paths (`/api/…`) — the same tokens the canonical
 *    doc table prints; file→path mapping lives only in the completeness checker.
 *  - Classifications (closed set):
 *      `gateway`              → GraphQL-over-HTTP engine route; transport-local
 *                                error shapes, NOT the REST envelope (canonical
 *                                exemption row in docs/graphql/error-handling-contract.md §envelopes).
 *      `envelope`             → REST-style route already adopting the
 *                                apiSuccessResponse/apiErrorResponse contract.
 *      `provider-ack-exempt`  → webhook ack surfaces (provider callbacks);
 *                                enveloped replies, with the route-documented
 *                                exemptions registered in
 *                                docs/graphql/error-handling-contract.md.
 *      `deferred`             → exists on disk but envelope adoption is owned by
 *                                a later change.
 *
 * Current ground truth: EIGHT routes exist on disk —
 * `app/api/graphql/route.ts` (gateway), `app/api/set-locale/route.ts`
 * (envelope), `app/api/health/route.ts` (envelope from the start — the
 * GET-only LB liveness probe, second sanctioned health surface; no other
 * method is exported so every other verb rides the framework 405),
 * `app/api/cron/sweep-sessions/route.ts` (envelope — externally triggered
 * sweep job with the bearer gate + bare-404 kill switch documented on the
 * route), `app/api/cron/reconcile-paymob-payments/route.ts` (envelope —
 * the externally triggered pending-payment reconciliation sweep, same
 * bearer gate; its disabled cron mode AND its unconfigured paymob
 * provider both answer a bare 404 documented on the route),
 * `app/api/cron/expire-subscriptions/route.ts` (envelope — the
 * subscription-expiry sweep job, the sessions sweep's fail-closed sibling
 * with the same bearer gate + bare-404 kill switch documented on the route),
 * `app/api/cron/sweep-inactive-teachers/route.ts` (envelope — the
 * externally triggered teacher-inactivity auto-offline sweep job, the
 * sessions sweep's fail-closed sibling with the same bearer gate +
 * bare-404 kill switch documented on the route)
 * and `app/api/payments/webhook/route.ts` (provider-ack-exempt — gateway
 * callback surface whose disabled kill switch and inactive paymob
 * branch both answer a bare 404, registered in the exemptions inventory).
 * `/api/webhooks/*` and `/api/logs` remain PHANTOM routes (dropped pre-seeds)
 * and MUST NOT be listed until their files physically exist.
 */

/** Closed classification vocabulary — never widened without documenting the change. */
export type RouteClassification = "gateway" | "envelope" | "provider-ack-exempt" | "deferred";

/** One classified API route: URL path plus its transport-error posture. */
export interface RouteInventoryEntry {
  /** URL-style path exactly as served (e.g. `/api/graphql`). */
  readonly path: string;
  /** Error-envelope posture of the route (see module docblock). */
  readonly classification: RouteClassification;
}

/**
 * THE registry (frozen). Single source shared by the canonical doc table,
 * the completeness assertion, and reviewer enumerations.
 */
export const ROUTE_INVENTORY: readonly RouteInventoryEntry[] = [
  { path: "/api/graphql", classification: "gateway" },
  { path: "/api/set-locale", classification: "envelope" },
  // GET-only LB probe — uses the shared envelope helpers from its first commit.
  { path: "/api/health", classification: "envelope" },
  // Externally triggered sweep job — bearer-gated REST envelope contract;
  // the disabled mode answers a bare 404 (documented on the route).
  { path: "/api/cron/sweep-sessions", classification: "envelope" },
  // Externally triggered reconciliation sweep job — same bearer-gated REST
  // envelope contract as the sessions sweeper; the disabled cron mode and
  // the unconfigured paymob provider both answer a bare 404 (documented on
  // the route).
  { path: "/api/cron/reconcile-paymob-payments", classification: "envelope" },
  // Externally triggered subscription-expiry sweep job — the sessions
  // sweep's bearer-gated REST envelope sibling; the disabled mode answers
  // a bare 404 (documented on the route).
  { path: "/api/cron/expire-subscriptions", classification: "envelope" },
  // Externally triggered teacher-inactivity auto-offline sweep job — the
  // sessions sweep's bearer-gated REST envelope sibling; the disabled mode
  // answers a bare 404 (documented on the route).
  { path: "/api/cron/sweep-inactive-teachers", classification: "envelope" },
  // Gateway callback ack — enveloped success/failure replies; the disabled
  // kill switch and the inactive paymob-branch mode gate both answer a bare
  // 404 (exemption row in the error-handling contract's exemptions
  // inventory).
  { path: "/api/payments/webhook", classification: "provider-ack-exempt" },
] as const;
