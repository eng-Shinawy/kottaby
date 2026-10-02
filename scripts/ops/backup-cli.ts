/**
 * Command-line surface for the database backup script: strict flag parsing
 * and the operator-facing usage text. Unknown flags and missing values are
 * usage errors (exit code 2 upstream); `--help` prints the usage text.
 */

import { DEFAULT_ENV_FILE } from "@/scripts/dbActions/envFile";

export type ParsedBackupArgs =
  | { kind: "help" }
  | { kind: "ok"; envFile: string; outDir?: string }
  | { kind: "error"; message: string };

export function parseBackupArgs(argv: readonly string[]): ParsedBackupArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help" };
  }

  let envFile: string | undefined;
  let outDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== "--env" && arg !== "--out-dir") {
      return { kind: "error", message: `unknown argument "${arg}"` };
    }

    const value = argv[i + 1];
    const hasValue = i + 1 < argv.length;
    if (!hasValue || value.length === 0 || value.startsWith("--")) {
      const got = hasValue ? `"${value}"` : "none";
      return { kind: "error", message: `${arg} requires a value argument (got ${got})` };
    }

    if (arg === "--env") {
      if (envFile !== undefined) {
        return { kind: "error", message: "--env was given more than once" };
      }
      envFile = value;
    } else {
      if (outDir !== undefined) {
        return { kind: "error", message: "--out-dir was given more than once" };
      }
      outDir = value;
    }
    i += 1;
  }

  return { kind: "ok", envFile: envFile ?? DEFAULT_ENV_FILE, outDir };
}

export function buildUsageText(): string {
  return `
Logical database backup for the platform's Postgres database.

Produces a transactionally-consistent pg_dump custom-format artifact in a
timestamped run directory with a manifest.json (provenance, SHA-256, and
the migration-journal fingerprint).

Usage:
  bun run ops:db-backup [--env <env-file>] [--out-dir <dir>]
  bun run scripts/ops/backup-database.ts [--env <env-file>] [--out-dir <dir>]

Options:
  --env <file>      Env file to load (default: .env). Must define a
                    postgresql:// DATABASE_URL.
  --out-dir <dir>   Output directory (default: <repo>/backups).
                    Created if missing; artifacts are chmod 0600.
  --help            Show this help

Exit codes:
  0  backup published (artifact + manifest written)
  1  operational failure (pg_dump error, empty artifact, unexpected error)
  2  usage, environment, toolchain, lock-contention, or manifest-write failure

Example:
  bun run ops:db-backup --env .env.production --out-dir /var/backups/kottaby
`;
}
