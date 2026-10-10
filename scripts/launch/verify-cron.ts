#!/usr/bin/env bun
/**
 * Live-envelope probe for the armed cron sweep routes and the realtime
 * arming surfaces — stage-level arming corroboration the launch gate
 * records beside the sweep-mechanics evidence (no registry row cites
 * this probe as its own proof; it corroborates the externally-armed
 * scheduler surfaces).
 *
 * Bearer discipline:
 *   • The cron bearer is read from the environment (`CRON_SECRET`; Bun
 *     auto-loads the repo `.env`) — never from argv, never written to a
 *     report, never echoed in any emitted line.
 *   • A missing or whitespace-only secret is a named FAIL line and a
 *     non-zero exit — the probe never sends an unauthenticated request
 *     and never guesses; every route still emits its own named
 *     not-probed FAIL line (never a silent skip).
 *
 * Legs:
 *   • Route envelopes — each armed route is probed with
 *     `GET <base-url>/api/cron/<route>` and recorded as one `ProbeLine`:
 *     the response status plus the success envelope — the payload field
 *     names, with the sweep COUNTS (finite numbers) recorded as
 *     `name=value` evidence. Non-numeric values are never echoed (only
 *     counts are safe to record); the bearer is never echoed anywhere.
 *     The route gates fail closed (a disabled surface answers a bare
 *     404; a wrong bearer answers 401) — every non-2xx status is a FAIL
 *     line, and a transport error is a named unreachable-FAIL line.
 *   • Fan-out transport — checked through the canonical environment
 *     seam: when `REDIS_URL` is set the fan-out transport must resolve
 *     to the Redis bus. Anything else — including no `REDIS_URL` at
 *     all — is a named FAIL: multi-process fan-out would silently
 *     degrade to in-process and the sidecar cannot boot without the
 *     bus. The URL value itself is never echoed.
 *   • Sidecar liveness — the WebSocket sidecar is probed with a plain
 *     GET on its listen address: a live sidecar answers every
 *     non-upgrade request with `426 WebSocket upgrade required` — the
 *     liveness answer. Unreachable or unexpected answers are named FAIL
 *     lines. The listen address comes from the same environment seam
 *     (`--ws-url` overrides it); the liveness probe carries no
 *     credentials.
 *
 * Probe contract (shared across the launch probes): read-only, one
 * `ProbeLine` JSON record per stdout line, exit 0 iff every line is PASS,
 * never a silent skip — an unreachable route is a named FAIL line.
 *
 * Usage:
 *   bun run scripts/launch/verify-cron.ts [--url <base-url>] [--ws-url <sidecar-base-url>] [--help]
 *
 * Exit codes: 0 = every emitted line PASS; 1 = any line FAIL.
 */

import {
  getNotificationFanoutTransport,
  getRedisUrl,
  getWebSocketHost,
  getWebSocketPort,
  type NotificationFanoutTransport,
} from "@/backend/lib/env";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import { emitProbeLines, handleProbeUsage, parseProbeArgs } from "@/scripts/launch/shared/probe-cli";
import { errorMessage } from "@/scripts/ops/backup-toolchain";

/** The four externally-armed cron sweep routes (the arming corroboration set). */
export const CRON_SWEEP_ROUTES: readonly string[] = [
  "/api/cron/sweep-sessions",
  "/api/cron/sweep-inactive-teachers",
  "/api/cron/expire-subscriptions",
  "/api/cron/reconcile-paymob-payments",
];

/** The outbound HTTP surface the probe consumes — the global fetch satisfies it structurally. */
export type ProbeFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Environment variable holding the cron bearer — the only accepted secret source. */
const BEARER_ENV_KEY = "CRON_SECRET";

/** rowId of the bearer line (a named FAIL line when the secret is unset). */
const BEARER_ROW_ID = "verify-cron.bearer";

/** rowId of the fan-out transport resolution line. */
const FANOUT_ROW_ID = "verify-cron.fanout-transport";

/** rowId of the sidecar liveness line. */
const SIDECAR_ROW_ID = "verify-cron.sidecar-healthcheck";

/** The liveness answer a live sidecar gives every non-upgrade request. */
const SIDECAR_LIVENESS_STATUS = 426;

/** Default probe target — an explicitly passed `--url` always wins. */
const DEFAULT_BASE_URL = "http://localhost:3000";

const USAGE = `Usage: bun run scripts/launch/verify-cron.ts [--url <base-url>] [--ws-url <sidecar-base-url>] [--help]

Live-envelope probe for the armed cron sweep routes plus the realtime
arming surfaces (fan-out transport resolution + sidecar liveness). The
bearer is read from the ${BEARER_ENV_KEY} environment variable — never from
argv. Emits one {rowId, result, detail} line per check; exits 0 iff every
line is PASS.`;

/**
 * The realtime-arming environment snapshot the transport and sidecar
 * legs read — the canonical typed getters over raw `process.env`, so the
 * probe asserts the SAME resolution the application performs.
 */
export interface FanoutEnvSnapshot {
  /** `REDIS_URL`, when a Redis bus is configured (`undefined` = no bus). */
  readonly redisUrl: string | undefined;
  /** The resolved fan-out transport (explicit value or the Redis ladder). */
  readonly fanoutTransport: NotificationFanoutTransport;
  /** The sidecar's HTTP base URL (`http://<WS_HOST>:<WS_PORT>`). */
  readonly wsBaseUrl: string;
}

/** The default snapshot: the canonical typed environment seam. */
export function defaultFanoutSnapshot(): FanoutEnvSnapshot {
  return {
    redisUrl: getRedisUrl(),
    fanoutTransport: getNotificationFanoutTransport(),
    wsBaseUrl: `http://${getWebSocketHost()}:${getWebSocketPort()}`,
  };
}

/** Injectable seams (tests stub the fetch transport, the env reads, and the output sinks). */
export interface VerifyCronOptions {
  readonly fetchImpl?: ProbeFetch;
  readonly secretFromEnv?: () => string | undefined;
  readonly fanoutEnv?: () => FanoutEnvSnapshot;
  readonly wsBaseUrl?: string;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

/**
 * Reads the cron bearer from the environment, trimmed: a whitespace-only
 * value counts as unset (fail-closed, mirroring the route gate's own
 * trimmed compare). Returns null when no usable secret exists.
 */
function readBearer(secretFromEnv: () => string | undefined): string | null {
  const trimmed = (secretFromEnv() ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The success envelope, summarized for the evidence line: payload field
 * names, with the sweep COUNTS (finite numbers) recorded as
 * `name=value` — the honest per-run tallies the routes return. Any
 * non-numeric value is recorded as its field NAME only (a value that is
 * not a count could leak; the bearer is never echoed anywhere).
 */
function envelopeSummary(body: unknown): string {
  if (typeof body !== "object" || body === null) return "none";
  const data = Reflect.get(body, "data");
  if (typeof data !== "object" || data === null) return "none";
  const parts = Object.keys(data)
    .toSorted((a, b) => a.localeCompare(b))
    .map(key => {
      const value = Reflect.get(data, key);
      return typeof value === "number" && Number.isFinite(value) ? `${key}=${value}` : key;
    });
  return parts.length > 0 ? parts.join(", ") : "none";
}

/**
 * Probes one route with the production bearer and records its live
 * envelope as a line. The route gates fail closed (a disabled surface
 * answers a bare 404; a wrong bearer answers 401) — every non-2xx status
 * is a FAIL line, and a transport error is a named unreachable-FAIL line.
 */
async function probeRoute(route: string, baseUrl: string, bearer: string, fetchImpl: ProbeFetch): Promise<ProbeLine> {
  try {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method: "GET",
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (!response.ok) {
      return { rowId: route, result: "FAIL", detail: `route gate fail-closed: status ${response.status}` };
    }
    const body: unknown = await response.json().catch(() => null);
    return { rowId: route, result: "PASS", detail: `status ${response.status}; envelope: ${envelopeSummary(body)}` };
  } catch (error) {
    return { rowId: route, result: "FAIL", detail: `route unreachable: ${errorMessage(error)}` };
  }
}

/** The route line emitted when no bearer exists — named, never a silent skip; no request is sent. */
function routeNotProbedLine(route: string): ProbeLine {
  return {
    rowId: route,
    result: "FAIL",
    detail: `not probed — ${BEARER_ENV_KEY} is not set (fail-closed: no unauthenticated request is sent)`,
  };
}

/**
 * The fan-out transport resolution check: with a Redis bus configured
 * (`REDIS_URL` set) the transport must resolve to that bus — anything
 * else silently degrades multi-process fan-out to in-process (and the
 * sidecar cannot boot). No configured bus is equally a named FAIL: the
 * production realtime lane is not armed. The URL value is never echoed.
 */
function probeFanoutTransport(snapshot: FanoutEnvSnapshot): ProbeLine {
  if (snapshot.redisUrl === undefined) {
    return {
      rowId: FANOUT_ROW_ID,
      result: "FAIL",
      detail:
        "REDIS_URL is not set — the Redis bus is not configured (multi-process fan-out degrades to in-process and the sidecar cannot boot)",
    };
  }
  if (snapshot.fanoutTransport !== "redis") {
    return {
      rowId: FANOUT_ROW_ID,
      result: "FAIL",
      detail:
        'REDIS_URL is set but the fan-out transport resolved to "in-process" — multi-process fan-out silently degrades',
    };
  }
  return {
    rowId: FANOUT_ROW_ID,
    result: "PASS",
    detail: "REDIS_URL is set and the fan-out transport resolves to the Redis bus",
  };
}

/**
 * The sidecar liveness check: a plain GET against the sidecar's listen
 * address. A live sidecar answers every non-upgrade request with the
 * liveness status (`426 WebSocket upgrade required`); any other answer
 * is not the sidecar, and a transport error is a named unreachable-FAIL
 * line. The liveness probe carries no credentials.
 */
async function probeSidecarHealthcheck(wsBaseUrl: string, fetchImpl: ProbeFetch): Promise<ProbeLine> {
  try {
    const response = await fetchImpl(wsBaseUrl);
    if (response.status !== SIDECAR_LIVENESS_STATUS) {
      return { rowId: SIDECAR_ROW_ID, result: "FAIL", detail: `unexpected sidecar answer: status ${response.status}` };
    }
    return {
      rowId: SIDECAR_ROW_ID,
      result: "PASS",
      detail: `status ${SIDECAR_LIVENESS_STATUS} — the sidecar answered a non-upgrade liveness probe (WebSocket upgrade required)`,
    };
  } catch (error) {
    return { rowId: SIDECAR_ROW_ID, result: "FAIL", detail: `sidecar unreachable: ${errorMessage(error)}` };
  }
}

/**
 * The probe body: the bearer check, then every armed route probed in
 * parallel, plus the fan-out transport resolution and sidecar liveness
 * legs (both run regardless of the bearer — they carry no credentials). A
 * missing bearer emits its own named FAIL line plus one named not-probed
 * FAIL line per route — no request is ever sent unauthenticated, and no
 * check is ever silently skipped.
 */
export async function verifyCron(baseUrl: string, options: VerifyCronOptions = {}): Promise<readonly ProbeLine[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const secretFromEnv = options.secretFromEnv ?? (() => process.env[BEARER_ENV_KEY]);
  const snapshot = options.fanoutEnv === undefined ? defaultFanoutSnapshot() : options.fanoutEnv();
  const wsBaseUrl = options.wsBaseUrl ?? snapshot.wsBaseUrl;
  const bearer = readBearer(secretFromEnv);
  const bearerLines: ProbeLine[] =
    bearer === null
      ? [
          {
            rowId: BEARER_ROW_ID,
            result: "FAIL",
            detail: `${BEARER_ENV_KEY} is not set — the routes cannot be authenticated (fail-closed)`,
          },
        ]
      : [];
  const routeLines =
    bearer === null
      ? CRON_SWEEP_ROUTES.map(route => routeNotProbedLine(route))
      : await Promise.all(CRON_SWEEP_ROUTES.map(route => probeRoute(route, baseUrl, bearer, fetchImpl)));
  return [
    ...bearerLines,
    ...routeLines,
    probeFanoutTransport(snapshot),
    await probeSidecarHealthcheck(wsBaseUrl, fetchImpl),
  ];
}

/**
 * CLI entry point. Reads args (the tokens after the interpreter and script
 * path) and returns the process exit code. The bearer always comes from
 * the environment — argv carries no secret surface (a `--secret` token is
 * rejected as an unknown argument).
 */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  options: VerifyCronOptions = {}
): Promise<number> {
  const parsed = parseProbeArgs(args, { valueFlags: ["--url", "--ws-url"] });
  const usageExit = handleProbeUsage(
    "verify-cron",
    USAGE,
    parsed,
    options.stdout ?? console.log,
    options.stderr ?? console.error
  );
  if (usageExit !== null) return usageExit;
  const baseUrl = (parsed.values.url ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const wsBaseUrl = parsed.values["ws-url"]?.replace(/\/$/, "");
  return emitProbeLines("verify-cron", await verifyCron(baseUrl, { ...options, wsBaseUrl }), options.stdout);
}

if (import.meta.main) {
  main()
    .then(code => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
