/**
 * CLI contract for the performance-data cleanup tool: exactly one run
 * selector — `--run <id>` for a specific seed run, `--last` for the newest
 * manifest — plus the destructive-target guard's force override. Unknown
 * `--` tokens, a missing `--run` value, malformed run ids, and a missing or
 * conflicting selector are all usage refusals; bare non-flag tokens are
 * treated as flag values and ignored, mirroring the registered entrypoint
 * contract.
 */

import { RUN_ID_PATTERN } from "@/scripts/perf/lib/seed-shapes";

/** Validated CLI options: exactly one run selector plus the guard override. */
export interface CleanupCliOptions {
  readonly runId: string | null;
  readonly last: boolean;
  readonly forceProdShapedTarget: boolean;
}

/** Usage refusal (unknown flag, bad value, missing or conflicting selector). */
export class CleanupCliUsageError extends Error {
  readonly unknownFlags: readonly string[];

  constructor(message: string, unknownFlags: readonly string[] = []) {
    super(message);
    this.name = "CleanupCliUsageError";
    this.unknownFlags = unknownFlags;
  }
}

/** Runtime guard narrowing a parse result to the usage-error arm. */
export function isCleanupCliUsageError(value: unknown): value is CleanupCliUsageError {
  return value instanceof CleanupCliUsageError;
}

const SCRIPT_LABEL = "perf:cleanup";
const RUN_FLAG = "--run";
const LAST_FLAG = "--last";
const FORCE_FLAG = "--force-prod-shaped-target";
const ACCEPTED_FLAGS = [RUN_FLAG, LAST_FLAG, FORCE_FLAG];

/**
 * Parses the cleanup CLI into validated options or a usage refusal. Run ids
 * follow the seed contract (exactly eight lowercase hex characters), so
 * injection-shaped values never reach the manifest scan.
 */
export function parseCleanupCli(argv: readonly string[]): CleanupCliOptions | CleanupCliUsageError {
  const unknownFlags: string[] = [];
  let runId: string | null = null;
  let last = false;
  let force = false;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    index += 1;
    if (!token.startsWith("--")) {
      continue;
    }
    if (token === LAST_FLAG) {
      last = true;
      continue;
    }
    if (token === FORCE_FLAG) {
      force = true;
      continue;
    }
    if (token !== RUN_FLAG) {
      if (!unknownFlags.includes(token)) {
        unknownFlags.push(token);
      }
      continue;
    }
    const valueToken = argv[index];
    if (index >= argv.length || valueToken.startsWith("--")) {
      return new CleanupCliUsageError(
        `${SCRIPT_LABEL}: ${RUN_FLAG} expects a value (8 lowercase hex characters)`,
        unknownFlags
      );
    }
    runId = valueToken;
    index += 1;
  }
  if (unknownFlags.length > 0) {
    return new CleanupCliUsageError(
      `${SCRIPT_LABEL}: unknown flag(s): ${unknownFlags.join(", ")}\n${SCRIPT_LABEL}: accepted flags: ${ACCEPTED_FLAGS.join(", ")}`,
      unknownFlags
    );
  }
  if (runId !== null && !RUN_ID_PATTERN.test(runId)) {
    return new CleanupCliUsageError(
      `${SCRIPT_LABEL}: --run must be exactly 8 lowercase hex characters (got "${runId}")`
    );
  }
  if (runId !== null && last) {
    return new CleanupCliUsageError(`${SCRIPT_LABEL}: pass either --run <id> or --last, not both`);
  }
  if (runId === null && !last) {
    return new CleanupCliUsageError(
      `${SCRIPT_LABEL}: pass --run <id> to clean a specific seed run, or --last to clean the newest one`
    );
  }
  return { runId, last, forceProdShapedTarget: force };
}
