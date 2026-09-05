/**
 * PROCESS LOCK TICKETS — FIFO queue tickets, queue position logging, and
 * process exit cleanup handlers.
 *
 * Extracted from `process-lock.ts` (see that file for the full architecture
 * overview of the per-tool cross-process mutual exclusion & FIFO queueing).
 * Queue tickets are timestamped JSON files in `<tool>/queue/`; the exit
 * handlers clean up both active locks and outstanding tickets on
 * crash/exit/signals.
 */

import { randomUUID } from "node:crypto";
import { closeSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import {
  activeReleasesByNs,
  ensureLockDirs,
  getQueueDir,
  isPidRunning,
  isTimeoutExempt,
  LOCK_NC,
  LOCK_YELLOW,
  MAX_LOCK_AGE_MS,
  type QueueTicketInfo,
} from "@/scripts/lib/process-lock-helpers";

/**
 * Create a timestamped ticket file in the queue directory for a namespace.
 */
export function createQueueTicket(
  ns: string,
  description: string
): { ticketPath: string; ticketInfo: QueueTicketInfo } {
  ensureLockDirs(ns);
  const queueDir = getQueueDir(ns);
  const timestamp = Date.now();
  const ticketId = randomUUID().substring(0, 8);
  const fileName = `${timestamp}_${process.pid}_${ticketId}.json`;
  const ticketPath = join(queueDir, fileName);

  const ticketInfo: QueueTicketInfo = {
    pid: process.pid,
    timestamp,
    ticketId,
    description,
  };

  try {
    const fd = openSync(ticketPath, "wx");
    writeSync(fd, JSON.stringify(ticketInfo, null, 2));
    closeSync(fd);
  } catch (err: unknown) {
    if (err !== null) {
      // Retry once if file exists (extremely unlikely)
      const altFileName = `${timestamp + 1}_${process.pid}_${ticketId}.json`;
      const altPath = join(queueDir, altFileName);
      const fd = openSync(altPath, "wx");
      writeSync(fd, JSON.stringify(ticketInfo, null, 2));
      closeSync(fd);
      return { ticketPath: altPath, ticketInfo };
    }
  }

  return { ticketPath, ticketInfo };
}

function parseTicketFile(queueDir: string, file: string): QueueTicketInfo | null {
  if (!file.endsWith(".json")) return null;
  const ticketPath = join(queueDir, file);
  try {
    const content = readFileSync(ticketPath, "utf8");
    const info: QueueTicketInfo = JSON.parse(content);
    const alive = isPidRunning(info.pid);
    const exempt = isTimeoutExempt(info.description);
    if (!alive || (!exempt && Date.now() - info.timestamp > MAX_LOCK_AGE_MS)) {
      try {
        unlinkSync(ticketPath);
      } catch {
        /* ignore cleanup error */
      }
      return null;
    }
    return info;
  } catch {
    try {
      unlinkSync(ticketPath);
    } catch {
      /* ignore cleanup error */
    }
    return null;
  }
}

/**
 * Scan queue directory for a namespace, remove stale tickets,
 * and return valid tickets sorted by timestamp ascending (FIFO).
 */
export function getValidQueueTickets(ns: string): { file: string; info: QueueTicketInfo }[] {
  ensureLockDirs(ns);
  const queueDir = getQueueDir(ns);
  try {
    const files = readdirSync(queueDir);
    const valid: { file: string; info: QueueTicketInfo }[] = [];

    for (const file of files) {
      const info = parseTicketFile(queueDir, file);
      if (info) {
        valid.push({ file, info });
      }
    }

    valid.sort((a, b) => {
      if (a.info.timestamp !== b.info.timestamp) {
        return a.info.timestamp - b.info.timestamp;
      }
      return a.file.localeCompare(b.file);
    });

    return valid;
  } catch {
    return [];
  }
}

const activeTickets = new Set<string>();

/**
 * Track a queue ticket owned by this process so exit handlers can remove it.
 */
export function registerActiveTicket(ticketPath: string): void {
  activeTickets.add(ticketPath);
}

/**
 * Stop tracking a queue ticket (already removed from disk or about to be).
 */
export function unregisterActiveTicket(ticketPath: string): void {
  activeTickets.delete(ticketPath);
}

let exitHandlersAttached = false;

/**
 * Attach process exit handlers to clean up all active locks and tickets on crash/exit/signals.
 */
export function attachExitHandlers(): void {
  if (exitHandlersAttached) return;
  exitHandlersAttached = true;

  const cleanupAll = () => {
    for (const releases of activeReleasesByNs.values()) {
      for (const release of releases) {
        try {
          release();
        } catch {
          /* ignore process exit cleanup error */
        }
      }
    }
    for (const ticketPath of activeTickets) {
      try {
        unlinkSync(ticketPath);
      } catch {
        /* ignore ticket cleanup error */
      }
    }
    activeTickets.clear();
  };

  process.on("exit", cleanupAll);
  process.on("SIGINT", () => {
    cleanupAll();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanupAll();
    process.exit(143);
  });
  process.on("SIGHUP", () => {
    cleanupAll();
    process.exit(129);
  });
  process.on("SIGQUIT", () => {
    cleanupAll();
    process.exit(131);
  });
  process.on("SIGBREAK", () => {
    cleanupAll();
    process.exit(130);
  });
}

// Attach handlers eagerly on module import
attachExitHandlers();

export function getQueuePosition(ns: string, ticketInfo: QueueTicketInfo): { pos: number; total: number } {
  const validTickets = getValidQueueTickets(ns);
  const myIndex = validTickets.findIndex(t => t.info.ticketId === ticketInfo.ticketId);
  const pos = myIndex >= 0 ? myIndex + 1 : validTickets.length + 1;
  return { pos, total: validTickets.length };
}

function logIfStateChanged(stateStr: string, lastLoggedState: string, message: string): string {
  if (stateStr !== lastLoggedState) {
    console.log(message);
  }
  return stateStr;
}

export function checkQueuePosition(
  ns: string,
  ticketInfo: QueueTicketInfo,
  activePid: number,
  activeDesc: string,
  lastLoggedState: string
): string {
  const { pos, total } = getQueuePosition(ns, ticketInfo);
  const stateStr = `held_by_${activePid}_pos_${pos}_total_${total}`;
  return logIfStateChanged(
    stateStr,
    lastLoggedState,
    `${LOCK_YELLOW}[process-lock]${LOCK_NC} Lock held by PID ${activePid} (${activeDesc}). Position in queue: ${pos}/${total}. Waiting...`
  );
}

export function checkWaitingPosition(ns: string, ticketInfo: QueueTicketInfo, lastLoggedState: string): string {
  const { pos, total } = getQueuePosition(ns, ticketInfo);
  const stateStr = `waiting_pos_${pos}_total_${total}`;
  return logIfStateChanged(
    stateStr,
    lastLoggedState,
    `${LOCK_YELLOW}[process-lock]${LOCK_NC} Waiting for turn in queue. Position: ${pos}/${total}...`
  );
}
