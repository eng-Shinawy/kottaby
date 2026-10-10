/**
 * Shared `--flag` argument parsing for the `scripts/load/` CLI tools.
 *
 * Contract: every tool takes `--name value` string/number flags plus
 * optional boolean flags (`--name` with no value). Unknown flags and
 * missing required values print the tool's usage block and return `null`
 * (the caller exits non-zero) — a malformed invocation never silently
 * falls back to defaults.
 */

/** One declared CLI flag. */
export interface LoadArgSpec {
  readonly name: string;
  readonly kind: "string" | "number" | "boolean";
  readonly required?: boolean;
  readonly default?: string | number;
  readonly help: string;
}

/** Accessors for parsed CLI arguments. */
export interface ParsedLoadArgs {
  string(name: string): string | undefined;
  number(name: string): number | undefined;
  flag(name: string): boolean;
}

/** Parse errors land here — the message is printed alongside usage. */
export class LoadCliUsageError extends Error {}

function printUsage(scriptName: string, specs: readonly LoadArgSpec[]): void {
  console.log(`Usage: bun run scripts/load/${scriptName} [flags]`);
  for (const spec of specs) {
    const required = spec.required === true ? " (required)" : "";
    let fallback = "";
    if (spec.kind !== "boolean" && spec.default !== undefined) {
      fallback = ` (default: ${String(spec.default)})`;
    }
    console.log(`  --${spec.name}${spec.kind === "boolean" ? "" : " <value>"}${required}${fallback}  ${spec.help}`);
  }
}

/**
 * Parses `process.argv` against the declared specs.
 * Returns `null` (after printing usage) on any usage violation.
 */
export function parseLoadCliArgs(scriptName: string, specs: readonly LoadArgSpec[]): ParsedLoadArgs | null {
  const byName = new Map(specs.map(spec => [spec.name, spec]));
  const values = new Map<string, string | number | boolean>();
  let failure: string | null = null;

  const rawArgs = process.argv.slice(2);
  for (let i = 0; i < rawArgs.length && failure === null; i += 1) {
    const token = rawArgs[i];
    if (!token.startsWith("--")) {
      failure = `unexpected positional argument "${token}"`;
      break;
    }
    const name = token.slice(2);
    const spec = byName.get(name);
    if (spec === undefined) {
      failure = `unknown flag --${name}`;
      break;
    }
    if (spec.kind === "boolean") {
      values.set(name, true);
      continue;
    }
    const valueIndex = i + 1;
    if (valueIndex >= rawArgs.length) {
      failure = `--${name} requires a value`;
      break;
    }
    const valueToken = rawArgs[valueIndex];
    i += 1;
    if (spec.kind === "number") {
      const parsed = Number(valueToken);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        failure = `--${name} must be a positive number (got "${valueToken}")`;
        break;
      }
      values.set(name, parsed);
    } else {
      values.set(name, valueToken);
    }
  }

  if (failure === null) {
    for (const spec of specs) {
      if (values.has(spec.name)) {
        continue;
      }
      if (spec.default !== undefined) {
        values.set(spec.name, spec.default);
        continue;
      }
      if (spec.required === true) {
        failure = `--${spec.name} is required`;
        break;
      }
    }
  }

  if (failure !== null) {
    console.error(`[load] ${scriptName}: ${failure}`);
    printUsage(scriptName, specs);
    return null;
  }

  return {
    string(name: string): string | undefined {
      const value = values.get(name);
      return typeof value === "string" ? value : undefined;
    },
    number(name: string): number | undefined {
      const value = values.get(name);
      return typeof value === "number" ? value : undefined;
    },
    flag(name: string): boolean {
      return values.get(name) === true;
    },
  };
}
