/**
 * Teacher-inactivity cron entry (`GET /api/cron/sweep-inactive-teachers`).
 *
 * The B.15 15-minute inactivity auto-offline sweep as an
 * externally-triggered job endpoint, following the documented cron rules
 * (arming + kill switch per `docs/billing/subscription-validity-window-expiry.md`,
 * which this route makes concrete for the teacher-presence surface). The full
 * envelope contract — GET-only, timing-safe bearer compare against
 * `CRON_SECRET`, fail-closed bare-404 mode gates, masked success/failure
 * envelopes, locale-free classification — lives in the shared
 * `createCronSweepEndpoint` factory (`backend/lib/gateway/cron-endpoint.ts`),
 * which this surface and its sessions/subscription siblings
 * (`sweep-sessions`, `expire-subscriptions`) all ride so the envelopes
 * cannot drift apart. This file adds ONLY the sweep it triggers and its
 * payload shape:
 *
 *  - success `{ data: { offlined }, requestId }` — the honest count only:
 *    zero row identities cross the wire, and the zero-row idempotent
 *    re-sweep returns `{ offlined: 0 }` byte-equally;
 *  - a THROWN sweep failure (e.g. an invariant breach rolling the pass
 *    back) is masked through the shared error envelope.
 *
 * The heavy lifting is `TeacherInactivityService.sweepInactiveTeachers` —
 * one transaction: one captured now, the staleness cutoff derived from the
 * `TEACHER_INACTIVITY_TIMEOUT_MINUTES` snapshot knob (default 15), and the
 * guarded batch flip of every online teacher whose recorded activity is
 * strictly older than the cutoff — or absent — and who holds no started
 * session. The scheduler is EXTERNAL by doctrine: ops arms the surface via
 * `CRON_EXECUTION_MODE=external` + `CRON_EXTERNAL_ENABLED=true` and fires
 * GET with `Authorization: Bearer ${CRON_SECRET}` at a ≤5-minute cadence.
 */

import { createCronSweepEndpoint } from "@/backend/lib/gateway/cron-endpoint";
import { TeacherInactivityService } from "@/backend/services/teachers/teacher-inactivity.service";

export const GET = createCronSweepEndpoint({
  run: () => TeacherInactivityService.sweepInactiveTeachers(),
  payload: result => ({ offlined: result.offlined }),
});
