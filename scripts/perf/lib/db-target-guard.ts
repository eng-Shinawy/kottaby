/**
 * Destructive-target guard for the performance harness tools (`scripts/perf/`).
 *
 * Every harness entry point calls `assertTestDatabaseTarget` with the resolved
 * `DATABASE_URL` BEFORE issuing any database work. The guard resolves the
 * database name exactly the way the application's `pg` driver resolves its own
 * connection strings — the unix-socket space-separated form, URL forms
 * (`postgres://` / `postgresql://`, query parameters, URL-encoded credentials,
 * IPv6 hosts, `socket:` URIs), including the driver parser's space/percent
 * re-encoding pre-pass — so the name the guard validates is always the name the
 * driver would actually connect to. The harness may only continue when that
 * name is exactly `kottaby_test`.
 *
 * Refusal posture (mirrors the destructive-DB-command guard used by the db
 * CLI): the guard prints a formatted operator block and exits the process with
 * code 2 — there is no exception to swallow and no way to continue past a
 * refusal by accident. The only override is the explicit force flag PLUS a
 * confirmation typed on stdin that repeats the resolved database name; the
 * process continues against a non-test target only when both are answered.
 *
 * Provider posture: the guard validates `DATABASE_URL`, which is the
 * connection the shared db client honors only when `DB_PROVIDER` is the
 * postgres default. `backend/db/client.ts` routes to the PGlite shim only
 * when the value is exactly `pglite`; other non-postgres values fall
 * through to the pg Pool — but the guard deliberately refuses ANY
 * explicitly-set non-`postgres` value as a fail-closed superset:
 * unsupported provider values are refused up front even though the client
 * would ignore some of them, because the harness is certified only for the
 * postgres/pool path. When `DB_PROVIDER` is set to anything other than the
 * postgres default, the guard refuses with the same exit-2 channel; there
 * is no override for this arm because the typed confirmation could only
 * bless a provider configuration the harness was never certified to run
 * under. The provider check lives in `assertTestDatabaseTarget` (the
 * side-effectful entry layer) — the assessment functions stay pure.
 *
 * Secret hygiene: credentials embedded in the connection string (username,
 * password) are NEVER echoed. Refusal and confirmation output name the
 * database and host only, the typed confirmation is never echoed back, and
 * unprintable bytes in a resolved name are masked before display.
 */

import { readSync } from "node:fs";

/** The one database name the harness may touch without an explicit override. */
export const TEST_DATABASE_NAME = "kottaby_test";

/** Connection target as the `pg` driver itself would resolve it. */
export interface DatabaseTarget {
  dbName: string | null;
  host: string | null;
}

/** Guard assessment; `allowed` discriminates the two arms. */
export type DatabaseTargetAssessment =
  | { allowed: true; dbName: string; host: string | null; reason: string }
  | { allowed: false; dbName: string | null; host: string | null; reason: string };

/** Success outcome of the assert entry point; control never returns on refusal. */
export interface DatabaseTargetOk {
  ok: true;
  dbName: string;
}

/** Mirrors the pg connection-string parser's space/broken-escape pre-pass trigger. */
const SPACE_OR_BROKEN_ESCAPE_PATTERN = / |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i;
/** Restores double-encoded percent signs after the encodeURI pre-pass (pg mirror). */
const DOUBLE_ENCODED_PERCENT_PATTERN = /%25(\d\d)/g;
/** Placeholder the pg parser substitutes for an empty URL host before re-parsing. */
const DUMMY_HOST_REPLACEMENT = "@___DUMMY___/";
/** Base URL the pg parser resolves relative connection strings against. */
const URL_PARSE_BASE = "postgres://base";
/** URL-encoded unix-socket host prefix (`%2F...`) — hostname joins the path. */
const ENCODED_UNIX_SOCKET_HOST_PATTERN = /^%2f/i;
/** IPv6 literal brackets, stripped for host display the way the pg parser does. */
const IPV6_BRACKETS_PATTERN = /^\[(.+)\]$/;
/** Cap on the displayed length of a resolved name/host (log-injection hygiene). */
const MAX_DISPLAY_LENGTH = 80;
/** Bytes read from stdin before the override confirmation gives up (fail-closed). */
const CONFIRMATION_READ_LIMIT_BYTES = 128;

/**
 * Resolves the connection target the way the `pg` driver's own
 * connection-string parser does. Unparseable inputs resolve to a `null`
 * database name (the driver could not connect either), never throw.
 */
export function resolveDatabaseTarget(databaseUrl: string): DatabaseTarget {
  // Unix-socket space-separated form: "<socket-dir> <database>" (leading slash).
  if (databaseUrl.startsWith("/")) {
    const parts = databaseUrl.split(" ");
    const socketHost = parts.at(0) ?? "";
    const name = parts.at(1) ?? "";
    return {
      dbName: name.length > 0 ? name : null,
      host: socketHost.length > 0 ? socketHost : null,
    };
  }
  try {
    return resolveUrlTarget(databaseUrl);
  } catch {
    // The driver's parser would throw on the same input — no connection could
    // be established, so the guard treats the target as unresolvable.
    return { dbName: null, host: null };
  }
}

/** URL-form resolution, mirroring the pg parser branch-for-branch. */
function resolveUrlTarget(databaseUrl: string): DatabaseTarget {
  let candidate = databaseUrl;
  if (SPACE_OR_BROKEN_ESCAPE_PATTERN.test(candidate)) {
    candidate = encodeURI(candidate).replace(DOUBLE_ENCODED_PERCENT_PATTERN, "%$1");
  }
  let url: URL;
  let dummyHost = false;
  try {
    url = new URL(candidate, URL_PARSE_BASE);
  } catch {
    try {
      url = new URL(candidate.replace("@/", DUMMY_HOST_REPLACEMENT), URL_PARSE_BASE);
      dummyHost = true;
    } catch {
      return { dbName: null, host: null };
    }
  }
  if (url.protocol === "socket:") {
    const name = url.searchParams.get("db") ?? "";
    const socketPath = decodeURI(url.pathname);
    return {
      dbName: name.length > 0 ? name : null,
      host: socketPath.length > 0 ? socketPath : null,
    };
  }
  const queryHost = url.searchParams.get("host");
  let host: string | null = queryHost;
  let pathname = url.pathname;
  const rawHostname = dummyHost ? "" : url.hostname;
  if (host === null) {
    const decoded = decodeURIComponent(rawHostname.replace(IPV6_BRACKETS_PATTERN, "$1"));
    host = decoded.length > 0 ? decoded : null;
  } else if (rawHostname.length > 0 && ENCODED_UNIX_SOCKET_HOST_PATTERN.test(rawHostname)) {
    pathname = rawHostname + pathname;
  }
  const path = pathname.slice(1) || null;
  return {
    dbName: path === null ? null : decodeURI(path),
    host,
  };
}

/**
 * Pure guard evaluation: resolves the target and reports whether the harness
 * may run against it. Deterministic and side-effect free — safe to call
 * concurrently from any number of callers.
 */
export function assessDatabaseTarget(databaseUrl: string): DatabaseTargetAssessment {
  const { dbName, host } = resolveDatabaseTarget(databaseUrl);
  if (dbName === null) {
    return {
      allowed: false,
      dbName: null,
      host,
      reason: "the database name could not be resolved from the connection string",
    };
  }
  if (dbName !== TEST_DATABASE_NAME) {
    return {
      allowed: false,
      dbName,
      host,
      reason: "the connection string does not name the test database",
    };
  }
  return {
    allowed: true,
    dbName,
    host,
    reason: `targets the test database "${TEST_DATABASE_NAME}"`,
  };
}

/** Masks control bytes and caps length so a garbage-parsed name can never inject log lines. */
function sanitizeForDisplay(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 32 && code !== 127 ? char : "?";
  }
  return out.length > MAX_DISPLAY_LENGTH ? `${out.slice(0, MAX_DISPLAY_LENGTH)}…` : out;
}

/**
 * Operator-facing refusal block (stderr). Names the resolved database and
 * host ONLY — usernames and passwords embedded in the connection string never
 * appear here.
 */
export function formatDatabaseTargetRefusal(assessment: DatabaseTargetAssessment): string {
  const nameDisplay = assessment.dbName === null ? "(unresolvable)" : `"${sanitizeForDisplay(assessment.dbName)}"`;
  const hostDisplay = assessment.host === null ? "(unknown)" : sanitizeForDisplay(assessment.host);
  return [
    "✗ Blocked: the performance harness database guard refused to run.",
    "",
    `  Reason: ${assessment.reason}.`,
    `  Resolved database name: ${nameDisplay}`,
    `  Resolved host: ${hostDisplay}`,
    "",
    `  Harness tools may only run against the test database named exactly "${TEST_DATABASE_NAME}".`,
    "  Load the test environment (bun --env-file=.env.test) so DATABASE_URL resolves to the",
    "  test database, or pass --force-prod-shaped-target and complete the stdin confirmation",
    "  to deliberately override this guard.",
  ].join("\n");
}

/** Reads one stdin line for the override confirmation. Bounded, never echoes, "" on any read failure. */
function readConfirmationLine(): string {
  const decoder = new TextDecoder();
  const chunk = new Uint8Array(64);
  let collected = "";
  let read = 0;
  while (read < CONFIRMATION_READ_LIMIT_BYTES) {
    let bytes: number;
    try {
      bytes = readSync(0, chunk, 0, chunk.length, null);
    } catch {
      return "";
    }
    if (bytes <= 0) {
      break;
    }
    collected += decoder.decode(chunk.subarray(0, bytes), { stream: true });
    const newlineIndex = collected.indexOf("\n");
    if (newlineIndex >= 0) {
      return collected.slice(0, newlineIndex).trim();
    }
    read += bytes;
  }
  return collected.trim();
}

/** Interactive double-acknowledgement for a deliberate non-test override. */
function confirmForcedOverride(dbName: string, host: string | null): boolean {
  const hostDisplay = host === null ? "(unknown)" : sanitizeForDisplay(host);
  process.stdout.write(
    [
      "",
      "⚠  Override requested for a NON-TEST database target.",
      `   Database: "${sanitizeForDisplay(dbName)}"   Host: ${hostDisplay}`,
      "   Everything this harness tool writes will go to that database.",
      "",
      "Type the database name above to confirm the override: ",
    ].join("\n")
  );
  return readConfirmationLine() === dbName;
}

/**
 * Operator-facing refusal block (stderr) for a non-postgres `DB_PROVIDER`.
 * The value is echoed only after masking, like every other operator output.
 */
export function formatDbProviderRefusal(provider: string): string {
  return [
    "✗ Blocked: the performance harness database guard refused to run.",
    "",
    `  Reason: DB_PROVIDER is set to "${sanitizeForDisplay(provider)}" — the shared db client`,
    "  would not use DATABASE_URL at all for that provider, so the connection string this",
    "  guard validates would not be the database the harness actually touches.",
    "",
    "  Harness tools may only run with the postgres provider (the DATABASE_URL-honoring",
    "  default) — unset DB_PROVIDER or set DB_PROVIDER=postgres. There is no force-override",
    "  for a non-postgres provider.",
  ].join("\n");
}

/**
 * Harness entry-point guard. Returns only when the connection string targets
 * the test database (or a forced override was explicitly confirmed); on any
 * other target it prints the refusal block and exits the process with code 2.
 * Refuses up front when `DB_PROVIDER` names a non-postgres provider (the
 * client would ignore DATABASE_URL, mooting the target check). Silent on
 * success — harness tools print their own banners.
 */
export function assertTestDatabaseTarget(databaseUrl: string, opts?: { forceFlag?: boolean }): DatabaseTargetOk {
  const provider = process.env.DB_PROVIDER;
  if (provider !== undefined && provider.toLowerCase() !== "postgres") {
    console.error(formatDbProviderRefusal(provider));
    process.exit(2);
  }
  const assessment = assessDatabaseTarget(databaseUrl);
  if (assessment.allowed) {
    return { ok: true, dbName: assessment.dbName };
  }
  if (opts?.forceFlag !== true || assessment.dbName === null) {
    console.error(formatDatabaseTargetRefusal(assessment));
    process.exit(2);
  }
  const { dbName, host } = assessment;
  if (!confirmForcedOverride(dbName, host)) {
    console.error(
      [
        "✗ Blocked: the override confirmation was not answered correctly.",
        "  The typed confirmation must repeat the resolved database name exactly.",
        "  The typed answer is never echoed; refusing to run.",
      ].join("\n")
    );
    process.exit(2);
  }
  console.error(`⚠  Override confirmed — proceeding against "${sanitizeForDisplay(dbName)}".`);
  return { ok: true, dbName };
}
