/**
 * SpiedFanoutTransport — in-process fan-out transport spy for journey suites.
 *
 * Journey tests must never deliver realtime side effects over real channels
 * (no Redis pub/sub, no WebSocket frames): the publish boundary is SPIED, not
 * sent. This helper is installed wherever the engine under test accepts an
 * injected fan-out transport; every `publishFanout` call is recorded (frozen
 * `userIds` + `payload`) instead of being delivered, and the recorded log is
 * replayed for assertions — both THAT a publish happened and exactly WHICH
 * recipient ids it targeted (a publish addressed to the wrong actor is
 * precisely the bug class journeys exist to catch).
 *
 * `FanoutTransportLike` mirrors the fan-out transport port contract
 * structurally (the single `publishFanout` method). Wherever the engine's port
 * interface is declared, this spy satisfies it without modification — extra
 * inspection members are additive and never break structural assignability.
 */
import type { RealtimeNotificationPayload } from "@/backend/types";

/**
 * Structural mirror of the fan-out transport port: publish one realtime
 * notification payload to a batch of recipient user ids.
 */
export interface FanoutTransportLike {
  publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void>;
}

/** One recorded `publishFanout` invocation, frozen at publish time. */
export interface FanoutPublishCall {
  /** Recipient user ids exactly as handed to `publishFanout` (frozen copy). */
  readonly userIds: readonly number[];
  /** The realtime payload exactly as handed to `publishFanout`. */
  readonly payload: RealtimeNotificationPayload;
}

/**
 * Fan-out transport spy with an assertion-facing publish log.
 *
 * Typical usage inside a journey file:
 *
 * ```ts
 * const transportSpy = new SpiedFanoutTransport();
 * // … construct the engine with `transportSpy` as its injected transport …
 * await engine.emitForUser(input, "en");
 * expect(transportSpy.publishCount).toBe(1);
 * expect(transportSpy.calls[0]?.userIds).toEqual([teacherActor.userId]);
 * ```
 */
export class SpiedFanoutTransport implements FanoutTransportLike {
  private log: FanoutPublishCall[] = [];

  /**
   * Records the publish instead of delivering it. The recorded entry is
   * frozen (and its `userIds` array is a frozen copy), so later test code
   * cannot accidentally rewrite history.
   */
  async publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void> {
    this.log.push(
      Object.freeze({
        userIds: Object.freeze([...userIds]),
        payload,
      })
    );
  }

  /** Snapshot of the publish log, in publish order (frozen shallow copy). */
  get calls(): readonly FanoutPublishCall[] {
    return Object.freeze([...this.log]);
  }

  /** Number of publishes recorded so far. */
  get publishCount(): number {
    return this.log.length;
  }

  /** Most recent publish, or `null` when nothing has been published yet. */
  get lastCall(): FanoutPublishCall | null {
    return this.log.at(-1) ?? null;
  }

  /**
   * Every recipient id ever published to, in publish order (with repeats —
   * duplicate publishes must stay observable). Empty while nothing was
   * published, so "zero pushes" assertions read as `toHaveLength(0)`.
   */
  get publishedUserIds(): readonly number[] {
    return this.log.flatMap(call => call.userIds);
  }

  /** Empties the publish log — used between journey steps to re-arm the spy. */
  clear(): void {
    this.log = [];
  }
}
