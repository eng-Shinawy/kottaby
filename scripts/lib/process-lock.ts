/**
 * PROCESS LOCK — Per-Tool Cross-Process Mutual Exclusion & FIFO Queueing
 *
 * Provides cross-process synchronization for resource-heavy operations
 * (tsgo, biome, oxlint, lint-service, sub-loop quality checks).
 *
 * Architecture: PER-TOOL locks (not a single global lock)
 *   Each tool class has its own independent lock namespace:
 *   - `.quality-gate-lock/tsgo/`        → serializes: tsgo, sub-loop tsgo, restore-next-env-dts
 *   - `.quality-gate-lock/biome/`       → serializes: biome:check (per-file & full-repo)
 *   - `.quality-gate-lock/oxlint/`      → serializes: oxlint (per-file & full-repo)
 *   - `.quality-gate-lock/lint/`        → serializes: lint-service (type-aware ESLint)
 *   - `.quality-gate-lock/duplicates/`  → serializes: jscpd duplication checks
 *   - `.quality-gate-lock/build/`       → serializes: next build, build:test
 *   - `.quality-gate-lock/test/`        → serializes: bun test runs
 *   - `.quality-gate-lock/default/`     → fallback for uncategorized tasks
 *
 * This allows tsgo and biome to run concurrently across parallel subagents,
 * while still serializing same-tool calls to prevent CPU/RAM contention.
 *
 * Features:
 *   - Atomic OS lockfile per tool class (`<tool>/active.json`)
 *   - Guaranteed FIFO queuing via timestamped ticket files in `<tool>/queue/`
 *   - In-process re-entrancy (nested lock calls within the same PID proceed immediately)
 *   - Deadlock recovery (stale lock/ticket cleanup for dead PIDs or expired locks)
 *   - Process signal/exit handlers to clean up locks on termination
 *
 * Implementation is split across:
 *   - `process-lock-helpers.ts` → types, constants, namespace state, PID checks, active-lock ops
 *   - `process-lock-tickets.ts` → queue tickets, queue-position logging, exit handlers
 */

import { existsSync, readdirSync, unlinkSync } from "node:fs";
import {
  asyncSleep,
  claimActiveLock,
  createReleaseCallback,
  ensureLockDirs,
  getActiveLock,
  getLockNamespace,
  getReentryCount,
  isProcessDescendantOf,
  isTimeoutExempt,
  LOCK_BASE_DIR,
  LOCK_CYAN,
  LOCK_GREEN,
  LOCK_NC,
  POLL_INTERVAL_MS,
  setReentryCount,
} from "@/scripts/lib/process-lock-helpers";
import {
  attachExitHandlers,
  checkQueuePosition,
  checkWaitingPosition,
  createQueueTicket,
  getValidQueueTickets,
  registerActiveTicket,
  unregisterActiveTicket,
} from "@/scripts/lib/process-lock-tickets";

// ─── Stale Cleanup ───────────────────────────────────────────────────────────

/**
 * Clean up all stale active locks and queue tickets across all lock namespaces.
 */
export function cleanAllStaleLocks(): void {
  if (!existsSync(LOCK_BASE_DIR)) return;
  try {
    const entries = readdirSync(LOCK_BASE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const ns = entry.name;
      // 1. Check active lock in namespace
      getActiveLock(ns);
      // 2. Check queue tickets in namespace
      getValidQueueTickets(ns);
    }
  } catch {
    /* ignore scan errors */
  }
}

// ─── Core Lock API ──────────────────────────────────────────────────────────

/**
 * Acquire cross-process lock for a specific tool namespace.
 * Returns a release function that MUST be called when done.
 */
export async function acquireProcessLock(description: string): Promise<() => void> {
  const ns = getLockNamespace(description);
  ensureLockDirs(ns);
  attachExitHandlers();

  // Sweep and clean up any stale locks/tickets from dead or stopped processes
  cleanAllStaleLocks();

  // 1. Re-entrancy check (same process or descendant process spawned by lock owner)
  const currentActive = getActiveLock(ns);
  if (currentActive && isProcessDescendantOf(currentActive.pid)) {
    setReentryCount(ns, getReentryCount(ns) + 1);
    return createReleaseCallback(ns, description);
  }

  // 2. Queue registration
  const { ticketPath, ticketInfo } = createQueueTicket(ns, description);
  registerActiveTicket(ticketPath);
  console.log(`${LOCK_CYAN}[process-lock]${LOCK_NC} Enqueued request for "${description}" (PID: ${process.pid})`);

  const cleanupTicket = () => {
    unregisterActiveTicket(ticketPath);
    try {
      unlinkSync(ticketPath);
    } catch {
      /* ignore ticket removal error */
    }
  };

  const poll = async (lastState: string): Promise<() => void> => {
    const active = getActiveLock(ns);
    let state = lastState;

    if (active) {
      if (active.pid === process.pid) {
        cleanupTicket();
        setReentryCount(ns, 1);
        return createReleaseCallback(ns, description);
      }
      state = checkQueuePosition(ns, ticketInfo, active.pid, active.description, state);
    } else {
      const validTickets = getValidQueueTickets(ns);
      const isFirst = validTickets.length === 0 || validTickets[0].info.ticketId === ticketInfo.ticketId;

      if (isFirst && claimActiveLock(ns, description)) {
        cleanupTicket();
        setReentryCount(ns, 1);
        console.log(
          `${LOCK_GREEN}[process-lock]${LOCK_NC} Acquired lock for "${description}" (PID: ${process.pid}). Executing...`
        );
        return createReleaseCallback(ns, description);
      }
      state = checkWaitingPosition(ns, ticketInfo, state);
    }

    await asyncSleep(POLL_INTERVAL_MS);
    return poll(state);
  };

  // 3. Wait loop via recursive async polling
  try {
    return await poll("");
  } finally {
    // If we exit unexpectedly without returning, ensure ticket is cleaned up
    cleanupTicket();
  }
}

/**
 * Wrap an async function in process lock execution.
 * Enforces a 5-minute timeout for all tasks EXCEPT exempt tasks (Tests, Duplicates, Lint-Service, Quality-Gate, Launch-Gate).
 */
export async function withProcessLock<T>(description: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireProcessLock(description);

  const exempt = isTimeoutExempt(description);
  const MAX_TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const timeoutPromise = exempt
    ? null
    : new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          const msg =
            `\n\x1b[31m❌ [process-lock] TASK TIMEOUT EXCEEDED (5 minutes / 300,000ms)\x1b[0m\n` +
            `Task "${description}" took longer than 5 minutes (300000ms) to complete.\n` +
            `This usually indicates an un-excluded build/dist directory, an infinite loop, or resource contention.\n` +
            `Fix the underlying issue before running again.\n`;
          console.error(msg);
          reject(new Error(msg));
        }, MAX_TASK_TIMEOUT_MS);
      });

  try {
    if (timeoutPromise) {
      return await Promise.race([fn(), timeoutPromise]);
    }
    return await fn();
  } catch (error) {
    if (timedOut) {
      throw error;
    }
    throw error;
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
    release();
  }
}
