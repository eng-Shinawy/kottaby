/**
 * Seam contracts for the API load harness: the minted-session and
 * manifest-selection shapes, the harness-resolved environment, the
 * effectful io seams the orchestrator drives (GraphQL fetches, session
 * minting, application-server boot/reuse, pg_stat_activity sampling,
 * report lifecycle), the pure pg_stat_activity read the real io builds on,
 * and the operator-refusal error the entrypoint maps to exit code 2.
 */

import type { ApiScenarioRole } from "@/scripts/perf/lib/api-scenarios";
import type { GateResult } from "@/scripts/perf/lib/stats";

/** A real session minted through the login mutation (cookie lives in memory only). */
export interface ApiIdentitySession {
  readonly userId: number;
  readonly cookieHeader: string;
}

/** The seed-run selection the identity pools come from. */
export interface ApiSeedManifestSelection {
  readonly runId: string;
  readonly studentEmails: readonly string[];
  readonly adminEmails: readonly string[];
}

/** Harness-resolved environment (env-seam reads; never raw secrets in outputs). */
export interface ApiLoadEnv {
  readonly databaseUrl: string;
  readonly bootPort: number;
  readonly serverMode: "production" | "development";
}

/** One raw GraphQL HTTP response (transport-level facts; body parsed by the seam). */
export interface ApiFetchResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

/** The application server the harness drives (booted by the harness, or an reused external one). */
export interface ApiServerHandle {
  readonly baseUrl: string;
  readonly spawned: boolean;
  stop(): Promise<void>;
  /** True when a harness-booted server exited before the harness asked it to stop. */
  diedUnexpectedly(): boolean;
}

/** Effectful seams the orchestrator drives (real wiring lives in the entrypoint; tests fake them). */
/** One pg_stat_activity observation (null when the sampler could not read it). */
export interface PgActivitySnapshot {
  readonly rows: readonly Record<string, unknown>[];
  readonly nonIdleCount: number;
}

/** Cap on retained pg_stat_activity rows per snapshot. */
export const PG_ACTIVITY_SNAPSHOT_ROW_CAP = 200;

/**
 * The slice of the shared db client's `queryDb` the sampler depends on: it
 * returns a pg `QueryResult`-like object whose rows live on `.rows` — never a
 * bare array (see `backend/db/client.ts`).
 */
export type PgActivityQueryFn = (
  text: string,
  params: ReadonlyArray<unknown>
) => Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>;

/**
 * One pg_stat_activity observation read through the shared db client.
 * Binds the BARE database name — the destructive-target guard's resolution,
 * never the full DSN: `datname` in pg_stat_activity is the database name, so
 * binding the connection string matches zero rows — and reads rows off the
 * pg `QueryResult` (`.rows`). Any read failure observes null; the window
 * tracker records that as a read failure.
 */
export async function samplePgActivityRows(
  dbName: string,
  query: PgActivityQueryFn
): Promise<PgActivitySnapshot | null> {
  try {
    const result = await query(
      "SELECT pid, usename, state, wait_event_type, wait_event, LEFT(query, 200) AS query " +
        "FROM pg_stat_activity WHERE datname = $1 ORDER BY pid LIMIT $2",
      [dbName, PG_ACTIVITY_SNAPSHOT_ROW_CAP]
    );
    let nonIdleCount = 0;
    for (const row of result.rows) {
      if (row.state !== "idle") {
        nonIdleCount += 1;
      }
    }
    return { rows: result.rows, nonIdleCount };
  } catch {
    return null;
  }
}

export interface ApiLoadIo {
  log(message: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  env(): ApiLoadEnv;
  assertTarget(databaseUrl: string, opts: { forceFlag: boolean }): { dbName: string };
  selectManifest(runId: string | null): ApiSeedManifestSelection;
  /** Boots the harness's own test server when baseUrl is null; reuses (and health-verifies) an existing one otherwise. */
  ensureServer(baseUrl: string | null): Promise<ApiServerHandle>;
  mintSession(baseUrl: string, email: string, password: string): Promise<ApiIdentitySession>;
  fetchGraphql(baseUrl: string, body: unknown, headers: Record<string, string>): Promise<ApiFetchResult>;
  /** One pg_stat_activity observation (null when the sampler could not read it). */
  samplePgActivity(): Promise<PgActivitySnapshot | null>;
  openReport(args: Record<string, string | number | boolean>): { runId: string; runDir: string };
  writeReport(runId: string, gates: readonly GateResult[], sections: Record<string, unknown>): void;
  emitVerdict(gates: readonly GateResult[]): boolean;
}

/** Actionable operator refusal (configuration-shaped; exit 2 in the entrypoint). */
export class LoadApiRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadApiRefusalError";
  }
}

/** Runtime guard narrowing a thrown value to the refusal error. */
export function isLoadApiRefusalError(value: unknown): value is LoadApiRefusalError {
  return value instanceof LoadApiRefusalError;
}

/** One VU's observed run facts (identity emails are synthetic seed data; cookies never appear). */
export interface VuRunFacts {
  readonly index: number;
  readonly role: ApiScenarioRole;
  readonly email: string;
  readonly iterations: number;
}

/** Terminal outcome of one harness run. */
export interface ApiRunOutcome {
  readonly passed: boolean;
  readonly runId: string;
  readonly runDir: string;
}

/** Renders an unknown thrown value for operator messages (never re-throws). */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}
