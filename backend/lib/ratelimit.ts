/**
 * Rate-limit helper — in-memory sliding-window implementation.
 *
 * Provides per-identifier rate limiting using an in-memory Map of request
 * timestamps. Designed for the portal read-query hardening (prevents
 * brute-force child-id enumeration) and the public GraphQL endpoint.
 *
 * Contract:
 *  - `checkRateLimit(identifier, limiter)` — returns `{ success, … }`
 *    based on a sliding window of request timestamps. Fail-open on
 *    transient errors (mirrors the login cold-start resilience pattern).
 *  - `getClientIdentifier(request)` — extracts the client IP from
 *    `x-forwarded-for` (or falls back to a constant for local dev).
 *  - `graphqlRateLimiter` — config for the public GraphQL endpoint.
 *  - `portalReadLimiter` — config for parent portal read queries.
 *
 * Memory model: a Map<string, number[]> where the array holds request
 * timestamps within the current window. Entries are pruned on each check
 * and on periodic cleanup. The Map is bounded to `MAX_TRACKED_IDENTIFIERS`
 * entries (LRU eviction when exceeded) to prevent unbounded growth.
 */
import type { NextRequest } from "next/server";

export interface RateLimiterConfig {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
}

export const graphqlRateLimiter: RateLimiterConfig = {
  name: "graphql-public",
  limit: 100,
  windowMs: 60_000,
};

/** Limiter for parent portal read queries — tighter window to cap probing. */
export const portalReadLimiter: RateLimiterConfig = {
  name: "portal-read",
  limit: 30,
  windowMs: 60_000,
};

/** Maximum number of tracked identifiers to prevent unbounded Map growth. */
const MAX_TRACKED_IDENTIFIERS = 10_000;

interface WindowEntry {
  readonly timestamps: number[];
  lastAccessed: number;
}

const windows = new Map<string, WindowEntry>();

function pruneWindow(timestamps: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter(ts => ts > cutoff);
}

function evictStaleEntries(): void {
  if (windows.size <= MAX_TRACKED_IDENTIFIERS) {
    return;
  }
  const entries = [...windows.entries()].toSorted((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  const toEvict = Math.min(windows.size - Math.floor(MAX_TRACKED_IDENTIFIERS * 0.8), entries.length);
  for (let i = 0; i < toEvict; i++) {
    windows.delete(entries[i][0]);
  }
}

export function getClientIdentifier(request: NextRequest | Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0]?.trim() ?? "local";
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "local";
}

/**
 * Checks the rate limit for the given identifier + limiter config.
 *
 * Uses an in-memory sliding window: keeps timestamps of requests within
 * the window, rejects when count exceeds `limit`. Fail-open on errors
 * (a transient Map/alloc failure must NOT block a legitimate request).
 */
export async function checkRateLimit(identifier: string, limiter: RateLimiterConfig): Promise<RateLimitResult> {
  const now = Date.now();
  try {
    const key = `${limiter.name}:${identifier}`;
    const entry = windows.get(key);
    if (entry === undefined) {
      const timestamps = [now];
      windows.set(key, { timestamps, lastAccessed: now });
      evictStaleEntries();
      return { success: true, limit: limiter.limit, remaining: limiter.limit - 1, reset: now + limiter.windowMs };
    }
    const pruned = pruneWindow(entry.timestamps, now, limiter.windowMs);
    if (pruned.length >= limiter.limit) {
      entry.lastAccessed = now;
      return {
        success: false,
        limit: limiter.limit,
        remaining: 0,
        reset: pruned[0] !== undefined ? pruned[0] + limiter.windowMs : now + limiter.windowMs,
      };
    }
    pruned.push(now);
    entry.lastAccessed = now;
    windows.set(key, { timestamps: pruned, lastAccessed: now });
    return {
      success: true,
      limit: limiter.limit,
      remaining: limiter.limit - pruned.length,
      reset: now + limiter.windowMs,
    };
  } catch {
    return { success: true, limit: limiter.limit, remaining: limiter.limit, reset: now + limiter.windowMs };
  }
}

/** Test helper — clears the in-memory windows (for isolated test runs). */
export function clearRateLimitStore(): void {
  windows.clear();
}
