#!/usr/bin/env bun
/**
 * On-demand ops trigger for the parent-link expiry-reminder PRIMITIVE.
 *
 * Sends ONE localized reminder notification to the requesting parent of
 * every live pending link request whose expiry falls inside the reminder
 * window (default: within the next 24h) — the canonical doc's sanctioned
 * manual path while the cron STREAM is not yet wired
 * (docs/parents/parent-link-request.md §5). The future cron-stream job
 * handler registers the SAME service primitive
 * (`ParentLinkRequestService.sendExpiryReminders`) on a schedule.
 *
 * Semantics (canonical doc §5, the expiry-reminder slice):
 *  - Actor-less (system scope) and otherwise silent: no audit rows, no
 *    happy-path logs; the notification inbox row IS the record.
 *  - Dedupe is the claim: `reminder_sent_at` is set in the SAME guarded
 *    statement that selects the rows — a re-run reminds nobody twice.
 *  - Strict-`>` liveness: a row at or past `now` has lapsed and is the
 *    SWEEP's business (run `ops:sweep-link-requests` for those), never the
 *    reminder's.
 *  - Copy: the student's MASKED name in the parent's persisted locale.
 *  - All-or-nothing: markers + inbox rows commit in ONE transaction.
 *
 * Usage:
 *   bun run ops:remind-link-requests
 *   bun run scripts/ops/remind-expiring-link-requests.ts [--horizon-hours <n>] [--env <env-file>]
 *
 * Exit codes: 0 = reminder run completed (any count); 1 = bootstrap,
 * validation, or emission failure.
 */

import { applyEnvFile } from "@/scripts/dbActions/envFile";

function printHelp(): void {
  console.log(`
On-demand ops trigger for the parent-link expiry reminder primitive.

Usage:
  bun run ops:remind-link-requests
  bun run scripts/ops/remind-expiring-link-requests.ts [--horizon-hours <n>] [--env <env-file>]

Options:
  --horizon-hours <n>   Reminder window length in hours (default: 24;
                        positive integer, hard-capped at 168 = one full
                        request lifetime).
  --env <file>          Env file to load (default: .env)
  --help                Show this help

The run is atomic and idempotent (the claim itself dedupes via
reminder_sent_at): each in-window live pending request reminds its
requesting parent AT MOST ONCE, with the student's masked name in the
parent's locale. Lapsed requests are NOT this script's business — run
ops:sweep-link-requests for materialization.
`);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

function readFlag(name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

const envFile = readFlag("--env") ?? ".env";
const horizonFlag = readFlag("--horizon-hours");
let horizonHours: number | undefined;
if (horizonFlag !== undefined) {
  horizonHours = Number(horizonFlag);
  if (!Number.isInteger(horizonHours) || horizonHours <= 0) {
    console.error(`[ops:remind] invalid --horizon-hours value: "${horizonFlag}" (expected a positive integer)`);
    process.exit(1);
  }
}

// Apply env BEFORE importing backend modules — the DB client is lazy, but
// env-dependent module singletons must see the right configuration first
// (same bootstrap pattern as the sweep trigger / db CLI).
try {
  applyEnvFile(envFile);
} catch (error) {
  console.error(`[ops:remind] env bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const { ParentLinkRequestService } = await import("@/backend/services/parents/parent-link-request.service");
const { closePool } = await import("@/backend/db");

try {
  const reminded = await ParentLinkRequestService.sendExpiryReminders({ horizonHours });
  console.log(
    `[ops:remind] parent-link expiry reminder complete: ${reminded} reminder(s) emitted (window: ${
      horizonHours ?? 24
    }h, env: ${envFile})`
  );
} catch (error) {
  console.error("[ops:remind] reminder run failed:", error);
  process.exitCode = 1;
} finally {
  await closePool();
}
