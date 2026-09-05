/**
 * LINT SERVICE CONFIG — Types, constants, and adaptive resource sizing
 *
 * Shared by scripts/lint-service.ts (queue + executor + programmatic API) and
 * scripts/lint-service-cli.ts (CLI entrypoint). Pure data/logic module — no
 * queue state, no queue imports.
 *
 * Adaptive sizing rationale (heap + concurrency) lives with the constants
 * below; see root AGENTS.md §Lint Service for the operator-facing env vars.
 */

import { readFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";

// ─── Types ──────────────────────────────────────────────────────────────────

export type LintResult = { success: boolean; output: string; exitCode: number };

export interface LintOptions {
  fix?: boolean;
  json?: boolean;
  verbose?: boolean;
  typeAware?: boolean;
  /** ESLint --max-warnings (e.g. 0 to fail on any warning). */
  maxWarnings?: number;
}

export interface LintMetrics {
  id: string;
  scope: "full-repo" | "files";
  fileCount: number;
  durationMs: number;
  enqueuedAt: number;
  startedAt: number;
  finishedAt: number;
  queueDepthAtEnqueue: number;
}

export interface LintExecutionResult extends LintResult {
  metrics: LintMetrics;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** ESLint binary invocation via Bun (resolved from PATH, not hardcoded). */
export const ESLINT_BIN = process.env.BUN_EXEC ?? "bun";

/** NODE_OPTIONS fragment for TypeScript 6 patch (swaps typescript → @typescript/typescript6) */
export const ESLINT_PATCH = "-r ./scripts/ts6-eslint-patch.cjs";

/** Default per-request timeout for file-scoped lint runs (5 minutes) */
export const DEFAULT_TIMEOUT_FILES_MS = Number(process.env.LINT_QUEUE_TIMEOUT_MS ?? 300000);

/** Default per-request timeout for full-repo lint runs (5 minutes) */
export const DEFAULT_TIMEOUT_FULL_REPO_MS = Number(process.env.LINT_QUEUE_TIMEOUT_MS ?? 1200000);

/** Default ESLint child heap cap (MB) — only used when the machine can afford it. */
const DEFAULT_MAX_OLD_SPACE_MB = 8192;

/**
 * Preferred ESLint child heap floor (MB) — applied only when the detected
 * memory budget can afford it; never raised above the budget itself.
 */
const MIN_MAX_OLD_SPACE_MB = 2048;

/** Fraction of total memory the ESLint child heap may use when clamping. */
const HEAP_FRACTION_OF_TOTAL = 0.7;

/**
 * Read the cgroup memory limit in bytes, or null when unavailable/unlimited.
 * Checks cgroup v2 (memory.max) then v1 (memory/memory.limit_in_bytes); a v2
 * value of "max" means unlimited. os.totalmem() reports host RAM rather than
 * the cgroup limit on Linux, so the caller uses the smaller of the two.
 */
function readCgroupMemoryLimitBytes(): number | null {
  for (const path of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8").trim();
    } catch {
      continue; // File absent (non-Linux or different cgroup version) — try next.
    }
    if (raw === "max") return null; // Unlimited → fall back to os.totalmem()
    const bytes = Number.parseInt(raw, 10);
    if (Number.isFinite(bytes) && bytes > 0) return bytes;
  }
  return null;
}

/**
 * Adaptive Node heap cap (MB) for the ESLint child process.
 *
 * The previous hardcoded 8192 assumed ~7GB CI runners; on smaller hosts (e.g.
 * a 4 GiB cgroup with no swap) the child was OOM-killed (SIGKILL/exit 137 →
 * silent exit-1 with no output). Resolution order:
 *   1. LINT_MAX_OLD_SPACE_MB env var — explicit override, wins outright
 *   2. min(8192, floor(totalMemMB * 0.7)), where totalMemMB is the smaller of
 *      the cgroup limit and os.totalmem()
 *   3. Floored at 2048 MB — but the floor never exceeds the detected budget
 *      (a floor above the budget would cap the heap above what the host can
 *      afford and re-introduce the OOM-kill this sizing exists to prevent)
 */
export const MAX_OLD_SPACE_MB: number = (() => {
  const override = Number.parseInt(process.env.LINT_MAX_OLD_SPACE_MB ?? "", 10);
  if (override > 0) return override;

  const cgroupBytes = readCgroupMemoryLimitBytes();
  const totalBytes = cgroupBytes === null ? totalmem() : Math.min(cgroupBytes, totalmem());
  const totalMb = Math.floor(totalBytes / (1024 * 1024));
  const budgetMb = Math.floor(totalMb * HEAP_FRACTION_OF_TOTAL);

  // The 2048 MB floor is clamped to the detected budget: the returned heap
  // must NEVER exceed what the host can actually afford. On hosts below
  // ~2.9 GiB (budget < 2048 MB), min(MIN, budget) collapses to the budget, so
  // the floor degrades to a no-op instead of restoring 2048 MB over a smaller
  // cgroup (e.g. a 2 GiB cgroup: budget = 1433, not 2048 = the whole cgroup)
  // — which would OOM-kill the ESLint child exactly like the old hardcoded
  // 8192 did.
  return Math.min(DEFAULT_MAX_OLD_SPACE_MB, Math.max(Math.min(MIN_MAX_OLD_SPACE_MB, budgetMb), budgetMb));
})();

/** Upper bound for adaptive concurrency — the historical flat default. */
const MAX_CONCURRENCY = 4;

/**
 * Peak RSS a single ESLint isolate (main thread or one --concurrency worker) needs
 * for a cold full-repo run, rounded up from the ~1.7 GiB measured on this repo.
 * Used to derive how many concurrent isolates the memory budget can afford.
 */
const PER_ISOLATE_MB = 2048;

/**
 * Adaptive ESLint worker concurrency.
 *
 * `--concurrency=N` (N > 1) makes ESLint lint files in N worker-thread isolates
 * alongside the main-thread isolate, and every isolate gets its own V8 heap
 * capped by --max-old-space-size. The adaptive heap therefore bounds a single
 * isolate, not the (N + 1) × heap worst case: on a 4 GiB cgroup (no swap),
 * --concurrency=4 got the whole eslint process OOM-killed (SIGKILL → silent
 * exit-1 with empty output) on every cold-cache full-repo run.
 *
 * Resolution order:
 *   1. LINT_QUEUE_CONCURRENCY env var — explicit override, wins outright ("auto" allowed)
 *   2. min(4, cpuWorkers, memWorkers), floored at 1, where:
 *        cpuWorkers = availableParallelism() >> 1  (mirrors ESLint's own "auto" heuristic)
 *        memWorkers = floor(heapBudget / PER_ISOLATE_MB) - 1  (reserve one isolate for the
 *                     main thread; a value of 1 keeps eslint single-threaded)
 */
export const CONCURRENCY: string = (() => {
  const override = process.env.LINT_QUEUE_CONCURRENCY;
  if (override !== undefined && override !== "") return override;

  const cpuWorkers = Math.max(1, availableParallelism() >> 1);
  const memWorkers = Math.max(1, Math.floor(MAX_OLD_SPACE_MB / PER_ISOLATE_MB) - 1);
  return String(Math.max(1, Math.min(MAX_CONCURRENCY, cpuWorkers, memWorkers)));
})();

/**
 * Human-readable notice appended to the eslint output when the child process is
 * killed by a signal instead of exiting (e.g. kernel OOM-killer SIGKILL on
 * memory-constrained hosts, or the exec timeout SIGTERM). Without this, signal
 * deaths surface as a silent exit-1 with empty output, which is undebuggable
 * from CI logs.
 */
export function signalDeathNotice(signal: string): string {
  const oomHint =
    signal === "SIGKILL"
      ? " (likely the kernel OOM-killer — lower LINT_QUEUE_CONCURRENCY or LINT_MAX_OLD_SPACE_MB)"
      : "";
  return `\n[lint-service] eslint was terminated by signal ${signal} instead of exiting${oomHint}.`;
}
