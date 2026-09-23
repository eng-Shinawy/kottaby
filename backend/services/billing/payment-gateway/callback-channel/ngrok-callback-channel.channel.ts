import { spawn as spawnChildProcess } from "node:child_process";

import { DomainError } from "@/backend/lib/errors";
import {
  buildSimulatedProcessedCallback,
  type SimulationSurfaceFetch,
} from "@/backend/services/billing/payment-gateway/callback-channel/simulation-callback-channel.channel";
import type { CallbackChannelKind, CallbackChannelPort, SimulatedCallbackDelivery } from "@/backend/types";

/**
 * Ngrok callback channel — the development tunnel delivery path.
 *
 * When an operator configures a reserved ngrok domain, this channel makes
 * the LOCAL dev server reachable from the OUTSIDE: it adopts a tunnel that
 * already answers at the PUBLIC domain (an operator-started agent, e.g.
 * `bun run ngrok`) instead of spawning a duplicate, and otherwise starts
 * the ngrok agent itself (spawning `ngrok http --url="https://<domain>"
 * <port>` — the documented flag; `--domain` is deprecated on current agent
 * versions) and verifies readiness by probing the PUBLIC domain's health
 * surface. The probe MUST hit the public URL, never the local agent API:
 * the loopback agent port may already belong to another agent on the host,
 * so a local agent answer proves nothing about THIS tunnel. Readiness
 * retries the public probe until a deadline expires — the agent needs a
 * moment to establish the session — and any failure (missing binary, auth
 * error, DNS, timeout, the dev server being down) surfaces as a typed
 * unreachable error the factory translates into the simulation fallback.
 *
 * Secret posture: the authtoken reaches the agent through the child
 * process environment, never the command line (command lines are visible
 * in process listings) and never a log line or error message — agent
 * output is discarded outright.
 *
 * Delivery reuses the simulation channel's callback synthesis: the signed
 * Paymob-shaped body is built by the production signer path and POSTed
 * through the tunnel with the signature in the `hmac` query parameter, so
 * test deliveries traverse the exact wire shape a real provider delivery
 * takes — through the public URL down to the local receiver.
 *
 * The channel is reachable only outside production runtimes. The factory
 * never selects it there, and a fail-closed runtime guard inside both
 * public methods throws if it is ever invoked anyway.
 */

/** Query parameter the provider signs every delivery into. */
const HMAC_QUERY_PARAM = "hmac";

/** Local route segments the channel probes and delivers against. */
const HEALTH_PATH = "/api/health";
const WEBHOOK_PATH = "/api/payments/webhook";

/** Delay between readiness probes while the agent establishes the session. */
const DEFAULT_PROBE_RETRY_DELAY_MS = 500;

/**
 * Handle on the spawned agent process — the only lifecycle surface the
 * channel needs (terminate on shutdown).
 */
export interface NgrokAgentProcess {
  kill(): void;
}

/**
 * Development channel lifecycle seam — terminates any spawned agent so an
 * abandoned tunnel channel (a failed acquisition, a re-resolution after
 * reset) cannot leak the child process.
 */
interface CallbackChannelDisposal {
  dispose(): void;
}

/**
 * Injectable spawn seam — tests and tooling start a fake agent instead of
 * the real binary.
 */
export type NgrokAgentSpawn = (args: {
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}) => NgrokAgentProcess;

/**
 * Injectable shutdown-registration seam: production binds the agent's
 * terminator to the process exit event, tests capture it.
 */
export type NgrokCleanupRegistration = (terminate: () => void) => void;

/**
 * Default spawn: the ngrok agent CLI as a child of this process. The dev
 * server is a Node process (`next dev` runs under `node`), so the spawn
 * goes through `node:child_process` — the API works identically under the
 * Bun test runner and under Node, where the Bun global does not exist.
 */
const defaultSpawnAgent: NgrokAgentSpawn = ({ command, env }) => {
  const child = spawnChildProcess(command[0] ?? "ngrok", command.slice(1), {
    env: { ...env, NODE_ENV: process.env.NODE_ENV },
    stdio: "ignore",
  });
  return { kill: () => child.kill() };
};

/** Default cleanup: terminate the agent when the process exits. */
const defaultCleanupRegistration: NgrokCleanupRegistration = terminate => {
  process.once("exit", terminate);
};

/** Default transport: the runtime's global fetch. */
const defaultSurfaceFetch: SimulationSurfaceFetch = (url, init) => globalThis.fetch(url, init);

/**
 * Configuration resolved once by the factory — the channel itself never
 * reads the environment. `authtoken` and `domain` come from the typed ngrok
 * configuration; `port` is the local dev-server port the tunnel forwards
 * to; `hmacSecret` feeds the reused synthesis builder (null when unset:
 * deliveries then fail closed instead of signing under an empty key);
 * `probeTimeoutMs` bounds the whole readiness sequence and every outbound
 * request; `probeRetryDelayMs` spaces readiness retries; the `spawnAgent`,
 * `fetch`, and `registerCleanup` seams are optional test overrides.
 */
export interface NgrokCallbackChannelConfig {
  readonly authtoken: string;
  readonly domain: string;
  readonly port: number;
  readonly hmacSecret: string | null;
  readonly probeTimeoutMs: number;
  readonly probeRetryDelayMs?: number;
  readonly spawnAgent?: NgrokAgentSpawn;
  readonly fetch?: SimulationSurfaceFetch;
  readonly registerCleanup?: NgrokCleanupRegistration;
}

/** One readiness probe outcome: reachability plus the observed status. */
interface ProbeOutcome {
  readonly reachable: boolean;
  readonly status?: number;
}

/** Development tunnel callback channel against the reserved public domain. */
export class NgrokCallbackChannel implements CallbackChannelPort, CallbackChannelDisposal {
  readonly kind: CallbackChannelKind = "ngrok";
  readonly publicBaseUrl: string;

  /** The spawned agent process (null until the first readiness sequence). */
  private agent: NgrokAgentProcess | null = null;
  /** Whether a readiness probe has succeeded at least once. */
  private ready = false;

  constructor(private readonly config: NgrokCallbackChannelConfig) {
    this.publicBaseUrl = `https://${config.domain}`;
  }

  /**
   * Adopts a tunnel that already answers at the PUBLIC health surface (one
   * probe, no agent spawn — an operator-started agent, e.g. `bun run
   * ngrok`, is reused instead of colliding with it at ERR_NGROK_334), and
   * otherwise starts the agent and probes until it answers or the
   * readiness budget elapses. Idempotent: a ready channel returns
   * immediately without re-spawning or re-probing.
   *
   * @throws DomainError (`PAYMENT_CALLBACK_NGROK_UNREACHABLE`) when the
   *   agent cannot be started or the public probe never answers in budget,
   *   and (`PAYMENT_CALLBACK_NGROK_DISABLED`) when invoked in a production
   *   runtime.
   */
  async ensureReady(): Promise<void> {
    this.assertDevelopmentRuntime();
    if (this.ready) {
      return;
    }
    if ((await this.probeHealth()).reachable) {
      this.ready = true;
      return;
    }
    this.spawnAgentOnce();
    await this.probeUntilReady(Date.now() + this.config.probeTimeoutMs);
    this.ready = true;
  }

  /**
   * Delivers one synthetic settlement callback through the tunnel: the
   * signed body (synthesis reuse) is POSTed with the signature in the
   * `hmac` query parameter to the public webhook surface. Replaying the
   * same arguments re-delivers the byte-identical callback.
   *
   * @throws DomainError (`SERVICE_UNAVAILABLE`) when no HMAC secret is
   *   configured; `PAYMENT_CALLBACK_NGROK_UNREACHABLE` when the tunnel does
   *   not answer; `PAYMENT_CALLBACK_NGROK_DELIVERY_FAILED` when the webhook
   *   surface rejects the delivery; and the production fail-closed guard
   *   as on `ensureReady`.
   */
  async deliverTestCallback(delivery: SimulatedCallbackDelivery): Promise<void> {
    this.assertDevelopmentRuntime();
    const payload = buildSimulatedProcessedCallback(delivery, this.config.hmacSecret);
    const response = await this.postThroughTunnel(this.webhookUrl(payload.hmac), JSON.stringify(payload.body));
    if (!response.ok) {
      throw new DomainError(
        "PAYMENT_CALLBACK_NGROK_DELIVERY_FAILED",
        `The webhook surface rejected the simulated callback with status ${response.status} through ${this.publicBaseUrl}.`
      );
    }
  }

  /** Spawns the agent exactly once and binds its shutdown terminator. */
  private spawnAgentOnce(): void {
    if (this.agent !== null) {
      return;
    }
    const spawn = this.config.spawnAgent ?? defaultSpawnAgent;
    try {
      this.agent = spawn({
        command: ["ngrok", "http", `--url=https://${this.config.domain}`, String(this.config.port)],
        env: this.childEnv(),
      });
    } catch {
      throw new DomainError(
        "PAYMENT_CALLBACK_NGROK_UNREACHABLE",
        `The ngrok agent could not be started for ${this.publicBaseUrl}.`
      );
    }
    (this.config.registerCleanup ?? defaultCleanupRegistration)(() => this.terminateAgent());
  }

  /**
   * The agent's environment: the parent process environment plus the
   * authtoken. The token rides the environment — never the command line —
   * so it cannot leak through process listings, and agent output is
   * discarded so it can never reach a log.
   */
  private childEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    env.NGROK_AUTHTOKEN = this.config.authtoken;
    return env;
  }

  /**
   * Probes the public health surface until it answers (2xx/3xx) or the
   * deadline elapses. Recursive rather than looped: each attempt waits out
   * the retry delay before the next, and the recursion depth is bounded by
   * the readiness budget.
   */
  private async probeUntilReady(deadline: number): Promise<void> {
    const outcome = await this.probeHealth();
    if (outcome.reachable) {
      return;
    }
    if (Date.now() >= deadline) {
      const observed = outcome.status === undefined ? "did not answer" : `answered status ${outcome.status}`;
      throw new DomainError(
        "PAYMENT_CALLBACK_NGROK_UNREACHABLE",
        `The ngrok public probe ${observed} at ${this.publicBaseUrl}${HEALTH_PATH} within the readiness budget.`
      );
    }
    await delay(this.config.probeRetryDelayMs ?? DEFAULT_PROBE_RETRY_DELAY_MS);
    await this.probeUntilReady(deadline);
  }

  /** One public health probe under the configured timeout. */
  private async probeHealth(): Promise<ProbeOutcome> {
    const transport = this.config.fetch ?? defaultSurfaceFetch;
    const probeUrl = `${this.publicBaseUrl}${HEALTH_PATH}`;
    try {
      const response = await transport(probeUrl, {
        method: "GET",
        signal: AbortSignal.timeout(this.config.probeTimeoutMs),
      });
      return { reachable: response.status >= 200 && response.status < 400, status: response.status };
    } catch {
      return { reachable: false };
    }
  }

  /** The signed delivery target on the public webhook surface. */
  private webhookUrl(hmac: string): string {
    return `${this.publicBaseUrl}${WEBHOOK_PATH}?${HMAC_QUERY_PARAM}=${hmac}`;
  }

  /** POSTs one body through the tunnel under the configured timeout. */
  private async postThroughTunnel(url: string, body: string): Promise<Response> {
    const transport = this.config.fetch ?? defaultSurfaceFetch;
    try {
      return await transport(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.config.probeTimeoutMs),
      });
    } catch {
      throw new DomainError("PAYMENT_CALLBACK_NGROK_UNREACHABLE", `The ngrok tunnel did not answer at ${url}.`);
    }
  }

  /**
   * Terminates the spawned agent, if any — the lifecycle seam the factory's
   * failed-acquisition path calls so a tunnel that never became ready does
   * not leave an orphaned child process behind. Idempotent: disposing a
   * channel without a live agent is a no-op.
   */
  dispose(): void {
    this.terminateAgent();
  }

  /** Kills the spawned agent, if any (process-exit cleanup seam). */
  private terminateAgent(): void {
    this.agent?.kill();
    this.agent = null;
  }

  /**
   * Fail-closed runtime guard: tunnel delivery is a development surface by
   * contract, and it must never run in production — not even if a future
   * caller bypasses the factory's resolution rules.
   */
  private assertDevelopmentRuntime(): void {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError(
        "PAYMENT_CALLBACK_NGROK_DISABLED",
        "The ngrok callback channel is reachable only outside production runtimes."
      );
    }
  }
}

/** Waits out one readiness-retry interval. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
