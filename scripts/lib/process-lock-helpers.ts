/**
 * PROCESS LOCK HELPERS — Shared types, constants, state, and low-level utilities
 *
 * Extracted from `process-lock.ts` (see that file for the full architecture
 * overview of the per-tool cross-process mutual exclusion & FIFO queueing).
 * Contains everything that both the ticket/queue module and the core lock API
 * need: lock namespaces, path helpers, per-namespace re-entrancy state,
 * PID liveness checks, and the atomic active-lock file operations.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActiveLockInfo {
  pid: number;
  acquiredAt: number;
  description: string;
  reentryCount: number;
}

export interface QueueTicketInfo {
  pid: number;
  timestamp: number;
  ticketId: string;
  description: string;
}

// ─── Tool Classification ─────────────────────────────────────────────────────

/**
 * Derive the lock namespace (tool class) from the task description.
 * Each namespace gets its own independent lock directory.
 */
export function getLockNamespace(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("tsgo") || d.includes("restore-next-env-dts") || d.includes("typescript")) return "tsgo";
  if (d.includes("biome")) return "biome";
  if (d.includes("oxlint")) return "oxlint";
  if (
    d.includes("lint-service") ||
    d.includes("lint:type-aware") ||
    d.includes("lint:fix") ||
    d === "lint" ||
    d.startsWith("lint ")
  )
    return "lint";
  if (d.includes("duplicates") || d.includes("jscpd")) return "duplicates";
  if (d.includes("build")) return "build";
  if (d.startsWith("test") || d.includes("test:") || d.includes("test ")) return "test";
  return "default";
}

/**
 * Check if a task description is exempt from the 5-minute timeout.
 */
export function isTimeoutExempt(description: string): boolean {
  const d = description.toLowerCase();
  return (
    d.includes("quality-gate") ||
    d.includes("duplicates") ||
    d.includes("jscpd") ||
    d.includes("lint-service") ||
    d.startsWith("test") ||
    d.includes("test:") ||
    d.includes("test ")
  );
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();
export const LOCK_BASE_DIR = resolve(PROJECT_ROOT, ".quality-gate-lock");

/** Maximum age for a lock before considering it stale (5 minutes) */
export const MAX_LOCK_AGE_MS = 5 * 60 * 1000;

/** Queue polling interval in milliseconds */
export const POLL_INTERVAL_MS = 250;

export const LOCK_YELLOW = "\x1b[33m";
export const LOCK_GREEN = "\x1b[32m";
export const LOCK_CYAN = "\x1b[36m";
export const LOCK_NC = "\x1b[0m";

// ─── Per-namespace path helpers ──────────────────────────────────────────────

function getLockDir(namespace: string): string {
  return join(LOCK_BASE_DIR, namespace);
}

export function getQueueDir(namespace: string): string {
  return join(getLockDir(namespace), "queue");
}

function getActiveLockFile(namespace: string): string {
  return join(getLockDir(namespace), "active.json");
}

// ─── State (per-namespace) ───────────────────────────────────────────────────

// Reentry tracking: namespace → count
const reentryCountByNs = new Map<string, number>();
// Release callbacks: namespace → Set<() => void>
export const activeReleasesByNs = new Map<string, Set<() => void>>();

export function getReentryCount(ns: string): number {
  return reentryCountByNs.get(ns) ?? 0;
}
export function setReentryCount(ns: string, val: number): void {
  reentryCountByNs.set(ns, val);
}
function getReleases(ns: string): Set<() => void> {
  let set = activeReleasesByNs.get(ns);
  if (!set) {
    set = new Set();
    activeReleasesByNs.set(ns, set);
  }
  return set;
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function getErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) {
    return undefined;
  }
  const code = Reflect.get(err, "code");
  return typeof code === "string" ? code : undefined;
}

export function asyncSleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms));
}

/**
 * Check if a process PID is alive and actively running (not dead, zombie, or stopped).
 * Returns true if process exists and is in an active state, false otherwise.
 */
export function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  // 1. Basic OS signal check (works across all platforms)
  try {
    process.kill(pid, 0);
  } catch (err: unknown) {
    // If error is not EPERM (e.g. ESRCH = no such process), process does not exist
    if (getErrorCode(err) !== "EPERM") {
      return false;
    }
  }

  // 2. Linux /proc inspection for process state & zombie/stopped detection
  try {
    const statPath = `/proc/${pid}/stat`;
    if (existsSync(statPath)) {
      const statContent = readFileSync(statPath, "utf8");
      const lastParen = statContent.lastIndexOf(")");
      if (lastParen !== -1 && lastParen + 2 < statContent.length) {
        const stateChar = statContent.charAt(lastParen + 2);
        // States:
        // 'R' (running), 'S' (sleeping), 'D' (disk sleep), 'I' (idle) -> Running / active
        // 'Z' (zombie), 'T' (stopped by job control/Ctrl+Z), 't' (tracing stop), 'X'/'x' (dead), 'K' (wakekill), 'W' (paging) -> NOT running
        if (stateChar === "Z" || stateChar === "T" || stateChar === "t" || stateChar === "X" || stateChar === "x") {
          return false;
        }
      }
    }

    const cmdlinePath = `/proc/${pid}/cmdline`;
    if (existsSync(cmdlinePath)) {
      const cmdline = readFileSync(cmdlinePath, "utf8");
      if (cmdline.length === 0) {
        return false;
      }
    }
  } catch {
    // If reading /proc fails or on non-Linux, the basic kill(pid, 0) check above stands
  }

  return true;
}

/**
 * Backward compatibility alias for isPidRunning
 */
export const isPidAlive = isPidRunning;

/**
 * Ensure lock directories exist for a given namespace.
 */
export function ensureLockDirs(ns: string): void {
  const lockDir = getLockDir(ns);
  const queueDir = getQueueDir(ns);
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }
  if (!existsSync(queueDir)) {
    mkdirSync(queueDir, { recursive: true });
  }
}

/**
 * Read the current active lock for a namespace, cleaning it up if stale.
 */
export function getActiveLock(ns: string): ActiveLockInfo | null {
  const activeLockFile = getActiveLockFile(ns);
  if (!existsSync(activeLockFile)) return null;
  try {
    const content = readFileSync(activeLockFile, "utf8");
    const info: ActiveLockInfo = JSON.parse(content);
    const alive = isPidRunning(info.pid);
    const exempt = isTimeoutExempt(info.description);
    if (!alive || (!exempt && Date.now() - info.acquiredAt > MAX_LOCK_AGE_MS)) {
      console.log(
        `${LOCK_YELLOW}[process-lock]${LOCK_NC} Cleaning up stale lock held by PID ${info.pid} (${info.description})`
      );
      try {
        unlinkSync(activeLockFile);
      } catch {
        /* ignore stale lock cleanup error */
      }
      return null;
    }
    return info;
  } catch {
    try {
      unlinkSync(activeLockFile);
    } catch {
      /* ignore stale lock cleanup error */
    }
    return null;
  }
}

/**
 * Atomically claim the active lock file for a namespace.
 */
export function claimActiveLock(ns: string, description: string): ActiveLockInfo | null {
  ensureLockDirs(ns);
  const activeLockFile = getActiveLockFile(ns);
  const info: ActiveLockInfo = {
    pid: process.pid,
    acquiredAt: Date.now(),
    description,
    reentryCount: 1,
  };
  try {
    const fd = openSync(activeLockFile, "wx");
    writeSync(fd, JSON.stringify(info, null, 2));
    closeSync(fd);
    return info;
  } catch (err: unknown) {
    if (getErrorCode(err) === "EEXIST") {
      return null;
    }
    throw err;
  }
}

/**
 * Create a release callback that cleans up the active lock for a namespace.
 */
export function createReleaseCallback(ns: string, description: string): () => void {
  const activeLockFile = getActiveLockFile(ns);
  const releases = getReleases(ns);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const count = getReentryCount(ns) - 1;
    setReentryCount(ns, count);
    releases.delete(release);
    if (count <= 0) {
      setReentryCount(ns, 0);
      try {
        unlinkSync(activeLockFile);
      } catch {
        /* ignore active lock release error */
      }
      console.log(`${LOCK_CYAN}[process-lock]${LOCK_NC} Released lock for "${description}" (PID: ${process.pid})`);
    }
  };
  releases.add(release);
  return release;
}

export function isProcessDescendantOf(activePid: number): boolean {
  if (process.pid === activePid) return true;
  let currentPid = process.ppid;
  let depth = 0;
  while (currentPid > 1 && depth < 5) {
    if (currentPid === activePid) return true;
    try {
      const statPath = `/proc/${currentPid}/stat`;
      if (!existsSync(statPath)) break;
      const statContent = readFileSync(statPath, "utf8");
      const lastParen = statContent.lastIndexOf(")");
      if (lastParen === -1) break;
      const rest = statContent.substring(lastParen + 2).split(" ");
      const ppid = Number.parseInt(rest[1], 10);
      if (Number.isNaN(ppid) || ppid <= 1) break;
      currentPid = ppid;
      depth++;
    } catch {
      break;
    }
  }
  return false;
}
