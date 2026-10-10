/**
 * CLI contract for the WebSocket stability harness: the accepted flag set,
 * the value/boolean flag split, and the validation rules. Unknown `--`
 * tokens, missing values, non-integer or out-of-range counts, malformed ramp
 * specs, and unusable base URLs are all usage refusals; bare non-flag tokens
 * are treated as flag values and ignored, mirroring the registered
 * entrypoint contract shared by every perf tool.
 */

import { scanFlagTokens } from "@/scripts/perf/lib/cli-flag-scan";

/** CLI defaults (the registered plan-of-record invocation). */
export const LOAD_WS_DEFAULTS = {
  connections: 100,
  identities: 21,
  durationS: 300,
  ramp: "5/2s",
  fanoutBursts: 3,
  baseUrl: "http://127.0.0.1:3000",
} as const;

/**
 * Identity floor: every run uses at least this many distinct seeded
 * identities so a 100-connection run never saturates any single user's
 * connection cap (the server evicts the oldest socket at the cap).
 */
export const LOAD_WS_MIN_IDENTITIES = 21;

/** Identity ceiling: the seed manifest caps the websocket identity list at 25. */
export const LOAD_WS_MAX_IDENTITIES = 25;

/** Upper bound accepted for the connection count (the server's global cap is env-driven). */
export const LOAD_WS_MAX_CONNECTIONS = 10_000;

/** Stability-window bounds in seconds (1s .. 24h — 3600 produces the soak evidence). */
export const LOAD_WS_MIN_DURATION_S = 1;
export const LOAD_WS_MAX_DURATION_S = 86_400;

/** Upper bound accepted for the fan-out burst count. */
export const LOAD_WS_MAX_FANOUT_BURSTS = 100;

/** Ramp spec shape: `<burst>/<interval>s` (e.g. `5/2s` — burst of 5, then 1 per 2s). */
export const RAMP_SPEC_PATTERN = /^([1-9]\d{0,2})\/([1-9]\d{0,2})s$/;

/** The default ramp spec, parsed once from its documented string form. */
export const DEFAULT_RAMP: LoadWsRampSpec = {
  burst: Number(RAMP_SPEC_PATTERN.exec(LOAD_WS_DEFAULTS.ramp)?.[1] ?? 5),
  intervalMs: Number(RAMP_SPEC_PATTERN.exec(LOAD_WS_DEFAULTS.ramp)?.[2] ?? 2) * 1000,
};

/** Parsed ramp: immediate burst capacity, then one connection per interval. */
export interface LoadWsRampSpec {
  readonly burst: number;
  readonly intervalMs: number;
}

/** Validated CLI options (defaults applied, every value range-checked). */
export interface LoadWsCliOptions {
  readonly connections: number;
  readonly identities: number;
  readonly durationS: number;
  readonly ramp: LoadWsRampSpec;
  readonly rampSpec: string;
  readonly fanoutBursts: number;
  readonly baseUrl: string;
  readonly runId: string | null;
  readonly noReconnect: boolean;
  readonly forceProdShapedTarget: boolean;
}

/** Usage refusal (unknown flag, bad value, cap-math violation). */
export class LoadWsCliUsageError extends Error {
  readonly unknownFlags: readonly string[];

  constructor(message: string, unknownFlags: readonly string[] = []) {
    super(message);
    this.name = "LoadWsCliUsageError";
    this.unknownFlags = unknownFlags;
  }
}

/** Runtime guard narrowing a parse result to the usage-error arm. */
export function isLoadWsCliUsageError(value: unknown): value is LoadWsCliUsageError {
  return value instanceof LoadWsCliUsageError;
}

/** Parse the semantic run id selector (8 lowercase hex characters). */
export const LOAD_WS_RUN_ID_PATTERN = /^[0-9a-f]{8}$/;

type LoadWsFlagKey = "connections" | "identities" | "durationS" | "ramp" | "fanoutBursts" | "baseUrl" | "runId";
type LoadWsFlagValues = Partial<Record<LoadWsFlagKey, string>>;

const SCRIPT_LABEL = "perf:load-ws";
const VALUE_FLAG_MAP: ReadonlyMap<string, LoadWsFlagKey> = new Map(
  Object.entries({
    "--connections": "connections",
    "--identities": "identities",
    "--duration-s": "durationS",
    "--ramp": "ramp",
    "--fanout-bursts": "fanoutBursts",
    "--base-url": "baseUrl",
    "--run": "runId",
  })
);
const NO_RECONNECT_FLAG = "--no-reconnect";
const FORCE_FLAG = "--force-prod-shaped-target";
const HELP_FLAG = "--help";
const ACCEPTED_FLAGS = [...VALUE_FLAG_MAP.keys(), NO_RECONNECT_FLAG, FORCE_FLAG, HELP_FLAG];

/** True when the invocation asks for the usage text instead of a run. */
export function isLoadWsHelpRequest(argv: readonly string[]): boolean {
  return argv.includes(HELP_FLAG);
}

/** Operator usage text: flags, preconditions, and both sidecar paths. */
export const LOAD_WS_HELP_TEXT = [
  `${SCRIPT_LABEL}: WebSocket stability harness — authenticated connections, heartbeat window, fan-out delivery proof.`,
  "",
  "Usage: bun run perf:load-ws [--connections 100] [--identities 21] [--duration-s 300] [--ramp 5/2s] [--fanout-bursts 3] [--no-reconnect]",
  "",
  "Flags:",
  "  --connections <n>      authenticated connections to hold (default 100)",
  "  --identities <n>        distinct seeded identities, 21..25 (default 21; per-user server cap applies)",
  "  --duration-s <n>        stability window in seconds (default 300; 3600 is the one-hour soak)",
  "  --ramp <burst>/<seconds>s   handshake ramp honoring the sidecar token bucket (default 5/2s: burst of 5, then 1 per 2s)",
  "  --fanout-bursts <n>     fan-out bursts published through Redis during the window (default 3)",
  "  --base-url <url>        application server root used to mint sessions via the real login mutation (default http://127.0.0.1:3000)",
  "  --run <hex8>            seed run whose manifest provides the identities (default: newest manifest under logs/perf)",
  "  --no-reconnect          never re-open a dropped connection (this is always the behavior; drops stay observable)",
  "  --force-prod-shaped-target  pass the destructive-target guard override through",
  "",
  "Preconditions: a completed seed run (perf:seed) for identities, a reachable application",
  "server at --base-url, and the Redis bus (REDIS_URL) the sidecar subscribes to — the",
  "harness refuses to run when the fan-out transport resolves to in-process.",
  "",
  "Sidecar: when nothing listens on the configured WS host/port the harness boots the",
  "sidecar itself (bun scripts/start-notification-ws.ts) with the harness-resolved",
  "WS_HOST/WS_PORT/WS_ALLOWED_ORIGINS/REDIS_URL and tears it down on exit; an already-",
  "listening sidecar is reused as-is.",
  "",
  "Soak command (one-hour evidence run): bun run perf:load-ws --duration-s 3600",
].join("\n");

/** Collects flag/value pairs; unknown `--` tokens and missing values are usage errors. */
function collectFlagValues(
  argv: readonly string[]
): { raw: LoadWsFlagValues; unknownFlags: string[]; noReconnect: boolean; force: boolean } | LoadWsCliUsageError {
  const scan = scanFlagTokens(argv, VALUE_FLAG_MAP, new Set([NO_RECONNECT_FLAG, FORCE_FLAG, HELP_FLAG]));
  if (scan.missingValueFlag !== null) {
    return new LoadWsCliUsageError(`${SCRIPT_LABEL}: ${scan.missingValueFlag} expects a value`, scan.unknownFlags);
  }
  return {
    raw: scan.raw,
    unknownFlags: scan.unknownFlags,
    noReconnect: scan.booleans.has(NO_RECONNECT_FLAG),
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
  usageErrors: LoadWsCliUsageError[]
): number {
  if (rawValue === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(rawValue)) {
    usageErrors.push(
      new LoadWsCliUsageError(`${SCRIPT_LABEL}: ${flag} expects a non-negative integer (got "${rawValue}")`)
    );
    return 0;
  }
  const parsed = Number(rawValue);
  if (parsed < min || parsed > max) {
    usageErrors.push(
      new LoadWsCliUsageError(`${SCRIPT_LABEL}: ${flag} must be between ${min} and ${max} (got "${rawValue}")`)
    );
    return 0;
  }
  return parsed;
}

/** Parses the ramp spec `<burst>/<intervalMs>s` (undefined when the flag is absent). */
function readRampSpec(rawValue: string | undefined, usageErrors: LoadWsCliUsageError[]): LoadWsRampSpec | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const match = RAMP_SPEC_PATTERN.exec(rawValue);
  if (match === null) {
    usageErrors.push(
      new LoadWsCliUsageError(
        `${SCRIPT_LABEL}: --ramp must look like <burst>/<intervalMs>s, e.g. 5/2s (got "${rawValue}")`
      )
    );
    return undefined;
  }
  return { burst: Number(match[1] ?? 0), intervalMs: Number(match[2] ?? 0) * 1000 };
}

/** Validates the base URL shape (absolute http(s) server root; undefined when absent). */
function readBaseUrl(rawValue: string | undefined, usageErrors: LoadWsCliUsageError[]): string | undefined {
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
      new LoadWsCliUsageError(`${SCRIPT_LABEL}: --base-url must be an absolute http(s) URL (got "${rawValue}")`)
    );
    return undefined;
  }
}

/** Parses every flag into validated options or the first accumulated usage error. */
function readLoadWsOptions(
  raw: LoadWsFlagValues,
  context: { readonly perUserCap: number }
): Omit<LoadWsCliOptions, "noReconnect" | "forceProdShapedTarget"> | LoadWsCliUsageError {
  const usageErrors: LoadWsCliUsageError[] = [];
  const connections = readCountFlag(
    "--connections",
    raw.connections,
    LOAD_WS_DEFAULTS.connections,
    1,
    LOAD_WS_MAX_CONNECTIONS,
    usageErrors
  );
  const identities = readCountFlag(
    "--identities",
    raw.identities,
    LOAD_WS_DEFAULTS.identities,
    LOAD_WS_MIN_IDENTITIES,
    LOAD_WS_MAX_IDENTITIES,
    usageErrors
  );
  const durationS = readCountFlag(
    "--duration-s",
    raw.durationS,
    LOAD_WS_DEFAULTS.durationS,
    LOAD_WS_MIN_DURATION_S,
    LOAD_WS_MAX_DURATION_S,
    usageErrors
  );
  const fanoutBursts = readCountFlag(
    "--fanout-bursts",
    raw.fanoutBursts,
    LOAD_WS_DEFAULTS.fanoutBursts,
    0,
    LOAD_WS_MAX_FANOUT_BURSTS,
    usageErrors
  );
  const ramp = readRampSpec(raw.ramp, usageErrors);
  const baseUrl = readBaseUrl(raw.baseUrl, usageErrors);
  let runId: string | null = null;
  if (raw.runId !== undefined) {
    if (LOAD_WS_RUN_ID_PATTERN.test(raw.runId)) {
      runId = raw.runId;
    } else {
      usageErrors.push(
        new LoadWsCliUsageError(
          `${SCRIPT_LABEL}: --run must be exactly 8 lowercase hex characters (got "${raw.runId}")`
        )
      );
    }
  }
  if (usageErrors.length > 0) {
    return usageErrors[0] ?? new LoadWsCliUsageError(`${SCRIPT_LABEL}: invalid arguments`);
  }
  if (connections > identities * context.perUserCap) {
    return new LoadWsCliUsageError(
      `${SCRIPT_LABEL}: --connections ${connections} exceeds the per-user cap math ` +
        `(${identities} identities x ${context.perUserCap} connections each = ${identities * context.perUserCap})`
    );
  }
  return {
    connections,
    identities,
    durationS,
    ramp: ramp ?? DEFAULT_RAMP,
    rampSpec: raw.ramp ?? LOAD_WS_DEFAULTS.ramp,
    fanoutBursts,
    baseUrl: baseUrl ?? new URL(LOAD_WS_DEFAULTS.baseUrl).toString(),
    runId,
  };
}

/**
 * Parses the harness CLI into validated options or a usage refusal. The
 * per-user connection cap comes from the sidecar's env seam (caller-supplied
 * context; default 5) so the identity/connection cap math matches the server
 * that will enforce it.
 */
export function parseLoadWsCli(
  argv: readonly string[],
  context: { readonly perUserCap?: number } = {}
): LoadWsCliOptions | LoadWsCliUsageError {
  const collected = collectFlagValues(argv);
  if (collected instanceof LoadWsCliUsageError) {
    return collected;
  }
  const { raw, unknownFlags, noReconnect, force } = collected;
  if (unknownFlags.length > 0) {
    return new LoadWsCliUsageError(
      `${SCRIPT_LABEL}: unknown flag(s): ${unknownFlags.join(", ")}\n${SCRIPT_LABEL}: accepted flags: ${ACCEPTED_FLAGS.join(", ")}`,
      unknownFlags
    );
  }
  const options = readLoadWsOptions(raw, { perUserCap: context.perUserCap ?? 5 });
  if (isLoadWsCliUsageError(options)) {
    return options;
  }
  return { ...options, noReconnect, forceProdShapedTarget: force };
}
