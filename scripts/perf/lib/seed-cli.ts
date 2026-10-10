/**
 * CLI contract for the performance-data seeder: the accepted flag set, the
 * value/boolean flag split, and the validation rules. Unknown `--` tokens,
 * missing values, non-integer or out-of-range volumes, and malformed run
 * ids are all usage refusals; bare non-flag tokens are treated as flag
 * values and ignored, mirroring the registered entrypoint contract.
 */

import { MAX_ENTITY_COUNT, MAX_SEED_VALUE, RUN_ID_PATTERN, SEED_DEFAULTS } from "@/scripts/perf/lib/seed-shapes";

/** Validated CLI options (defaults applied, every value range-checked). */
export interface SeedCliOptions {
  readonly teachers: number;
  readonly students: number;
  readonly sessions: number;
  readonly notifications: number;
  readonly subscriptions: number;
  readonly hotTeachers: number;
  readonly runId: string | null;
  readonly seed: number;
  readonly forceProdShapedTarget: boolean;
}

/** Usage refusal (unknown flag, bad value, bad run id, inconsistent volumes). */
export class SeedCliUsageError extends Error {
  readonly unknownFlags: readonly string[];

  constructor(message: string, unknownFlags: readonly string[] = []) {
    super(message);
    this.name = "SeedCliUsageError";
    this.unknownFlags = unknownFlags;
  }
}

/** Runtime guard narrowing a parse result to the usage-error arm. */
export function isSeedCliUsageError(value: unknown): value is SeedCliUsageError {
  return value instanceof SeedCliUsageError;
}

type SeedFlagKey =
  | "teachers"
  | "students"
  | "sessions"
  | "notifications"
  | "subscriptions"
  | "hotTeachers"
  | "runId"
  | "seed";
type SeedFlagValues = Partial<Record<SeedFlagKey, string>>;

const SCRIPT_LABEL = "perf:seed";
const VALUE_FLAG_MAP: ReadonlyMap<string, SeedFlagKey> = new Map(
  Object.entries({
    "--teachers": "teachers",
    "--students": "students",
    "--sessions": "sessions",
    "--notifications": "notifications",
    "--subscriptions": "subscriptions",
    "--hot-teachers": "hotTeachers",
    "--run-id": "runId",
    "--seed": "seed",
  })
);
const FORCE_FLAG = "--force-prod-shaped-target";
const ACCEPTED_FLAGS = [...VALUE_FLAG_MAP.keys(), FORCE_FLAG];

/** Collects flag/value pairs; unknown `--` tokens and missing values are usage errors. */
function collectFlagValues(
  argv: readonly string[]
): { raw: SeedFlagValues; unknownFlags: string[]; force: boolean } | SeedCliUsageError {
  const raw: SeedFlagValues = {};
  const unknownFlags: string[] = [];
  let force = false;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    index += 1;
    if (!token.startsWith("--")) {
      continue;
    }
    if (token === FORCE_FLAG) {
      force = true;
      continue;
    }
    const key = VALUE_FLAG_MAP.get(token);
    if (key === undefined) {
      if (!unknownFlags.includes(token)) {
        unknownFlags.push(token);
      }
      continue;
    }
    const valueToken = argv[index];
    if (index >= argv.length || valueToken.startsWith("--")) {
      return new SeedCliUsageError(`${SCRIPT_LABEL}: ${token} expects a value`, unknownFlags);
    }
    raw[key] = valueToken;
    index += 1;
  }
  return { raw, unknownFlags, force };
}

/** Reads one volume flag as a bounded non-negative integer (or its fallback). */
function readCountFlag(
  flag: string,
  rawValue: string | undefined,
  fallback: number,
  max: number,
  usageErrors: SeedCliUsageError[]
): number {
  if (rawValue === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(rawValue)) {
    usageErrors.push(
      new SeedCliUsageError(`${SCRIPT_LABEL}: ${flag} expects a non-negative integer (got "${rawValue}")`)
    );
    return 0;
  }
  const parsed = Number(rawValue);
  if (parsed > max) {
    usageErrors.push(
      new SeedCliUsageError(`${SCRIPT_LABEL}: ${flag} exceeds the accepted maximum of ${max} (got "${rawValue}")`)
    );
    return 0;
  }
  return parsed;
}

/** Parses every volume flag plus the run id, accumulating usage refusals. */
function readSeedOptions(raw: SeedFlagValues): Omit<SeedCliOptions, "forceProdShapedTarget"> | SeedCliUsageError {
  const usageErrors: SeedCliUsageError[] = [];
  const teachers = readCountFlag("--teachers", raw.teachers, SEED_DEFAULTS.teachers, MAX_ENTITY_COUNT, usageErrors);
  const students = readCountFlag("--students", raw.students, SEED_DEFAULTS.students, MAX_ENTITY_COUNT, usageErrors);
  const sessions = readCountFlag("--sessions", raw.sessions, SEED_DEFAULTS.sessions, MAX_ENTITY_COUNT, usageErrors);
  const notifications = readCountFlag(
    "--notifications",
    raw.notifications,
    SEED_DEFAULTS.notifications,
    MAX_ENTITY_COUNT,
    usageErrors
  );
  const subscriptions = readCountFlag(
    "--subscriptions",
    raw.subscriptions,
    SEED_DEFAULTS.subscriptions,
    MAX_ENTITY_COUNT,
    usageErrors
  );
  const hotTeachers = readCountFlag(
    "--hot-teachers",
    raw.hotTeachers,
    SEED_DEFAULTS.hotTeachers,
    MAX_ENTITY_COUNT,
    usageErrors
  );
  const seed = readCountFlag("--seed", raw.seed, 0, MAX_SEED_VALUE, usageErrors);
  let runId: string | null = null;
  if (raw.runId !== undefined) {
    if (RUN_ID_PATTERN.test(raw.runId)) {
      runId = raw.runId;
    } else {
      usageErrors.push(
        new SeedCliUsageError(
          `${SCRIPT_LABEL}: --run-id must be exactly 8 lowercase hex characters (got "${raw.runId}")`
        )
      );
    }
  }
  if (usageErrors.length > 0) {
    return usageErrors[0];
  }
  if (hotTeachers > teachers) {
    return new SeedCliUsageError(
      `${SCRIPT_LABEL}: --hot-teachers must not exceed --teachers (${hotTeachers} > ${teachers})`
    );
  }
  if (sessions > 0 && (teachers === 0 || students === 0)) {
    return new SeedCliUsageError(`${SCRIPT_LABEL}: --sessions requires at least one teacher and one student`);
  }
  if (subscriptions > 0 && students === 0) {
    return new SeedCliUsageError(`${SCRIPT_LABEL}: --subscriptions requires at least one student`);
  }
  return { teachers, students, sessions, notifications, subscriptions, hotTeachers, runId, seed };
}

/**
 * Parses the seeder CLI into validated options or a usage refusal. Value-less
 * `--flag`-shaped tokens that are not part of the accepted set are usage
 * errors; non-`--` tokens are flag values and are otherwise ignored.
 */
export function parseSeedCli(argv: readonly string[]): SeedCliOptions | SeedCliUsageError {
  const collected = collectFlagValues(argv);
  if (collected instanceof SeedCliUsageError) {
    return collected;
  }
  const { raw, unknownFlags, force } = collected;
  if (unknownFlags.length > 0) {
    return new SeedCliUsageError(
      `${SCRIPT_LABEL}: unknown flag(s): ${unknownFlags.join(", ")}\n${SCRIPT_LABEL}: accepted flags: ${ACCEPTED_FLAGS.join(", ")}`,
      unknownFlags
    );
  }
  const options = readSeedOptions(raw);
  if (options instanceof SeedCliUsageError) {
    return options;
  }
  return { ...options, forceProdShapedTarget: force };
}
