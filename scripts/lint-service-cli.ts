/**
 * LINT SERVICE CLI — argument parsing and output rendering
 *
 * The runnable CLI surface of scripts/lint-service.ts. Extracted so that
 * lint-service.ts stays focused on the queue + ESLint executor; the only hook
 * back into the service is runLintCli(), invoked from lint-service.ts when it
 * runs as the main module (`bun run scripts/lint-service.ts ...`).
 */

import { parseArgs } from "node:util";
import type { LintExecutionResult, LintOptions } from "@/scripts/lint-service-config";

/** Matches requestLintWithMetrics() in lint-service.ts; injected to avoid a module cycle. */
export type LintRequestRunner = (id: string, files?: string[], options?: LintOptions) => Promise<LintExecutionResult>;

function getUnknownErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) {
    return undefined;
  }
  const code = Reflect.get(err, "code");
  return typeof code === "string" ? code : undefined;
}

function printHelp(): void {
  console.log(`
Lint Service — Unified In-Process ESLint CLI

Usage:
  bun run scripts/lint-service.ts [options]

Options:
  -f, --files <path>     File to lint (repo-relative). Repeat for multiple files.
                         Omit for full-repo lint via eslint.config.js.
  -i, --id <string>      Caller identifier (default: "cli")
  --fix                  Apply ESLint auto-fixes
  --json                 Output result as JSON (includes metrics)
  --type-aware           Enable type-aware mode (implies --max-warnings=0)
  --max-warnings <num>   Fail if warnings exceed this count (default: 0, or -1 to disable)
  -v, --verbose          Log queue state and timing to stderr
  -h, --help             Show this help

Exit codes:
  0 = ESLint passed (no errors)
  1 = ESLint reported problems
  2 = Invalid arguments or service fault

Examples:
  bun run scripts/lint-service.ts                         # Full-repo lint (--max-warnings=0)
  bun run scripts/lint-service.ts -f src/foo.ts          # Single file
  bun run scripts/lint-service.ts -f a.ts -f b.ts        # Multiple files
  bun run scripts/lint-service.ts --fix                  # Full-repo with auto-fix
  bun run scripts/lint-service.ts -f file.ts --json      # JSON output
`);
}

function writeLintResult(result: LintExecutionResult, json: boolean, verbose: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  process.stdout.write(result.output || "");
  if (verbose) {
    console.error(`\n[lint-service] Duration: ${result.metrics.durationMs}ms`);
    console.error(`[lint-service] Queue depth at enqueue: ${result.metrics.queueDepthAtEnqueue}`);
  }
}

function handleCliError(err: unknown): never {
  if (getUnknownErrorCode(err) === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    console.error("Error: Invalid arguments\n");
    printHelp();
    process.exit(2);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  if (process.argv.includes("--verbose") || process.argv.includes("-v")) {
    const stack = err instanceof Error ? err.stack : undefined;
    if (stack) console.error(stack);
  }
  process.exit(2);
}

/** Run the lint-service CLI against process.argv. Never returns on error paths (process.exit). */
export async function runLintCli(requestLintWithMetrics: LintRequestRunner): Promise<void> {
  try {
    const args = parseArgs({
      options: {
        files: { type: "string", short: "f", multiple: true },
        id: { type: "string", short: "i", default: "cli" },
        fix: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        "type-aware": { type: "boolean", default: false },
        "max-warnings": { type: "string", default: undefined },
        verbose: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    });

    if (args.values.help) {
      printHelp();
      process.exit(0);
    }

    const files = args.values.files ?? [];
    const id = args.values.id ?? "cli";
    const fix = args.values.fix ?? false;
    const json = args.values.json ?? false;
    const typeAware = args.values["type-aware"] ?? false;
    const verbose = args.values.verbose ?? false;

    // Resolve maxWarnings: CLI flag takes precedence; otherwise default to 0 (fail on any warning).
    // Use -1 to explicitly allow unlimited warnings.
    let maxWarnings: number | undefined;
    if (args.values["max-warnings"] !== undefined) {
      maxWarnings = Number.parseInt(args.values["max-warnings"], 10);
    } else {
      maxWarnings = 0;
    }

    const result = await requestLintWithMetrics(id, files, { fix, json, verbose, typeAware, maxWarnings });
    writeLintResult(result, json, verbose);
    process.exit(result.exitCode);
  } catch (err: unknown) {
    handleCliError(err);
  }
}
