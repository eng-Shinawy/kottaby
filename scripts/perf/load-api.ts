/**
 * API load harness (`perf:load-api`).
 *
 * Drives a weighted mix of real GraphQL scenarios (login, teacher browse
 * plain + filtered, own subscriptions, own notifications, session booking
 * with the mandatory per-request idempotency key, the admin subscription
 * read) through ramped virtual users against a production-shaped
 * application server, mints every session through the real login mutation,
 * aggregates latencies incrementally, and gates the run on per-scenario
 * p95 + zero transport errors. A FAIL captures a pg_stat_activity peak
 * snapshot into the report.
 *
 * Safety contract, in order:
 *  1. The destructive-target guard runs FIRST (exit 2 on any non-test
 *     database target) — the harness reads pg_stat_activity through the
 *     shared db client, which is imported dynamically only after the guard
 *     allows.
 *  2. Seed-manifest, identity, minting, and harvest refusals happen before
 *     any run directory exists.
 *  3. Without --base-url the harness boots its own test server on port 3066
 *     (production mode when TEST_SERVER_MODE=production — the test runner's
 *     own boot knob — development mode otherwise) with the test-server env
 *     (TEST_SERVER=1 + IS_DEMO=true, the operative limiter bypass) and
 *     tears it down on every exit path, including signals.
 *
 * Exit codes: 0 = verdict PASS · 1 = verdict FAIL / runtime failure ·
 * 2 = usage refusal / guard refusal / configuration refusal.
 */

import { mintSessionCookie } from "@/scripts/perf/lib/auth-mint";
import { listSeedManifestEntries, PERF_LOGS_ROOT } from "@/scripts/perf/lib/cleanup-manifest";
import { assertTestDatabaseTarget } from "@/scripts/perf/lib/db-target-guard";
import {
  isLoadApiCliUsageError,
  isLoadApiHelpRequest,
  LOAD_API_HELP_TEXT,
  parseLoadApiCli,
} from "@/scripts/perf/lib/load-api-cli";
import {
  type ApiLoadEnv,
  type ApiLoadIo,
  type ApiSeedManifestSelection,
  errorMessage,
  isLoadApiRefusalError,
  LoadApiRefusalError,
  samplePgActivityRows,
} from "@/scripts/perf/lib/load-api-io";
import { runLoadApi } from "@/scripts/perf/lib/load-api-run";
import { BOOT_PORT, ensureServerHandle, graphqlEndpoint } from "@/scripts/perf/lib/load-api-server";
import { createHarnessReportSeam } from "@/scripts/perf/lib/report-seam";

const SCRIPT_LABEL = "perf:load-api";
const EXIT_USAGE = 2;
const EXIT_RUNTIME = 1;
const TOOL_ID = "load-api";

/** Scenario requests abort after this long so a hung request cannot outlive the window unboundedly. */
const SCENARIO_FETCH_TIMEOUT_MS = 30_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime guard over a parsed manifest body (never a blind cast). */
interface ApiManifestShape {
  readonly runId: string;
  readonly completedAt: unknown;
  readonly identities: { readonly studentEmails: readonly unknown[]; readonly adminEmails: readonly unknown[] };
}

function isApiIdentitiesManifest(value: unknown): value is ApiManifestShape {
  if (!isPlainRecord(value) || typeof value.runId !== "string") {
    return false;
  }
  const identities: unknown = value.identities;
  return isPlainRecord(identities) && Array.isArray(identities.studentEmails) && Array.isArray(identities.adminEmails);
}

/** Selects the newest completed seed manifest (or the newest for `--run`); refusals are actionable. */
export function selectApiManifest(runId: string | null, logsRoot: string = PERF_LOGS_ROOT): ApiSeedManifestSelection {
  const entries = listSeedManifestEntries(logsRoot);
  const candidates =
    runId === null
      ? entries
      : entries.filter(
          entry => entry.readError === null && isApiIdentitiesManifest(entry.body) && entry.body.runId === runId
        );
  if (runId !== null && candidates.length === 0) {
    throw new LoadApiRefusalError(`no seed manifest found for run "${runId}" under logs/perf — run perf:seed first`);
  }
  for (const entry of candidates) {
    if (entry.readError !== null || !isApiIdentitiesManifest(entry.body)) {
      if (runId === null) {
        continue;
      }
      throw new LoadApiRefusalError(
        `the seed manifest at ${entry.manifestPath} could not be read — fix or remove it, or select another run with --run`
      );
    }
    if (entry.body.completedAt === null) {
      if (runId === null) {
        continue;
      }
      throw new LoadApiRefusalError(
        `the seed manifest at ${entry.manifestPath} is from an incomplete seed run (no completion timestamp)`
      );
    }
    const studentEmails = entry.body.identities.studentEmails.filter(
      (email: unknown): email is string => typeof email === "string" && email.length > 0
    );
    const adminEmails = entry.body.identities.adminEmails.filter(
      (email: unknown): email is string => typeof email === "string" && email.length > 0
    );
    if (!/^[0-9a-f]{8}$/.test(entry.body.runId)) {
      continue;
    }
    if (studentEmails.length === 0 || adminEmails.length === 0) {
      throw new LoadApiRefusalError(
        `the seed manifest at ${entry.manifestPath} lists no student or admin identities — re-run perf:seed`
      );
    }
    return { runId: entry.body.runId, studentEmails, adminEmails };
  }
  throw new LoadApiRefusalError(
    runId === null
      ? "no completed seed manifest found under logs/perf — run perf:seed first (or select one with --run)"
      : `no completed seed manifest found for run "${runId}" under logs/perf`
  );
}

/** Sends one GraphQL POST and parses the JSON body (transport failures carry no body). */
async function fetchGraphqlRaw(
  baseUrl: string,
  body: unknown,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  try {
    const response = await fetch(graphqlEndpoint(baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SCENARIO_FETCH_TIMEOUT_MS),
    });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      parsed = null;
    }
    return { ok: true, status: response.status, body: isPlainRecord(parsed) ? parsed : null };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/** Wires the real io seams: env reads, guard, manifest scan, server lifecycle, minting, fetches, reports. */
function createRealIo(): ApiLoadIo {
  const reportSeam = createHarnessReportSeam(TOOL_ID);
  // The bare database name the destructive-target guard resolved — the sampler
  // binds THIS, never the full DSN (`datname` is the database name in
  // pg_stat_activity, so the DSN matches zero rows).
  let guardedDbName: string | null = null;
  const serverMode: "production" | "development" =
    process.env.TEST_SERVER_MODE === "production" ? "production" : "development";
  const environment: ApiLoadEnv = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    bootPort: BOOT_PORT,
    serverMode,
  };
  return {
    log: message => console.log(message),
    now: () => performance.now(),
    sleep: async ms => {
      await new Promise(resolve => setTimeout(resolve, ms));
    },
    env: () => environment,
    assertTarget: (databaseUrl, opts) => {
      const allowed = assertTestDatabaseTarget(databaseUrl, opts);
      guardedDbName = allowed.dbName;
      return allowed;
    },
    selectManifest: runId => selectApiManifest(runId),
    ensureServer: baseUrl => ensureServerHandle(baseUrl, serverMode),
    mintSession: async (baseUrl, email, password) => {
      const session = await mintSessionCookie(baseUrl, email, password);
      return { userId: session.userId, cookieHeader: session.cookieHeader };
    },
    fetchGraphql: (baseUrl, body, headers) => fetchGraphqlRaw(baseUrl, body, headers),
    samplePgActivity: async () => {
      const dbName = guardedDbName;
      if (dbName === null) {
        return null;
      }
      try {
        const { queryDb } = await import("@/backend/db/client");
        return await samplePgActivityRows(dbName, queryDb);
      } catch {
        return null;
      }
    },
    openReport: reportSeam.openReport,
    writeReport: reportSeam.writeReport,
    emitVerdict: reportSeam.emitVerdict,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (isLoadApiHelpRequest(argv)) {
    console.log(LOAD_API_HELP_TEXT);
    return;
  }
  const parsed = parseLoadApiCli(argv);
  if (isLoadApiCliUsageError(parsed)) {
    console.error(parsed.message);
    process.exit(EXIT_USAGE);
  }
  try {
    const outcome = await runLoadApi(parsed, createRealIo());
    process.exit(outcome.passed ? 0 : EXIT_RUNTIME);
  } catch (error) {
    if (isLoadApiRefusalError(error)) {
      console.error(`${SCRIPT_LABEL}: ${error.message}`);
      process.exit(EXIT_USAGE);
    }
    console.error(`${SCRIPT_LABEL}: run failed: ${errorMessage(error)}`);
    process.exit(EXIT_RUNTIME);
  }
}

if (import.meta.main) {
  void main();
}
