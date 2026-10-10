/**
 * Pure planning math for the WebSocket stability harness: identity
 * assignment (per-user cap invariant), the token-bucket-honoring ramp
 * schedule, the in-window fan-out burst schedule, guard-valid fan-out
 * envelope construction, and the client-side frame recognition the delivery
 * accounting keys on. Nothing here touches the network, the clock, or the
 * filesystem.
 */

import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NOTIFICATIONS_FANOUT_CHANNEL } from "@/backend/services/notifications/realtime/redis-pubsub-transport";

/**
 * Safety margin added to every post-burst ramp step so the client stays
 * strictly behind the sidecar's handshake token-bucket refill boundary
 * (a handshake racing a refill would be refused with `4429`).
 */
export const LOAD_WS_RAMP_SAFETY_MARGIN_MS = 250;

/** Fan-out delivery-latency budget: p95 strictly below this passes. */
export const FANOUT_P95_GATE_MS = 2000;

/** Planning refusal (empty identity list, cap-math violation). */
export class LoadWsPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadWsPlanError";
  }
}

/**
 * Assigns identities to connections round-robin so no identity ever holds
 * more than ceil(connections / identities) connections — always within the
 * server's per-user cap when the caller's cap math held. An empty identity
 * list or a cap violation is a planning refusal.
 */
export function assignConnectionIdentities(
  connections: number,
  identityEmails: readonly string[],
  perUserCap: number
): string[] {
  if (identityEmails.length === 0) {
    throw new LoadWsPlanError("the identity list is empty — the seed manifest provides the websocket identities");
  }
  if (connections > identityEmails.length * perUserCap) {
    throw new LoadWsPlanError(
      `${connections} connections exceed the per-user cap math ` +
        `(${identityEmails.length} identities x ${perUserCap} each = ${identityEmails.length * perUserCap})`
    );
  }
  const assignment: string[] = [];
  for (let index = 0; index < connections; index += 1) {
    assignment.push(identityEmails[index % identityEmails.length] ?? "");
  }
  return assignment;
}

/**
 * Ramp offsets (ms from ramp start) honoring the handshake token bucket: the
 * first `burst` connections go out immediately, every subsequent connection
 * one refill interval later (plus the safety margin). 100 connections at the
 * default 5/2s ramp complete in ~190s.
 */
export function buildRampSchedule(
  connections: number,
  burst: number,
  intervalMs: number,
  safetyMarginMs: number = LOAD_WS_RAMP_SAFETY_MARGIN_MS
): number[] {
  const offsets: number[] = [];
  for (let index = 0; index < connections; index += 1) {
    if (index < burst) {
      offsets.push(0);
    } else {
      offsets.push((index - burst + 1) * intervalMs + safetyMarginMs);
    }
  }
  return offsets;
}

/**
 * Fan-out burst offsets (ms from window start), evenly spaced inside the
 * stability window with both edges clear: `burstCount` bursts at
 * k * window / (burstCount + 1).
 */
export function buildBurstSchedule(windowDurationMs: number, burstCount: number): number[] {
  if (burstCount <= 0) {
    return [];
  }
  const step = Math.max(1, Math.floor(windowDurationMs / (burstCount + 1)));
  const offsets: number[] = [];
  for (let index = 1; index <= burstCount; index += 1) {
    offsets.push(index * step);
  }
  return offsets;
}

/**
 * Burst payload ids: positive safe integers unique within and across runs
 * (epoch-milliseconds base + burst index; two runs would need to start in
 * the same millisecond to collide).
 */
export function buildBurstIds(baseId: number, burstCount: number): number[] {
  const ids: number[] = [];
  for (let index = 0; index < burstCount; index += 1) {
    ids.push(baseId + index);
  }
  return ids;
}

/** Extracts the notification id from a frame the sidecar egresses (client-side recognition). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFrameNotificationId(value: Record<string, unknown>): number | null {
  const data: unknown = value.data;
  if (!isRecord(data)) {
    return null;
  }
  const id: unknown = data.id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Builds the guard-valid fan-out envelope wire form: the exact JSON the
 * realtime transport publishes on the fixed channel, accepted by the
 * subscriber-side runtime shape guard (`userIds` positive ints, exact key
 * sets, ISO-8601 `createdAt`, a real notification type).
 */
export function buildFanoutWire(userIds: readonly number[], burstId: number, createdAtIso: string): string {
  const recipients = [...userIds];
  const envelope = {
    userIds: recipients,
    payload: {
      v: 1,
      kind: "notification",
      data: {
        id: burstId,
        type: NotificationType.SystemBroadcast,
        title: `perf fan-out burst ${burstId}`,
        body: null,
        relatedEntityType: null,
        relatedEntityId: null,
        createdAt: createdAtIso,
      },
    },
  };
  return JSON.stringify(envelope);
}

/** The fixed pub/sub channel every fan-out envelope travels on (re-exported for the io seam). */
export { NOTIFICATIONS_FANOUT_CHANNEL };

/** A recognized inbound frame carrying a fan-out burst payload. */
export interface DeliveredFrame {
  readonly burstId: number;
}

/**
 * Recognizes an inbound application frame as a fan-out delivery: returns the
 * burst id for any push-shaped frame carrying a positive integer
 * notification id, null for everything else (foreign traffic, malformed
 * JSON, application-shaped noise) — never throws.
 */
export function parseDeliveredFrame(wire: string): DeliveredFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(wire);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (parsed.v !== 1 || parsed.kind !== "notification") {
    return null;
  }
  const burstId = readFrameNotificationId(parsed);
  return burstId === null ? null : { burstId };
}

/** The one-hour soak evidence command operators copy from the report. */
export function buildSoakCommand(durationS: number = 3600): string {
  return `bun run perf:load-ws --duration-s ${durationS}`;
}
