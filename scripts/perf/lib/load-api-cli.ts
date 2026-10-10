/**
 * CLI contract for the API load harness: the accepted flag set, the
 * value/boolean flag split, and the validation rules. Unknown `--` tokens,
 * missing values, non-integer or out-of-range counts, malformed ramp specs,
 * unusable base URLs, and malformed weight-override lists are all usage
 * refusals; bare non-flag tokens are treated as flag values and ignored,
 * mirroring the registered entrypoint contract shared by every perf tool.
 */

import { API_SCENARIOS } from "@/scripts/perf/lib/api-scenarios";
import { scanFlagTokens } from "@/scripts/perf/lib/cli-flag-scan";
import { isLoadApiPlanError, type LoadApiRampSpec, parseWeightOverrides } from "@/scripts/perf/lib/load-api-plan";

/** CLI defaults (the registered plan-of-record invocation). */
export const LOAD_API_DEFAULTS = {
  vus: 100,
  durationS: 120,
  ramp: "10/5s",
  gateMs: 500,
} as const;

/** Self-check mode: tiny plumbing-verification run, no gate semantics. */
export const LOAD_API_SELF_CHECK = {
  vus: 2,
  durationS: 10,
} as const;

/** Accepted VU count bounds. */
export const LOAD_API_MIN_VUS = 1;
export const LOAD_API_MAX_VUS = 10_000;

/** Accepted steady-window bounds in seconds (1s .. 24h). */
export const LOAD_API_MIN_DURATION_S = 1;
export const LOAD_API_MAX_DURATION_S = 86_400;

/** Accepted p95 gate bounds in milliseconds. */
export const LOAD_API_MIN_GATE_MS = 1;
export const LOAD_API_MAX_GATE_MS = 60_000;

/** Ramp spec shape: `<count>/<seconds>s` — add `count` VUs every interval. */
export const LOAD_API_RAMP_PATTERN = /^([1-9]\d{0,3})\/([1-9]\d{0,3})s$/;
export const LOAD_API_RAMP_MAX_COUNT = 1_000;
export const LOAD_API_RAMP_MAX_SECONDS = 600;

/** Seed run selector shape (8 lowercase hex characters). */
export const LOAD_API_RUN_ID_PATTERN = /^[0-9a-f]{8}$/;

/** Validated CLI options (defaults applied, every value range-checked). */
export interface LoadApiCliOptions {
  readonly vus: number;
  readonly durationS: number;
  readonly ramp: LoadApiRampSpec;
  readonly rampSpec: string;
  readonly gateMs: number;
  readonly baseUrl: string | null;
  readonly weightsSpec: string | null;
  readonly runId: string | null;
  readonly selfCheck: boolean;
  readonly forceProdShapedTarget: boolean;
}

/** Usage refusal (unknown flag, bad value, malformed override list). */
export class LoadApiCliUsageError extends Error {
  readonly unknownFlags: readonly string[];

  constructor(message: string, unknownFlags: readonly string[] = []) {
    super(message);
    this.name = "LoadApiCliUsageError";
    this.unknownFlags = unknownFlags;
  }
}

/** Runtime guard narrowing a parse result to the usage-error arm. */
export function isLoadApiCliUsageError(value: unknown): value is LoadApiCliUsageError {
  return value instanceof LoadApiCliUsageError;
}

type LoadApiFlagKey = "vus" | "durationS" | "ramp" | "gateMs" | "baseUrl" | "weights" | "runId";
type LoadApiFlagValues = Partial<Record<LoadApiFlagKey, string>>;

const SCRIPT_LABEL = "perf:load-api";
const VALUE_FLAG_MAP: ReadonlyMap<string, LoadApiFlagKey> = new Map(
  Object.entries({
    "--vus": "vus",
    "--duration-s": "durationS",
    "--ramp": "ramp",
    "--gate-ms": "gateMs",
    "--base-url": "baseUrl",
    "--weights": "weights",
    "--run": "runId",
  })
);
const SELF_CHECK_FLAG = "--self-check";
const FORCE_FLAG = "--force-prod-shaped-target";
const HELP_FLAG = "--help";
const ACCEPTED_FLAGS = [...VALUE_FLAG_MAP.keys(), SELF_CHECK_FLAG, FORCE_FLAG, HELP_FLAG];

/** True when the invocation asks for the usage text instead of a run. */
export function isLoadApiHelpRequest(argv: readonly string[]): boolean {
  return argv.includes(HELP_FLAG);
}

/** Operator usage text: flags, preconditions, and the server contract. */
export const LOAD_API_HELP_TEXT = [
  `${SCRIPT_LABEL}: API load harness — weighted GraphQL scenario mix at N virtual users with a p95 gate.`,
  "",
  "Usage: bun run perf:load-api [--vus 100] [--duration-s 120] [--ramp 10/5s] [--gate-ms 500]",
  "                            [--base-url http://…] [--weights id=w,…] [--run <hex8>] [--self-check]",
  "",
  "Flags:",
  "  --vus <n>              concurrent virtual users (default 100)",
  "  --duration-s <n>       steady-state window in seconds after the ramp completes (default 120)",
  "  --ramp <count>/<seconds>s   add <count> VUs every <seconds> until --vus is reached (default 10/5s)",
  "  --gate-ms <n>          per-scenario p95 latency gate in ms (default 500)",
  "  --base-url <url>       reuse an already-running application server instead of booting one",
  "  --weights <spec>       scenario weight overrides, id=weight comma-separated (registry defaults otherwise)",
  "  --run <hex8>           seed run whose manifest provides the identities (default: newest completed run)",
  "  --self-check           tiny plumbing run (2 VUs x 10s) with no gate semantics",
  "  --force-prod-shaped-target  pass the destructive-target guard override through",
  "",
  "Scenarios (id, default weight): " + API_SCENARIOS.map(s => `${s.id}=${s.weight}`).join(", "),
  "",
  "Server contract: without --base-url the harness boots its own test server on port 3066",
  "(production mode when TEST_SERVER_MODE=production, development mode otherwise — mirror",
  "of the GraphQL test runner's boot env: TEST_SERVER=1 + IS_DEMO=true rate-limit bypass,",
  "NEXT_DIST_DIR per mode; production mode needs `bun run build:test` first).",
  "",
  "Gates: per-scenario p95 < --gate-ms AND zero transport errors; a FAIL captures a",
  "pg_stat_activity peak snapshot into the report.",
  "",
  "Preconditions: a completed seed run (perf:seed) with student + admin identities.",
].join("\n");

/** Collects flag/value pairs; unknown `--` tokens and missing values are usage errors. */
function collectFlagValues(
  argv: readonly string[]
): { raw: LoadApiFlagValues; unknownFlags: string[]; selfCheck: boolean; force: boolean } | LoadApiCliUsageError {
  const scan = scanFlagTokens(argv, VALUE_FLAG_MAP, new Set([SELF_CHECK_FLAG, FORCE_FLAG, HELP_FLAG]));
  if (scan.missingValueFlag !== null) {
    return new LoadApiCliUsageError(`${SCRIPT_LABEL}: ${scan.missingValueFlag} expects a value`, scan.unknownFlags);
  }
  return {
    raw: scan.raw,
    unknownFlags: scan.unknownFlags,
    selfCheck: scan.booleans.has(SELF_CHECK_FLAG),
    force: scan.booleans.has(FORCE_FLAG),
  };
}

/** Reads one count flag as a bounded positive integer (or its fallback). */
function readCountFlag(
  flag: string,
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
  usageErrors: LoadApiCliUsageError[]
): number {
  if (rawValue === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(rawValue)) {
    usageErrors.push(
      new LoadApiCliUsageError(`${SCRIPT_LABEL}: ${flag} expects a non-negative integer (got "${rawValue}")`)
    );
    return 0;
  }
  const parsed = Number(rawValue);
  if (parsed < min || parsed > max) {
    usageErrors.push(
      new LoadApiCliUsageError(`${SCRIPT_LABEL}: ${flag} must be between ${min} and ${max} (got "${rawValue}")`)
    );
    return 0;
  }
  return parsed;
}

/** Parses the ramp spec `<count>/<seconds>s` (undefined when the flag is absent). */
function readRampSpec(rawValue: string | undefined, usageErrors: LoadApiCliUsageError[]): LoadApiRampSpec | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const match = LOAD_API_RAMP_PATTERN.exec(rawValue);
  if (match === null) {
    usageErrors.push(
      new LoadApiCliUsageError(
        `${SCRIPT_LABEL}: --ramp must look like <count>/<seconds>s, e.g. 10/5s (got "${rawValue}")`
      )
    );
    return undefined;
  }
  const count = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  if (count > LOAD_API_RAMP_MAX_COUNT || seconds > LOAD_API_RAMP_MAX_SECONDS) {
    usageErrors.push(
      new LoadApiCliUsageError(
        `${SCRIPT_LABEL}: --ramp bounds are count <= ${LOAD_API_RAMP_MAX_COUNT}, seconds <= ${LOAD_API_RAMP_MAX_SECONDS} (got "${rawValue}")`
      )
    );
    return undefined;
  }
  return { count, intervalMs: seconds * 1000 };
}

/** Validates the base URL shape (absolute http(s) server root; undefined when absent). */
function readBaseUrl(rawValue: string | undefined, usageErrors: LoadApiCliUsageError[]): string | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("protocol");
    }
    return parsed.toString();
  } catch {
    usageErrors.push(
      new LoadApiCliUsageError(`${SCRIPT_LABEL}: --base-url must be an absolute http(s) URL (got "${rawValue}")`)
    );
    return undefined;
  }
}

/** Validates the seed-run selector (undefined when absent). */
function readRunId(rawValue: string | undefined, usageErrors: LoadApiCliUsageError[]): string | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!LOAD_API_RUN_ID_PATTERN.test(rawValue)) {
    usageErrors.push(
      new LoadApiCliUsageError(`${SCRIPT_LABEL}: --run must be exactly 8 lowercase hex characters (got "${rawValue}")`)
    );
    return undefined;
  }
  return rawValue;
}

/**
 * Parses the harness CLI into validated options or a usage refusal.
 * `--self-check` forces the tiny 2-VU/10s run; weight overrides must name
 * known scenarios and leave at least one positive weight in the mix.
 */
export function parseLoadApiCli(argv: readonly string[]): LoadApiCliOptions | LoadApiCliUsageError {
  const collected = collectFlagValues(argv);
  if (collected instanceof LoadApiCliUsageError) {
    return collected;
  }
  const { raw, unknownFlags, selfCheck, force } = collected;
  if (unknownFlags.length > 0) {
    return new LoadApiCliUsageError(
      `${SCRIPT_LABEL}: unknown flag(s): ${unknownFlags.join(", ")}\n${SCRIPT_LABEL}: accepted flags: ${ACCEPTED_FLAGS.join(", ")}`,
      unknownFlags
    );
  }
  const usageErrors: LoadApiCliUsageError[] = [];
  const vus = readCountFlag("--vus", raw.vus, LOAD_API_DEFAULTS.vus, LOAD_API_MIN_VUS, LOAD_API_MAX_VUS, usageErrors);
  const durationS = readCountFlag(
    "--duration-s",
    raw.durationS,
    LOAD_API_DEFAULTS.durationS,
    LOAD_API_MIN_DURATION_S,
    LOAD_API_MAX_DURATION_S,
    usageErrors
  );
  const gateMs = readCountFlag(
    "--gate-ms",
    raw.gateMs,
    LOAD_API_DEFAULTS.gateMs,
    LOAD_API_MIN_GATE_MS,
    LOAD_API_MAX_GATE_MS,
    usageErrors
  );
  const ramp = readRampSpec(raw.ramp, usageErrors);
  const baseUrl = readBaseUrl(raw.baseUrl, usageErrors);
  const runId = readRunId(raw.runId, usageErrors);
  if (usageErrors.length > 0) {
    return usageErrors[0] ?? new LoadApiCliUsageError(`${SCRIPT_LABEL}: invalid arguments`);
  }
  if (raw.weights !== undefined) {
    try {
      parseWeightOverrides(raw.weights);
    } catch (error) {
      if (isLoadApiPlanError(error)) {
        return new LoadApiCliUsageError(`${SCRIPT_LABEL}: ${error.message}`);
      }
      throw error;
    }
  }
  const activeRamp = ramp ?? { count: 10, intervalMs: 5000 };
  if (selfCheck) {
    return {
      vus: LOAD_API_SELF_CHECK.vus,
      durationS: LOAD_API_SELF_CHECK.durationS,
      ramp: activeRamp,
      rampSpec: raw.ramp ?? LOAD_API_DEFAULTS.ramp,
      gateMs,
      baseUrl: baseUrl ?? null,
      weightsSpec: raw.weights ?? null,
      runId: runId ?? null,
      selfCheck,
      forceProdShapedTarget: force,
    };
  }
  return {
    vus,
    durationS,
    ramp: activeRamp,
    rampSpec: raw.ramp ?? LOAD_API_DEFAULTS.ramp,
    gateMs,
    baseUrl: baseUrl ?? null,
    weightsSpec: raw.weights ?? null,
    runId: runId ?? null,
    selfCheck,
    forceProdShapedTarget: force,
  };
}
