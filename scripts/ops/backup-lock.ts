/**
 * Run-directory lockfile for the database backup script.
 *
 * A `.lock-<pid>` file inside the output directory serializes backups on one
 * host. Locks left behind by dead processes are reclaimed automatically;
 * live locks are never stolen — a second run refuses with a clear message
 * instead of corrupting a concurrent backup. A lock carrying this process's
 * own pid is only reclaimable when it is older than the self-lock grace
 * window (a fresh same-pid lock means a concurrent run inside this process).
 *
 * Holder reporting: a refusal NEVER reports this process's own pid as the
 * "other" holder — either a rescan discovers the actual other holder's pid,
 * or the holder is reported as unknown (holderPid: null).
 */

import { readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_FILE_PREFIX = ".lock-";
const SELF_LOCK_STALE_MS = 60_000;

function errnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * PID liveness via signal 0: ESRCH means dead; EPERM means the process
 * exists but is owned by someone else (alive); anything else fails closed
 * (treated as alive) so a lock is never stolen on uncertainty.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) !== "ESRCH";
  }
}

export function lockFilePath(outDir: string, pid: number): string {
  return join(outDir, `${LOCK_FILE_PREFIX}${pid}`);
}

export interface RunLockScan {
  /** Locks of dead processes (unlinked by `acquireRunLock`). */
  reclaimedPids: number[];
  /** Unparseable lock file names (unlinked by `acquireRunLock`). */
  reclaimedPaths: string[];
  /** Pids of live processes currently holding a lock. */
  liveHolderPids: number[];
}

export type RunLockAcquisition =
  | { ok: true; lockPath: string; reclaimedPids: number[]; reclaimedPaths: string[] }
  | { ok: false; holderPid: number | null };

/**
 * Classifies the lock files in the output directory. Stale locks (dead pid)
 * and malformed names are reclaimable; a lock carrying this process's own
 * pid is only reclaimable when it is older than `SELF_LOCK_STALE_MS` (a
 * fresh same-pid lock means a concurrent run inside this very process).
 */
export function scanRunLocks(outDir: string, selfPid: number, isAlive: (pid: number) => boolean): RunLockScan {
  const scan: RunLockScan = { reclaimedPids: [], reclaimedPaths: [], liveHolderPids: [] };

  for (const entry of readdirSync(outDir)) {
    if (!entry.startsWith(LOCK_FILE_PREFIX)) {
      continue;
    }
    const suffix = entry.slice(LOCK_FILE_PREFIX.length);
    const pid = Number.parseInt(suffix, 10);
    if (!Number.isInteger(pid) || pid <= 0 || String(pid) !== suffix) {
      scan.reclaimedPaths.push(entry);
      continue;
    }
    if (pid === selfPid) {
      // A lock can vanish between readdir and this stat (concurrent cleanup).
      // ENOENT means there is nothing left to classify and nothing to
      // reclaim: treat it as absent instead of letting the stat failure
      // spuriously abort lock acquisition. Any other stat failure still
      // fails closed (thrown).
      let ageMs: number;
      try {
        ageMs = Date.now() - statSync(join(outDir, entry)).mtimeMs;
      } catch (error) {
        if (errnoCode(error) === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (ageMs > SELF_LOCK_STALE_MS) {
        scan.reclaimedPids.push(pid);
      } else {
        scan.liveHolderPids.push(pid);
      }
      continue;
    }
    if (isAlive(pid)) {
      scan.liveHolderPids.push(pid);
    } else {
      scan.reclaimedPids.push(pid);
    }
  }

  return scan;
}

/**
 * Acquires the run-directory lock for `selfPid` (scan-and-reclaim stale
 * locks, then create `.lock-<pid>` exclusively). A live holder is never
 * stolen — the caller refuses. Note: two distinct real processes can still
 * slip through the scan→create window (sub-millisecond); that residual race
 * is benign because each run stages into its own `tmp-<pid>-<ts>` dir and
 * publishes via an atomic, collision-suffixed rename, so artifacts can
 * never interleave.
 */
export function acquireRunLock(
  outDir: string,
  selfPid: number,
  isAlive: (pid: number) => boolean = isPidAlive
): RunLockAcquisition {
  const scan = scanRunLocks(outDir, selfPid, isAlive);
  const otherHolderPids = scan.liveHolderPids.filter(pid => pid !== selfPid);
  if (otherHolderPids.length > 0) {
    return { ok: false, holderPid: Math.min(...otherHolderPids) };
  }
  if (scan.liveHolderPids.length > 0) {
    // A fresh `.lock-<selfPid>`: a concurrent run inside this very process
    // (or a reused pid's leftover). Refuse, but never report selfPid as the
    // "other" holder.
    return { ok: false, holderPid: null };
  }

  for (const name of scan.reclaimedPaths) {
    try {
      unlinkSync(join(outDir, name));
    } catch {
      // Best effort — a malformed file that vanished is fine.
    }
  }
  for (const pid of scan.reclaimedPids) {
    try {
      unlinkSync(lockFilePath(outDir, pid));
    } catch {
      // Best effort — the stale lock may already be gone.
    }
  }

  const lockPath = lockFilePath(outDir, selfPid);
  try {
    writeFileSync(lockPath, `${new Date().toISOString()}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      // Cross-process race: someone claimed the lock between scan and create.
      // Re-scan to report the ACTUAL other holder when discoverable; the
      // holder is never reported as this process's own pid.
      const rescan = scanRunLocks(outDir, selfPid, isAlive);
      const otherHolder = rescan.liveHolderPids.find(pid => pid !== selfPid);
      return { ok: false, holderPid: otherHolder ?? null };
    }
    throw error;
  }

  return { ok: true, lockPath, reclaimedPids: scan.reclaimedPids, reclaimedPaths: scan.reclaimedPaths };
}

/**
 * Releases this run's lock. Best effort: any failure is swallowed because
 * the next run's stale-lock reclamation (dead pid) recovers it.
 */
export function releaseRunLock(outDir: string, pid: number): void {
  try {
    unlinkSync(lockFilePath(outDir, pid));
  } catch {
    // Already gone or unremovable — recovery is handled by stale reclamation.
  }
}
