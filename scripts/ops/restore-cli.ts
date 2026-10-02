/**
 * CLI argument parsing for the restore-verify tool.
 *
 * Kept separate from the orchestrator so argument branches can be exercised
 * without spawning anything. Parsing is strict: an operator who mistypes an
 * option must fail loudly instead of silently restoring against a default.
 * There is NO default target database — `--target` is always required.
 *
 * Exit-code contract (enforced by the caller):
 *   0  verdict PASS (or --help)
 *   1  verdict FAIL / restore error / artifact hash mismatch
 *   2  usage error, env bootstrap error, or guard refusal
 */

/** Thrown when the argument vector violates the usage contract (exit 2). */
export class RestoreUsageError extends Error {}

/** Parsed CLI arguments for `restore-verify`. */
export interface RestoreCliArgs {
  /** `--help` / `-h` was passed. */
  showHelp: boolean;
  /** Env file from `--env` (source-database context for comparisons). */
  envFile: string | null;
  /** Backup run directory or direct dump artifact from `--from`. */
  from: string | null;
  /** Restore destination connection string from `--target`. Required. */
  targetDsn: string | null;
  /** Non-interactive confirmation gate `--yes-i-understand`. */
  confirmed: boolean;
}

/** Flags that take a value; the value may be inline (`--flag=v`) or the next argv. */
const VALUE_FLAGS = new Set(["--env", "--from", "--target"]);

function emptyArgs(): RestoreCliArgs {
  return { showHelp: false, envFile: null, from: null, targetDsn: null, confirmed: false };
}

function requireValue(flag: string, inlineValue: string | undefined, nextArg: string | undefined): string {
  const value = inlineValue ?? nextArg;
  // Mirror backup-cli: report the ACTUAL offending value — a flag-like value
  // ("--target --yes-i-understand") is present but unacceptable, so "got
  // none" would lie to the operator.
  if (value === undefined || value === "") {
    throw new RestoreUsageError(`${flag} requires a value argument (got none).`);
  }
  if (value.startsWith("--")) {
    throw new RestoreUsageError(`${flag} requires a value argument (got the flag-like value "${value}").`);
  }
  return value;
}

/**
 * Parses the raw argv slice (typically `process.argv.slice(2)`).
 *
 * Accepts `--flag value` and `--flag=value` forms. Unknown arguments,
 * duplicates, and missing values throw {@link RestoreUsageError}; the caller
 * prints usage text and exits 2. `--help` does not short-circuit other
 * parsing so a malformed help invocation still surfaces the problem.
 */
export function parseRestoreArgs(argv: string[]): RestoreCliArgs {
  const parsed = emptyArgs();

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.showHelp = true;
      continue;
    }

    if (arg === "--yes-i-understand") {
      if (parsed.confirmed) {
        throw new RestoreUsageError("--yes-i-understand was given more than once.");
      }
      parsed.confirmed = true;
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const flag = equalsIndex > 0 ? arg.slice(0, equalsIndex) : arg;

    if (!VALUE_FLAGS.has(flag)) {
      throw new RestoreUsageError(`unknown argument "${arg}". Pass --help for usage.`);
    }

    const inlineValue = equalsIndex > 0 ? arg.slice(equalsIndex + 1) : undefined;
    const nextArg = inlineValue === undefined ? argv[index + 1] : undefined;
    const value = requireValue(flag, inlineValue, nextArg);
    if (inlineValue === undefined) {
      index++;
    }

    if (flag === "--env") {
      if (parsed.envFile !== null) {
        throw new RestoreUsageError("--env was given more than once.");
      }
      parsed.envFile = value;
    } else if (flag === "--from") {
      if (parsed.from !== null) {
        throw new RestoreUsageError("--from was given more than once.");
      }
      parsed.from = value;
    } else {
      if (parsed.targetDsn !== null) {
        throw new RestoreUsageError("--target was given more than once.");
      }
      parsed.targetDsn = value;
    }
  }

  return parsed;
}

/** Usage text (also the --help body). */
export const RESTORE_USAGE_TEXT = `
Restore a verified database backup into an explicit scratch/staging target
and prove post-restore integrity (structure + read-only invariant oracles).

Usage:
  bun run scripts/ops/restore-verify.ts --from <runDir|dump.pgc> --target <dsn> --yes-i-understand
      [--env <env-file>]

Required:
  --from <runDir|artifact>   Backup run directory (manifest.json + dump) or a
                             direct dump artifact whose manifest.json sits beside it.
  --target <dsn>             Restore destination Postgres connection string.
                             REQUIRED — there is no default — and it must NAME
                             the target database (a DSN without a database
                             component is refused: ambient PGDATABASE would
                             complete the endpoint). A URI query ?dbname=
                             parameter names the target database (a path/query
                             dbname disagreement is refused). Must be a
                             scratch/staging database; the restore DROPS and
                             recreates public objects (--clean --if-exists).
  --yes-i-understand         Explicit non-interactive confirmation of the
                             destructive restore; refused without it.

Options:
  --env <file>               Env file providing source-database context
                             (DATABASE_URL) for row-count comparisons. When
                             omitted, .env is attempted and its absence is
                             non-fatal (comparisons are skipped).
  --help, -h                 Show this help.

Exit codes:
  0  VERDICT: PASS
  1  VERDICT: FAIL, restore failure, or artifact verification failure
  2  usage error, env bootstrap error, or safety-guard refusal
`.trimStart();
