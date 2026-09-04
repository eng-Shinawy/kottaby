#!/usr/bin/env bun
/**
 * On-demand ops trigger for the parent-link expiry sweep PRIMITIVE.
 *
 * Materializes EVERY lapsed live pending parent link request to `expired` in
 * ONE atomic, idempotent bulk statement — the canonical doc's sanctioned
 * manual path while the cron STREAM is not yet wired
 * (docs/parents/parent-link-request.md §5: "sweeps are invoked by ops on
 * demand"). The future cron-stream job handler registers the SAME service
 * primitive (`ParentLinkRequestService.sweepExpiredRequests`) on a schedule.
 *
 * Semantics (canonical doc §5, the expiry rule):
 *  - Actor-less (system scope) and SILENT: zero notifications, zero audit
 *    rows). This script's stdout line is the ops record.
 *  - Idempotent by predicate: a re-run materializes 0 rows.
 *  - Strict-`>` liveness boundary: a pending with `expires_at <= now` has
 *    lapsed and is materialized.
 *  - A successful run LIFTS the silent-expiry re-request lockout (canonical doc §5):
 *    after materialization the pair's pending arbiter collapses and a fresh
 *    `requestLink` succeeds.
 *
 * Usage:
 *   bun run ops:sweep-link-requests
 *   bun run scripts/ops/sweep-expired-link-requests.ts [--env <env-file>]
 *
 * Exit codes: 0 = sweep ran (any row count); 1 = bootstrap or sweep failure.
 */

import { applyEnvFile } from "@/scripts/dbActions/envFile";

function printHelp(): void {
  console.log(`
On-demand ops trigger for the parent-link expiry sweep primitive.

Usage:
  bun run ops:sweep-link-requests
  bun run scripts/ops/sweep-expired-link-requests.ts [--env <env-file>]

Options:
  --env <file>   Env file to load (default: .env)
  --help         Show this help

The sweep is atomic, idempotent, and silent (no notifications, no audit
rows). A successful run materializes every lapsed live pending parent link
request to \`expired\` and lifts the silent-expiry re-request lockout for
the affected pairs (canonical doc §5).
`);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

// Strict argument validation: an operator who mistypes the environment
// option must fail loudly instead of silently sweeping the default
// database. `--env` REQUIRES a file value; every other non-help argument
// is rejected outright (no silent defaults for malformed input).
let envFile = ".env";
let sawEnv = false;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--env") {
    if (sawEnv) {
      console.error("[ops:sweep] --env was given more than once. Pass --help for usage.");
      process.exit(1);
    }
    const hasNext = i + 1 < argv.length;
    const value = hasNext ? argv[i + 1] : "";
    if (!hasNext || value.startsWith("--")) {
      const got = hasNext ? `"${value}"` : "none";
      console.error(`[ops:sweep] --env requires a file argument (got ${got}). Pass --help for usage.`);
      process.exit(1);
    }
    envFile = value;
    sawEnv = true;
    i += 1;
    continue;
  }
  console.error(`[ops:sweep] unknown argument "${arg}". Pass --help for usage.`);
  process.exit(1);
}

// Apply env BEFORE importing backend modules — the DB client is lazy, but
// env-dependent module singletons must see the right configuration first
// (same bootstrap pattern as scripts/dbActions/index.ts).
try {
  applyEnvFile(envFile);
} catch (error) {
  console.error(`[ops:sweep] env bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const { ParentLinkRequestService } = await import("@/backend/services/parents/parent-link-request.service");
const { closePool } = await import("@/backend/db");

try {
  const materialized = await ParentLinkRequestService.sweepExpiredRequests();
  console.log(
    `[ops:sweep] parent-link expiry sweep complete: ${materialized} row(s) materialized to expired (env: ${envFile})`
  );
} catch (error) {
  console.error("[ops:sweep] sweep failed:", error);
  process.exitCode = 1;
} finally {
  await closePool();
}
