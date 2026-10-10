/**
 * Shared argv flag scanner for perf harness CLIs: walks `--` tokens,
 * records boolean flags, binds value flags to their raw string values, and
 * reports unknown flags plus value flags invoked without a value — the
 * scan scaffold each tool's CLI wraps with its own flag set, usage-error
 * class, and validation rules.
 */

export interface FlagScanOutcome<TKey extends string> {
  readonly raw: Partial<Record<TKey, string>>;
  readonly unknownFlags: string[];
  readonly booleans: ReadonlySet<string>;
  readonly missingValueFlag: string | null;
}

/**
 * Scans argv left to right. Bare non-flag tokens are skipped (they are
 * flag values already consumed or stray values, per the entrypoint
 * contract). Scanning stops at the first value flag that lacks a value so
 * callers can raise their usage refusal with the flags seen so far.
 */
export function scanFlagTokens<TKey extends string>(
  argv: readonly string[],
  valueFlagMap: ReadonlyMap<string, TKey>,
  booleanFlags: ReadonlySet<string>
): FlagScanOutcome<TKey> {
  const raw: Partial<Record<TKey, string>> = {};
  const unknownFlags: string[] = [];
  const booleans = new Set<string>();
  let missingValueFlag: string | null = null;
  let index = 0;
  while (missingValueFlag === null && index < argv.length) {
    const token = argv[index] ?? "";
    index += 1;
    if (!token.startsWith("--")) {
      continue;
    }
    if (booleanFlags.has(token)) {
      booleans.add(token);
      continue;
    }
    const key = valueFlagMap.get(token);
    if (key === undefined) {
      if (!unknownFlags.includes(token)) {
        unknownFlags.push(token);
      }
      continue;
    }
    const valueToken = argv[index];
    if (index >= argv.length || valueToken.startsWith("--")) {
      missingValueFlag = token;
      continue;
    }
    raw[key] = valueToken;
    index += 1;
  }
  return { raw, unknownFlags, booleans, missingValueFlag };
}
