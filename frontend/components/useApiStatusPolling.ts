"use client";

import { useEffect, useState } from "react";

/**
 * useApiStatusPolling — fixed-cadence re-poll of the unauthenticated LB probe
 * (`GET /api/health`, envelope `{ data: { status, version, ... }, requestId }`)
 * for the ApiStatusIndicator footer chip.
 *
 * Behaviour contract:
 *  - Relative fetch ONLY (`"/api/health"`) — same-origin, never absolute.
 *  - Fixed-cadence re-poll (default 60s) with light exponential backoff while
 *    degraded (2×→4×, capped); polling PAUSES while `document.hidden` via
 *    `visibilitychange` and resumes immediately on return.
 *  - Every teardown path clears the timer + aborts the in-flight request +
 *    removes the listener; guarded `setState` means no leaks and no
 *    state-update-after-unmount. All failures resolve to a degraded state —
 *    nothing ever escapes to an error boundary.
 */

const DEFAULT_POLL_INTERVAL_MS = 60_000;
/** Backoff ladder depth while degraded: 1× → 2× → 4× (capped) of the base cadence. */
const MAX_BACKOFF_STEPS = 2;
const MAX_BACKOFF_MULTIPLIER = 4;

export type ApiStatusKind = "checking" | "operational" | "offline";

export interface ApiStatusState {
  readonly kind: ApiStatusKind;
  readonly version: string | null;
  readonly requestId: string | null;
}

const INITIAL_STATE: ApiStatusState = { kind: "checking", version: null, requestId: null };

/** Read one non-empty string slot off an unknown object — assertion-free narrowing. */
function readStringSlot(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null || !(key in source)) return null;
  const slot: unknown = Reflect.get(source, key);
  return typeof slot === "string" && slot.length > 0 ? slot : null;
}

/** Read one object slot off an unknown object (the health envelope's `data`). */
function readObjectSlot(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null || !(key in source)) return null;
  const slot: unknown = Reflect.get(source, key);
  return typeof slot === "object" && slot !== null ? slot : null;
}

/** Poll `/api/health` on `pollIntervalMs`, returning the latest probe state. */
export function useApiStatusPolling(pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS): ApiStatusState {
  const [status, setStatus] = useState<ApiStatusState>(INITIAL_STATE);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    const controller = new AbortController();

    const runPoll = async (cadenceMs: number): Promise<void> => {
      timer = null;
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        // Malformed bodies degrade instead of throwing out of the effect.
        const payload: unknown = await response.json().catch(() => null);
        const data = readObjectSlot(payload, "data");
        const operational = response.ok && readStringSlot(data, "status") === "ok";
        if (!disposed) {
          setStatus(
            operational
              ? {
                  kind: "operational",
                  version: readStringSlot(data, "version"),
                  requestId: readStringSlot(payload, "requestId"),
                }
              : { kind: "offline", version: null, requestId: null }
          );
        }
        consecutiveFailures = operational ? 0 : consecutiveFailures + 1;
      } catch {
        // Network/DNS failure or our own teardown abort — degraded, never thrown.
        consecutiveFailures += 1;
        if (!disposed) setStatus({ kind: "offline", version: null, requestId: null });
      }
      // Re-arm from HERE (not a `finally`) so no control flow leaves the block.
      // Hidden tabs stay silent entirely; the visibilitychange handler below
      // issues an immediate poll the moment the page becomes visible again.
      if (disposed || document.hidden || timer !== null) return;
      // Light backoff while degraded: 1× → 2× → 4× (capped) of the base cadence.
      const backoffFactor =
        consecutiveFailures === 0
          ? 1
          : Math.min(2 ** Math.min(consecutiveFailures - 1, MAX_BACKOFF_STEPS), MAX_BACKOFF_MULTIPLIER);
      timer = setTimeout(() => void runPoll(cadenceMs), cadenceMs * backoffFactor);
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        return;
      }
      if (!disposed && timer === null) timer = setTimeout(() => void runPoll(pollIntervalMs), 0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void runPoll(pollIntervalMs);

    return () => {
      disposed = true;
      controller.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer !== null) clearTimeout(timer);
    };
  }, [pollIntervalMs]);

  return status;
}
