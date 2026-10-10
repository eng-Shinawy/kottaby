/**
 * CLI contract for the matching-pipeline benchmark: the volume list, the
 * per-cell sample and warmup counts, the latency gate budget, and the
 * plumbing-prove `--self-check` switch. Unknown `--` tokens are usage
 * refusals (exit 2, mirroring the harness guard's refusal code) and list
 * the accepted flags; a missing, non-integer, or out-of-range value is a
 * usage refusal too. Bare non-flag tokens are treated as stray values and
 * ignored, mirroring the registered entrypoint contract every perf tool
 * shares. Repeated flags: last wins.
 */

/** Default benchmark volumes, descending (the execution order). */
export const DEFAULT_VOLUMES: readonly number[] = [2000, 500, 100];

/** Default recorded samples per cell (after warmup). */
export const DEFAULT_SAMPLES = 30;

/** Default warmup iterations per cell (excluded from the sample set). */
export const DEFAULT_WARMUP = 5;

/** Default latency gate budget: p95 < 200ms at the gate-volume cells. */
export const DEFAULT_GATE_MS = 200;

/** Upper bounds for the numeric knobs (bounded knobs, never precision hazards). */
export const MAX_SAMPLES = 100_000;
export const MAX_WARMUP = 100_000;
export const MAX_GATE_MS = 3_600_000;
export const MAX_VOLUME = 1_000_000;

/** Validated CLI options for the matching benchmark. */
export interface BenchMatchingCliOptions {
  /** Teacher-pool window volumes, sorted descending (execution order). */
  readonly volumes: readonly number[];
  /** Recorded samples per cell. Zero samples make latency gates fail closed. */
  readonly samples: number;
  /** Warmup iterations per cell (their durations are never recorded). */
  readonly warmup: number;
  /** The p95 budget (milliseconds) the gate-volume cells must stay below. */
  readonly gateMs: number;
  /** Plumbing mini-run switch: one cell, fixed small counts, no gates. */
  readonly selfCheck: boolean;
}

/** Usage refusal (unknown flag, or a missing/invalid flag value). */
export class BenchMatchingCliUsageError extends Error {
  readonly unknownFlags: readonly string[];

  constructor(message: string, unknownFlags: readonly string[] = []) {
    super(message);
    this.name = "BenchMatchingCliUsageError";
    this.unknownFlags = unknownFlags;
  }
}

/** Runtime guard narrowing a parse result to the usage-error arm. */
export function isBenchMatchingCliUsageError(value: unknown): value is BenchMatchingCliUsageError {
  return value instanceof BenchMatchingCliUsageError;
}

const SCRIPT_LABEL = "perf:bench-matching";
const VOLUMES_FLAG = "--volumes";
const SAMPLES_FLAG = "--samples";
const WARMUP_FLAG = "--warmup";
const GATE_MS_FLAG = "--gate-ms";
const SELF_CHECK_FLAG = "--self-check";
const ACCEPTED_FLAGS = [VOLUMES_FLAG, SAMPLES_FLAG, WARMUP_FLAG, GATE_MS_FLAG, SELF_CHECK_FLAG];

function usageError(message: string, unknownFlags: readonly string[] = []): BenchMatchingCliUsageError {
  return new BenchMatchingCliUsageError(`${SCRIPT_LABEL}: ${message}`, unknownFlags);
}

interface NumericKnob {
  readonly flag: string;
  readonly min: number;
  readonly max: number;
}

/** Parses one bounded integer knob, recording at most one refusal per bad value. */
function parseKnob(raw: string, knob: NumericKnob, usageErrors: BenchMatchingCliUsageError[]): number | null {
  if (!/^\d+$/.test(raw)) {
    usageErrors.push(usageError(`${knob.flag} requires an integer value (got "${raw}")`));
    return null;
  }
  const value = Number(raw);
  if (value < knob.min || value > knob.max) {
    usageErrors.push(usageError(`${knob.flag} must be between ${knob.min} and ${knob.max} (got "${raw}")`));
    return null;
  }
  return value;
}

/** Parses the volume list: distinct non-negative integers, any input order. */
function parseVolumes(raw: string, usageErrors: BenchMatchingCliUsageError[]): number[] | null {
  const tokens = raw.split(",");
  const volumes: number[] = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!/^\d+$/.test(trimmed)) {
      usageErrors.push(usageError(`${VOLUMES_FLAG} requires a comma-separated list of integers (got "${raw}")`));
      return null;
    }
    const value = Number(trimmed);
    if (value > MAX_VOLUME) {
      usageErrors.push(usageError(`${VOLUMES_FLAG} values must not exceed ${MAX_VOLUME} (got "${trimmed}")`));
      return null;
    }
    if (!volumes.includes(value)) {
      volumes.push(value);
    }
  }
  return volumes.toSorted((left, right) => right - left);
}

/**
 * Parses the benchmark CLI into validated options or a usage refusal.
 * Value-bearing flags consume the next token as their value; any other `--`
 * token is unknown and reported once per distinct flag.
 */
export function parseBenchMatchingCli(argv: readonly string[]): BenchMatchingCliOptions | BenchMatchingCliUsageError {
  const unknownFlags: string[] = [];
  const usageErrors: BenchMatchingCliUsageError[] = [];
  let volumes: number[] | null = null;
  let samples: number | null = null;
  let warmup: number | null = null;
  let gateMs: number | null = null;
  let selfCheck = false;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    index += 1;
    if (!token.startsWith("--")) {
      continue;
    }
    if (token === SELF_CHECK_FLAG) {
      selfCheck = true;
      continue;
    }
    if (token !== VOLUMES_FLAG && token !== SAMPLES_FLAG && token !== WARMUP_FLAG && token !== GATE_MS_FLAG) {
      if (!unknownFlags.includes(token)) {
        unknownFlags.push(token);
      }
      continue;
    }
    const rawValue = argv[index];
    if (index >= argv.length || rawValue.startsWith("--")) {
      return usageError(`${token} requires a value`, unknownFlags);
    }
    index += 1;
    if (token === VOLUMES_FLAG) {
      volumes = parseVolumes(rawValue, usageErrors);
    } else if (token === SAMPLES_FLAG) {
      samples = parseKnob(rawValue, { flag: SAMPLES_FLAG, min: 0, max: MAX_SAMPLES }, usageErrors);
    } else if (token === WARMUP_FLAG) {
      warmup = parseKnob(rawValue, { flag: WARMUP_FLAG, min: 0, max: MAX_WARMUP }, usageErrors);
    } else {
      gateMs = parseKnob(rawValue, { flag: GATE_MS_FLAG, min: 1, max: MAX_GATE_MS }, usageErrors);
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
  return {
    volumes: volumes ?? DEFAULT_VOLUMES,
    samples: samples ?? DEFAULT_SAMPLES,
    warmup: warmup ?? DEFAULT_WARMUP,
    gateMs: gateMs ?? DEFAULT_GATE_MS,
    selfCheck,
  };
}
