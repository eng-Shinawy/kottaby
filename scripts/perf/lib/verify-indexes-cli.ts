/**
 * CLI contract for the index verification tool: a single `--json` flag
 * that switches stdout to machine-readable output. Unknown `--` tokens
 * are usage refusals (exit 2, mirroring the harness guard's refusal
 * code) and list the accepted flags; bare non-flag tokens are treated as
 * stray values and ignored, mirroring the registered entrypoint
 * contract every perf tool shares.
 */

/** Validated CLI options for the index audit. */
export interface VerifyIndexesCliOptions {
  readonly json: boolean;
}

/** Usage refusal (unknown flag). */
export class VerifyIndexesCliUsageError extends Error {
  readonly unknownFlags: readonly string[];

  constructor(message: string, unknownFlags: readonly string[] = []) {
    super(message);
    this.name = "VerifyIndexesCliUsageError";
    this.unknownFlags = unknownFlags;
  }
}

/** Runtime guard narrowing a parse result to the usage-error arm. */
export function isVerifyIndexesCliUsageError(value: unknown): value is VerifyIndexesCliUsageError {
  return value instanceof VerifyIndexesCliUsageError;
}

const SCRIPT_LABEL = "perf:verify-indexes";
const JSON_FLAG = "--json";
const ACCEPTED_FLAGS = [JSON_FLAG];

/**
 * Parses the index-audit CLI into validated options or a usage refusal.
 * The tool takes no value-bearing flags, so any non-`--` token is a
 * leftover value and ignored rather than rejected.
 */
export function parseVerifyIndexesCli(argv: readonly string[]): VerifyIndexesCliOptions | VerifyIndexesCliUsageError {
  const unknownFlags: string[] = [];
  let json = false;
  for (const token of argv) {
    if (!token.startsWith("--")) {
      continue;
    }
    if (token === JSON_FLAG) {
      json = true;
      continue;
    }
    if (!unknownFlags.includes(token)) {
      unknownFlags.push(token);
    }
  }
  if (unknownFlags.length > 0) {
    return new VerifyIndexesCliUsageError(
      `${SCRIPT_LABEL}: unknown flag(s): ${unknownFlags.join(", ")}\n${SCRIPT_LABEL}: accepted flags: ${ACCEPTED_FLAGS.join(", ")}`,
      unknownFlags
    );
  }
  return { json };
}
