/**
 * Subscription-expiry cron entry (`GET /api/cron/expire-subscriptions`).
 *
 * The validity-window expiry sweep as an externally-triggered job endpoint.
 * The full envelope contract — GET-only, timing-safe bearer compare against
 * `CRON_SECRET`, fail-closed bare-404 mode gates, masked success/failure
 * envelopes, locale-free classification — lives in the shared
 * `createCronSweepEndpoint` factory (`backend/lib/gateway/cron-endpoint.ts`),
 * which this surface and its sessions sibling (`sweep-sessions`) both ride
 * so the envelopes cannot drift apart. This file adds ONLY the sweep it
 * triggers and its payload shape:
 *
 *  - success `{ data: { expired, lanesZeroed }, requestId }` — the honest
 *    counts only: zero row identities cross the wire, and the zero-row
 *    idempotent re-sweep returns `{ expired: 0, lanesZeroed: 0 }`
 *    byte-equally;
 *  - a THROWN sweep failure (e.g. an invariant breach rolling the cohort
 *    back) is masked through the shared error envelope.
 *
 * The heavy lifting is `SubscriptionExpiryService.expireDue` — one
 * transaction: the guarded batch flip to `expired` + the conditional
 * per-(owner, lane) zeroings.
 */

import { createCronSweepEndpoint } from "@/backend/lib/gateway/cron-endpoint";
import { SubscriptionExpiryService } from "@/backend/services/billing";

export const GET = createCronSweepEndpoint({
  run: () => SubscriptionExpiryService.expireDue(),
  payload: result => ({ expired: result.expired, lanesZeroed: result.lanesZeroed }),
});
