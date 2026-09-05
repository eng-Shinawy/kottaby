/**
 * Per-IP handshake token bucket for the notification WebSocket sidecar.
 */

/**
 * Bounded per-IP token bucket for handshake throttling.
 *
 * Capacity-burst + interval-refill semantics; the tracked-IP map itself is
 * bounded with drop-oldest eviction (insertion order), so a hostile source
 * spraying spoofed addresses cannot grow the structure unboundedly.
 */
export class NotificationWsHandshakeThrottle {
  private readonly buckets = new Map<string, { tokens: number; lastRefillMs: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillIntervalMs: number,
    private readonly maxTrackedIps: number
  ) {}

  /** Consumes one token for `ip`; false when the bucket is exhausted. */
  tryAcquire(ip: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(ip);
    if (bucket !== undefined) {
      const refills = Math.floor((now - bucket.lastRefillMs) / this.refillIntervalMs);
      if (refills > 0) {
        bucket.tokens = Math.min(this.capacity, bucket.tokens + refills);
        bucket.lastRefillMs += refills * this.refillIntervalMs;
      }
      if (bucket.tokens <= 0) {
        return false;
      }
      bucket.tokens -= 1;
      return true;
    }
    if (this.buckets.size >= this.maxTrackedIps) {
      const oldestIp = this.buckets.keys().next().value;
      if (typeof oldestIp === "string") {
        this.buckets.delete(oldestIp);
      }
    }
    this.buckets.set(ip, { tokens: this.capacity - 1, lastRefillMs: now });
    return true;
  }
}
