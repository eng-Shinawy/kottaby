/**
 * Scripted in-memory SET-NX-EX claim cache — the journey suites' shared
 * stand-in for the engine's injected idempotency-claim port, passed to
 * service calls through the injection seam's `cache` slot:
 *
 *  - `claim(key, ttlSeconds)` mirrors atomic SET NX EX — `true` when this
 *    caller won the claim, `false` when the key is already held;
 *  - `store(key, value, ttlSeconds)` mirrors SET-with-TTL — the engine
 *    attaches the delivery receipt after the insert commits;
 *  - `get(key)` mirrors GET — the prior receipt for an already-claimed key.
 *
 * TTL is honored via wall-clock expiry; no Redis is ever touched (journey
 * suites never dial a real cache server — the in-process double is injected
 * wherever the engine accepts an injected claim cache).
 */
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";

/** One claim-cache entry: the claimed/stored value plus its wall-clock expiry. */
interface ClaimEntry {
  readonly expiresAt: number;
  readonly value: string;
}

export class InMemoryClaimCache implements NotificationIdempotencyClaimCache {
  private readonly entries = new Map<string, ClaimEntry>();

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return false; // already claimed — duplicate emission
    }
    this.entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value: "" });
    return true; // claim won — proceed with the write
  }

  async store(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry.value;
  }
}
