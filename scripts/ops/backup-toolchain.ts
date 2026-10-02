/**
 * External-tool layer for the database backup script: the explicit-child-env
 * allowlist, the production spawn runner, the pg_dump/psql toolchain probe,
 * and the pg_dump execution stage. Every process is started from an argv
 * ARRAY (never a composed shell string) and receives a fixed allowlist of
 * environment variables — never the full parent environment.
 */

import { chmodSync, statSync } from "node:fs";
import { scrubDsnSecrets } from "@/scripts/ops/_shared";

const STDERR_TAIL_LINES = 20;

/**
 * Hard deadline for one external child process (pg_dump/psql). A hung child is
 * killed (SIGTERM) instead of blocking the backup forever; the deadline sits
 * above the measured single-digit-minute dump runtime and inside the RPO
 * budget arithmetic in docs/ops/disaster-recovery.md.
 */
const SPAWN_TIMEOUT_MS = 30 * 60 * 1000;

/** Last non-empty lines of tool output, for failure reporting. */
export function stderrTail(text: string, maxLines = STDERR_TAIL_LINES): string {
  const lines = text
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
    .slice(-maxLines);
  return lines.length > 0 ? lines.join("\n") : "(no stderr captured)";
}

/** Result of one external process invocation. */
export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Seam for external processes: receives an argv ARRAY (never a shell string)
 * and an explicit child environment. The production implementation wraps
 * Bun.spawn; tests inject fakes.
 */
export type SpawnRunner = (argv: readonly string[], opts: { env: Record<string, string> }) => Promise<SpawnResult>;

/**
 * Process environment keys passed through to pg_dump/psql children. The
 * endpoint-deciding libpq variables (PGDATABASE, PGSERVICE, PGSERVICEFILE,
 * PGHOST, …) are deliberately NOT forwarded — parity with the restore
 * family: the connection is decided by the DSN argv value alone, never by
 * the ambient environment.
 */
const CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "PGPASSWORD",
  "PGPASSFILE",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGCONNECT_TIMEOUT",
  "PGAPPNAME",
] as const;

/**
 * Explicit child environment for external tools: connection config travels
 * in the DSN itself, so only a fixed allowlist of PATH/locale/libpq vars is
 * forwarded. Never hands the full process env to a child or an error path.
 */
export function buildChildEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Production spawn runner: argv arrays only, piped output, no stdin. */
export const bunSpawnRunner: SpawnRunner = async (argv, opts) => {
  try {
    const proc = Bun.spawn([...argv], {
      env: opts.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: SPAWN_TIMEOUT_MS,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    // A timeout kill surfaces as a null exit code on Bun versions that report
    // signal termination as null — normalize it so every `exitCode !== 0`
    // failure check keeps firing and SpawnResult keeps its number contract.
    return { exitCode: exitCode ?? -1, stdout, stderr };
  } catch (error) {
    throw new Error(`failed to spawn ${argv[0] ?? "<command>"}: ${errorMessage(error)}`, { cause: error });
  }
};

export type ToolchainProbe =
  | { ok: true; pgDumpVersion: string; postgresServerVersion: string }
  | { ok: false; message: string };

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

function extractMajorVersion(text: string): number | null {
  const match = /(\d+)/.exec(text);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function probeFailure(message: string): ToolchainProbe {
  return {
    ok: false,
    message: `${message} Install or upgrade the PostgreSQL client tools so the client major matches the server major (see docs/ops/disaster-recovery.md).`,
  };
}

/**
 * Verifies pg_dump is present and its client major is not older than the
 * server major (queried live via psql). Any probe problem is actionable.
 */
export async function probeToolchain(
  spawn: SpawnRunner,
  dsn: string,
  env: Record<string, string>
): Promise<ToolchainProbe> {
  let dumpVersion: string;
  try {
    const dumpProbe = await spawn(["pg_dump", "--version"], { env });
    if (dumpProbe.exitCode !== 0) {
      return probeFailure(`pg_dump is not usable (pg_dump --version exited with code ${dumpProbe.exitCode}).`);
    }
    dumpVersion = firstLine(dumpProbe.stdout);
  } catch {
    return probeFailure("pg_dump was not found on PATH.");
  }
  if (dumpVersion.length === 0) {
    return probeFailure("pg_dump --version produced no output.");
  }
  const clientMajor = extractMajorVersion(dumpVersion);
  if (clientMajor === null) {
    return probeFailure(`could not parse the pg_dump version from "${dumpVersion}".`);
  }

  let serverVersion: string;
  try {
    const serverProbe = await spawn(
      ["psql", "--no-psqlrc", "--no-align", "--tuples-only", "--no-password", "--command", "SHOW server_version", dsn],
      { env }
    );
    if (serverProbe.exitCode !== 0) {
      return probeFailure(
        `could not query the server version (psql exited with code ${serverProbe.exitCode}): ${scrubDsnSecrets(stderrTail(serverProbe.stderr), dsn)}`
      );
    }
    serverVersion = firstLine(serverProbe.stdout);
  } catch {
    return probeFailure("psql was not found on PATH.");
  }
  const serverMajor = extractMajorVersion(serverVersion);
  if (serverMajor === null) {
    return probeFailure(`could not parse the server version from "${serverVersion}".`);
  }

  if (clientMajor < serverMajor) {
    return probeFailure(`pg_dump major ${clientMajor} is older than the server major ${serverMajor}.`);
  }

  return { ok: true, pgDumpVersion: dumpVersion, postgresServerVersion: serverVersion };
}

export type DumpOutcome = { ok: true; artifactBytes: number } | { ok: false; message: string };

/**
 * Runs pg_dump (custom format) into the pre-created artifact file and
 * validates the result: a zero-byte or missing artifact is a failure even
 * when pg_dump reported success. Failure messages are credential-scrubbed.
 */
export async function runPgDump(
  spawn: SpawnRunner,
  env: Record<string, string>,
  artifactPath: string,
  dsn: string
): Promise<DumpOutcome> {
  let dumpRun: SpawnResult;
  try {
    dumpRun = await spawn(["pg_dump", "--format=custom", "--no-password", "--file", artifactPath, dsn], { env });
  } catch (spawnError) {
    return { ok: false, message: `could not run pg_dump: ${errorMessage(spawnError)}` };
  }
  if (dumpRun.exitCode !== 0) {
    return {
      ok: false,
      message: `pg_dump exited with code ${dumpRun.exitCode}\n${scrubDsnSecrets(stderrTail(dumpRun.stderr), dsn)}`,
    };
  }

  let artifactBytes: number;
  try {
    artifactBytes = statSync(artifactPath).size;
  } catch {
    return { ok: false, message: "pg_dump reported success but the artifact file is missing" };
  }
  if (artifactBytes === 0) {
    return { ok: false, message: "pg_dump reported success but the artifact is 0 bytes — treating the run as failed" };
  }
  chmodSync(artifactPath, 0o600);
  return { ok: true, artifactBytes };
}
