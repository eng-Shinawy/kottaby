#!/usr/bin/env bun
/**
 * HTTP virtual-user load driver — the row 6.1 probe CLI.
 *
 * Bun-native (no k6/autocannon/artillery): spawns `--users` concurrent
 * virtual users driving the platform's hot reads over the REAL gateway
 * (HTTP POST /api/graphql) for `--duration-s` seconds, then reports
 * p50/p95/p99 + rps per query and overall into a stamped, redacted JSON
 * artifact under `scratch/load/`.
 *
 * Hot-read set (the §6 checklist's three surfaces):
 *  - notification inbox  — `myNotifications` (every authenticated role)
 *  - directory browse    — `browseAvailableTeachers` (student)
 *  - session list        — `myStudentSessions` (student) / `myTeacherSessions` (teacher)
 *
 * Authentication is HONEST: the driver performs the real `login` mutation
 * with credentials from `LOAD_TEST_EMAIL`/`LOAD_TEST_PASSWORD` and rides
 * the returned access token via the `Authorization: Bearer` header. There
 * is no bypass, no test flag, no synthetic identity — 429s from the
 * gateway-wide per-IP limiter are recorded in the status mix, not hidden.
 *
 * Usage:
 *   LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… \
 *     bun run scripts/load/load-test.ts --url http://127.0.0.1:3000 \
 *       [--users 100] [--duration-s 30] [--out <path>]
 *
 * Exit codes: 0 = driver completed with at least one successful response;
 * 1 = usage error, login failure, connection failure, or zero successes.
 */

import { writeLoadArtifact } from "@/scripts/load/lib/artifact";
import { type LoadArgSpec, LoadCliUsageError, parseLoadCliArgs } from "@/scripts/load/lib/cli";
import { type LatencySummary, summarizeLatencies } from "@/scripts/load/lib/metrics";

const ARGS: readonly LoadArgSpec[] = [
  { name: "url", kind: "string", required: true, help: "Target server base URL (explicit — never autodetected)" },
  { name: "users", kind: "number", default: 100, help: "Concurrent virtual users" },
  { name: "duration-s", kind: "number", default: 30, help: "Load window in seconds" },
  { name: "out", kind: "string", help: "Explicit artifact output path (default: scratch/load/<stamp>.json)" },
];

const LOGIN_MUTATION = `mutation LoadLogin($email: String!, $password: String!) {
  login(email: $email, password: $password) { accessToken user { role } }
}`;

interface HotRead {
  readonly key: string;
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

const INBOX_READ: HotRead = {
  key: "myNotifications",
  query: `query LoadInbox { myNotifications(filter: { limit: 20, offset: 0 }) { totalCount hasMore } }`,
  variables: {},
};

const DIRECTORY_READ: HotRead = {
  key: "browseAvailableTeachers",
  query: `query LoadDirectory { browseAvailableTeachers(page: 1, pageSize: 25) { total pageCount } }`,
  variables: {},
};

const STUDENT_SESSIONS_READ: HotRead = {
  key: "myStudentSessions",
  query: `query LoadStudentSessions { myStudentSessions(page: 1, pageSize: 25) { totalCount } }`,
  variables: {},
};

const TEACHER_SESSIONS_READ: HotRead = {
  key: "myTeacherSessions",
  query: `query LoadTeacherSessions { myTeacherSessions(page: 1, pageSize: 25) { totalCount } }`,
  variables: {},
};

interface GqlResponse {
  readonly status: number;
  readonly errors?: readonly unknown[];
}

/** Narrows an unknown JSON body to its `{ errors }` array without assertions. */
function errorsOf(raw: unknown): readonly unknown[] | undefined {
  if (raw !== null && typeof raw === "object" && "errors" in raw) {
    const errors: unknown = raw.errors;
    if (Array.isArray(errors)) {
      return errors;
    }
  }
  return undefined;
}

/** Narrows the login mutation payload to `{ token, role }` without assertions. */
function loginFieldsOf(raw: unknown): { token: string; role: string } | null {
  if (raw === null || typeof raw !== "object" || !("data" in raw)) {
    return null;
  }
  const data: unknown = raw.data;
  if (data === null || typeof data !== "object" || !("login" in data)) {
    return null;
  }
  const login: unknown = data.login;
  if (login === null || typeof login !== "object" || !("accessToken" in login) || !("user" in login)) {
    return null;
  }
  const user: unknown = login.user;
  if (user === null || typeof user !== "object" || !("role" in user)) {
    return null;
  }
  const accessToken: unknown = login.accessToken;
  const role: unknown = user.role;
  if (typeof accessToken === "string" && typeof role === "string") {
    return { token: accessToken, role };
  }
  return null;
}

interface RunResult {
  readonly latencies: number[];
  readonly perQuery: ReadonlyMap<string, number[]>;
  readonly statusCounts: ReadonlyMap<number, number>;
  readonly perStatusLatencies: ReadonlyMap<number, number[]>;
  readonly errorSamples: readonly string[];
}

/** One GraphQL POST round trip; returns HTTP status + parsed error presence. */
async function postGraphql(
  url: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<GqlResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, errors: errorsOf(parsed) };
}

/** Runs the login handshake honestly; returns the token + role (one round trip each). */
async function authenticate(baseUrl: string): Promise<{ token: string; role: string }> {
  const email = process.env.LOAD_TEST_EMAIL;
  const password = process.env.LOAD_TEST_PASSWORD;
  if (email === undefined || email === "" || password === undefined || password === "") {
    throw new LoadCliUsageError(
      "credentials missing: set LOAD_TEST_EMAIL and LOAD_TEST_PASSWORD (they are never printed or written to artifacts)"
    );
  }
  const loginResponse = await postGraphql(`${baseUrl}/api/graphql`, "", LOGIN_MUTATION, { email, password });
  if (loginResponse.status !== 200 || loginResponse.errors !== undefined) {
    throw new Error(`login failed (HTTP ${loginResponse.status}) — the driver refuses to run unauthenticated`);
  }
  const login = await fetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: LOGIN_MUTATION, variables: { email, password } }),
  });
  const fields = loginFieldsOf(await login.json());
  if (fields === null) {
    throw new Error("login payload carried no access token / role — cannot drive the hot-read mix");
  }
  return fields;
}

/** Picks the hot-read mix for the authenticated actor's role (case-insensitive — the login payload carries the enum casing). */
function hotReadsForRole(role: string): readonly HotRead[] {
  const shared: readonly HotRead[] = [INBOX_READ];
  const normalized = role.toLowerCase();
  if (normalized === "student") {
    return [INBOX_READ, DIRECTORY_READ, STUDENT_SESSIONS_READ];
  }
  if (normalized === "teacher") {
    return [INBOX_READ, TEACHER_SESSIONS_READ];
  }
  return shared;
}

async function runVirtualUsers(
  url: string,
  token: string,
  reads: readonly HotRead[],
  users: number,
  durationSeconds: number
): Promise<RunResult> {
  const latencies: number[] = [];
  const perQuery = new Map<string, number[]>();
  const statusCounts = new Map<number, number>();
  const perStatusLatencies = new Map<number, number[]>();
  const errorSamples: string[] = [];
  const deadline = Date.now() + durationSeconds * 1000;

  const record = (read: HotRead, elapsed: number, status: number, errorText: string | null): void => {
    latencies.push(elapsed);
    const bucket = perQuery.get(read.key) ?? [];
    bucket.push(elapsed);
    perQuery.set(read.key, bucket);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    perStatusLatencies.set(status, (perStatusLatencies.get(status) ?? []).concat(elapsed));
    if (errorText !== null && errorSamples.length < 10) {
      errorSamples.push(`${read.key}: ${errorText}`);
    }
  };

  // Each virtual user fires sequentially (the load model) via async
  // recursion — a `while (… await …)` loop is the same semantics but the
  // lint rule wants explicit intent, and recursion is stack-safe here.
  const virtualUser = async (index: number, round: number): Promise<void> => {
    if (Date.now() >= deadline) {
      return;
    }
    const read = reads.at((index + round) % reads.length);
    if (read === undefined) {
      return;
    }
    const startedAt = performance.now();
    let status = 0;
    let errorText: string | null = null;
    try {
      const response = await postGraphql(url, token, read.query, read.variables);
      status = response.status;
      if (response.errors !== undefined) {
        errorText = `graphql error (HTTP ${response.status})`;
      }
    } catch (error) {
      errorText = error instanceof Error ? error.message : "connection error";
    }
    record(read, performance.now() - startedAt, status, errorText);
    await virtualUser(index, round + 1);
  };

  await Promise.all(Array.from({ length: users }, (_, index) => virtualUser(index, 0)));
  return { latencies, perQuery, statusCounts, perStatusLatencies, errorSamples };
}

/** Trims trailing slashes and validates the explicit http(s) base URL. */
function normalizeBaseUrl(rawUrl: string | undefined): string | null {
  if (rawUrl === undefined) {
    return null;
  }
  let url = rawUrl;
  while (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return null;
}

/** Prints the console report; returns the artifact payload + success count. */
function reportRun(
  result: RunResult,
  url: string,
  users: number,
  durationSeconds: number,
  role: string,
  wallSeconds: number
): { readonly payload: Record<string, unknown>; readonly successes: number } {
  const overall: LatencySummary = summarizeLatencies(result.latencies, wallSeconds);
  const perQuery: Record<string, LatencySummary> = {};
  for (const [key, samples] of result.perQuery) {
    perQuery[key] = summarizeLatencies(samples, wallSeconds);
  }
  const statusMix: Record<string, number> = {};
  const perStatus: Record<string, LatencySummary> = {};
  for (const [status, samples] of result.perStatusLatencies) {
    statusMix[String(status)] = samples.length;
    perStatus[String(status)] = summarizeLatencies(samples, wallSeconds);
  }
  const okSummary = summarizeLatencies(result.perStatusLatencies.get(200) ?? [], wallSeconds);
  const successes = result.statusCounts.get(200) ?? 0;
  console.log(
    `[load-test] requests=${overall.count} rps=${overall.rps.toFixed(1)} p50=${overall.p50Ms.toFixed(1)}ms p95=${overall.p95Ms.toFixed(1)}ms p99=${overall.p99Ms.toFixed(1)}ms status=${JSON.stringify(statusMix)}`
  );
  console.log(
    `[load-test] HTTP 200 latencies: n=${okSummary.count} p50=${okSummary.p50Ms.toFixed(1)}ms p95=${okSummary.p95Ms.toFixed(1)}ms p99=${okSummary.p99Ms.toFixed(1)}ms`
  );
  for (const [key, summary] of Object.entries(perQuery)) {
    console.log(
      `[load-test] ${key}: n=${summary.count} p50=${summary.p50Ms.toFixed(1)}ms p95=${summary.p95Ms.toFixed(1)}ms p99=${summary.p99Ms.toFixed(1)}ms`
    );
  }
  for (const sample of result.errorSamples) {
    console.log(`[load-test] error-sample: ${sample}`);
  }
  const payload = {
    tool: "load-test",
    url: url.replace(/^https?:\/\//, "<scheme>://"),
    users,
    durationSeconds,
    role,
    overall,
    perQuery,
    perStatus,
    statusMix,
    errorSamples: result.errorSamples,
  };
  return { payload, successes };
}

async function main(): Promise<number> {
  const args = parseLoadCliArgs("load-test.ts", ARGS);
  if (args === null) {
    return 1;
  }
  const rawUrl = args.string("url");
  const users = args.number("users") ?? 100;
  const durationSeconds = args.number("duration-s") ?? 30;
  const url = normalizeBaseUrl(rawUrl);
  if (url === null) {
    console.error("[load-test] --url must be an explicit http(s) server URL");
    return 1;
  }
  const endpoint = `${url}/api/graphql`;

  let auth: { token: string; role: string };
  try {
    auth = await authenticate(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[load-test] ${message}`);
    return 1;
  }
  console.log(
    `[load-test] authenticated as role=${auth.role}; driving ${users} VUs for ${durationSeconds}s against ${url}`
  );

  const reads = hotReadsForRole(auth.role);
  const startedWall = Date.now();
  const result = await runVirtualUsers(endpoint, auth.token, reads, users, durationSeconds);
  const wallSeconds = (Date.now() - startedWall) / 1000;

  const { payload, successes } = reportRun(result, url, users, durationSeconds, auth.role, wallSeconds);
  const artifact = args.string("out") ?? writeLoadArtifact("load-test", payload);
  console.log(`[load-test] artifact: ${artifact}`);

  if (successes === 0) {
    console.error("[load-test] FAIL — zero successful (HTTP 200) responses recorded");
    return 1;
  }
  console.log("[load-test] PASS — window completed with at least one successful response");
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error("[load-test] FAILED:", error);
    process.exit(1);
  });
