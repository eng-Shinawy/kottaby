/**
 * CLI contract for the EXPLAIN query auditor: a single value-bearing
 * `--scan-threshold-rows` flag selecting the scan gate's scale threshold.
 * Unknown `--` tokens are usage refusals (exit 2, mirroring the harness
 * guard's refusal code) and list the accepted flags; a missing,
 * non-integer, or out-of-range value is a usage refusal too. Bare
 * non-flag tokens are treated as stray values and ignored, mirroring the
 * registered entrypoint contract every perf tool shares. Repeated flags:
 * last wins.
 */

/** Default scan-gate threshold: Seq Scan row estimates at or above this breach the gate. */
export const DEFAULT_SCAN_THRESHOLD_ROWS = 1000;

/** Upper bound for the threshold (a bounded knob, never a memory or precision hazard). */
export const MAX_SCAN_THRESHOLD_ROWS = 1_000_000_000;

/** Validated CLI options for the query auditor. */
export interface AnalyzeQueriesCliOptions {
  readonly scanThresholdRows: number;
}

/** Usage refusal (unknown flag, or a missing/invalid flag value). */
export class AnalyzeQueriesCliUsageError extends Error {
  readonly unknownFlags: readonly string[];

  constructor(message: string, unknownFlags: readonly string[] = []) {
    super(message);
    this.name = "AnalyzeQueriesCliUsageError";
    this.unknownFlags = unknownFlags;
  }
}

/** Runtime guard narrowing a parse result to the usage-error arm. */
export function isAnalyzeQueriesCliUsageError(value: unknown): value is AnalyzeQueriesCliUsageError {
  return value instanceof AnalyzeQueriesCliUsageError;
}

const SCRIPT_LABEL = "perf:analyze-queries";
const THRESHOLD_FLAG = "--scan-threshold-rows";
const ACCEPTED_FLAGS = [THRESHOLD_FLAG];

function usageError(message: string, unknownFlags: readonly string[] = []): AnalyzeQueriesCliUsageError {
  return new AnalyzeQueriesCliUsageError(`${SCRIPT_LABEL}: ${message}`, unknownFlags);
}

/** Reads one threshold value: a bounded positive integer, or a recorded usage refusal (0 signals refusal). */
function parseThresholdValue(raw: string, usageErrors: AnalyzeQueriesCliUsageError[]): number {
  if (!/^\d+$/.test(raw)) {
    usageErrors.push(usageError(`${THRESHOLD_FLAG} requires a positive integer value (got "${raw}")`));
    return 0;
  }
  const value = Number(raw);
  if (value < 1 || value > MAX_SCAN_THRESHOLD_ROWS) {
    usageErrors.push(usageError(`${THRESHOLD_FLAG} must be between 1 and ${MAX_SCAN_THRESHOLD_ROWS} (got "${raw}")`));
    return 0;
  }
  return value;
}

/**
 * Parses the auditor CLI into validated options or a usage refusal. The
 * threshold flag consumes the next token as its value; any other `--`
 * token is unknown and reported once per distinct flag.
 */
export function parseAnalyzeQueriesCli(
  argv: readonly string[]
): AnalyzeQueriesCliOptions | AnalyzeQueriesCliUsageError {
  const unknownFlags: string[] = [];
  const usageErrors: AnalyzeQueriesCliUsageError[] = [];
  let scanThresholdRows: number | null = null;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    index += 1;
    if (!token.startsWith("--")) {
      continue;
    }
    if (token !== THRESHOLD_FLAG) {
      if (!unknownFlags.includes(token)) {
        unknownFlags.push(token);
      }
      continue;
    }
    const rawValue = argv[index];
    if (index >= argv.length || rawValue.startsWith("--")) {
      return usageError(`${THRESHOLD_FLAG} requires a value`, unknownFlags);
    }
    index += 1;
    const parsed = parseThresholdValue(rawValue, usageErrors);
    if (parsed > 0) {
      scanThresholdRows = parsed;
    }
  }
  if (unknownFlags.length > 0) {
    return usageError(
      `unknown flag(s): ${unknownFlags.join(", ")}\n${SCRIPT_LABEL}: accepted flags: ${ACCEPTED_FLAGS.join(", ")}`,
      unknownFlags
    );
  }
  if (usageErrors.length > 0) {
    const [firstValueError] = usageErrors;
    return firstValueError;
  }
  return { scanThresholdRows: scanThresholdRows ?? DEFAULT_SCAN_THRESHOLD_ROWS };
}
