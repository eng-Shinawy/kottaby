import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import {
  getEnvironmentConfig,
  getPaymentGatewayProvider,
  getPaymobConfig,
  resetEnvironmentCache,
} from "@/backend/lib/env";
import { DomainError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  type NgrokAgentSpawn,
  NgrokCallbackChannel,
  type NgrokCallbackChannelConfig,
  type NgrokCleanupRegistration,
} from "@/backend/services/billing/payment-gateway/callback-channel/ngrok-callback-channel.channel";
import {
  SimulationCallbackChannel,
  type SimulationCallbackChannelConfig,
  type SimulationSurfaceFetch,
} from "@/backend/services/billing/payment-gateway/callback-channel/simulation-callback-channel.channel";
import type { CallbackChannelPort } from "@/backend/types";

/**
 * Callback channel factory — the single source of truth for how a provider
 * callback reaches this deployment's webhook receiver.
 *
 * Consumers (intention URL composition, dev tooling, workflow tests) call
 * `getCallbackChannel()` and never read tunnel configuration themselves:
 * this module is the ONLY place that consults the ngrok configuration keys,
 * so per-file tunnel heuristics cannot appear anywhere else.
 *
 * Resolution semantics (development defaults to the fully implemented
 * simulation channel — offline and dependency-free):
 *  - A production runtime, or any deployment whose active provider is not
 *    paymob, resolves the `real` channel: the provider posts to the
 *    operator-configured dashboard URL, so this deployment owns no delivery
 *    infrastructure (`publicBaseUrl: null`) and answers test deliveries
 *    with a fail-closed domain error.
 *  - In development with paymob active, a tunnel channel is eligible only
 *    when BOTH the ngrok authtoken and the reserved public domain are
 *    configured AND the tunnel's own readiness sequence succeeds — the
 *    channel spawns the ngrok agent and probes the PUBLIC reserved-domain
 *    URL, so the decision covers the whole acquisition, not just the
 *    configuration keys.
 *  - Every other development case — tunnel keys absent, or the tunnel not
 *    usable — resolves the simulation channel, with exactly ONE structured
 *    info log naming the fallback reason. Tunnel configuration is optional
 *    operator setup: it is never an error and never blocks development.
 *
 * The resolved channel is a lazy singleton (same shape as the payment
 * gateway factory): `resetCallbackChannel()` drops it together with the
 * shared env snapshot, so configuration swaps take effect on the next
 * resolution without a process restart. Concurrent first callers share one
 * in-flight resolution, so a burst of first calls cannot double-run the
 * tunnel acquisition (double agent spawn, double fallback log); a reset
 * mid-flight discards the pending cache write so the next resolution
 * re-reads configuration from scratch.
 */

/** The resolved channel singleton (bounded to exactly one instance; reset-able). */
let channel: CallbackChannelPort | null = null;

/** The in-flight first resolution, shared by concurrent callers (reset-able). */
let channelResolution: Promise<CallbackChannelPort> | null = null;

/**
 * Injectable test-delivery seams for the tunnel channel's outbound surfaces
 * (agent spawn, transport, cleanup registration) — captured when the tunnel
 * configuration lands and consumed once at channel construction. Null in
 * production: production never resolves a development channel.
 */
let testDeliverySeams: {
  readonly spawnAgent?: NgrokAgentSpawn;
  readonly fetch?: SimulationSurfaceFetch;
  readonly registerCleanup?: NgrokCleanupRegistration;
} | null = null;

/** Floor for the readiness-retry interval — a dead tunnel must fall back quickly. */
const MIN_PROBE_RETRY_DELAY_MS = 250;

/**
 * The paymob provider selector as a plain string — the env getter answers
 * the raw (trimmed, lowercased) string, and widening the enum member keeps
 * the comparison string-to-string.
 */
const PAYMOB_PROVIDER_VALUE: string = PaymentGateway.Paymob;

/**
 * Why a development resolution fell back to the simulation channel. The
 * tunnel acquisition seam owns this vocabulary; every reason is named in
 * the one structured fallback log.
 */
type TunnelFallbackReason = "ngrok-not-configured" | "ngrok-unreachable";

/** Result of a development tunnel acquisition attempt. */
type TunnelAcquisition =
  | { readonly channel: CallbackChannelPort; readonly fallbackReason?: undefined; readonly fallbackDetail?: undefined }
  | {
      readonly channel?: undefined;
      readonly fallbackReason: TunnelFallbackReason;
      /** The tunnel's own error message; never carries secret material. */
      readonly fallbackDetail?: string;
    };

/**
 * The production callback channel: the provider delivers to the public URL
 * configured in the merchant dashboard, so there is nothing to start up
 * (`ensureReady` is a no-op) and no public base this deployment could name.
 * Test delivery is a development-only surface — answering it with a typed
 * failure keeps a production caller from synthesizing settlements.
 */
const REAL_CALLBACK_CHANNEL: CallbackChannelPort = {
  kind: "real",
  publicBaseUrl: null,
  ensureReady: async () => {},
  deliverTestCallback: async () => {
    throw new DomainError(
      "PAYMENT_CALLBACK_TEST_DELIVERY_UNSUPPORTED",
      "Test callback delivery is a development-only surface; the real channel receives provider deliveries at its operator-configured URL."
    );
  },
};

/**
 * Returns the active callback delivery channel, resolving it on first use
 * and reusing the resolved instance afterwards. Development resolution may
 * consult the tunnel acquisition seam, so the first call is awaitable.
 * Concurrent first callers share the same in-flight resolution: the tunnel
 * acquisition (agent spawn, fallback logging) runs at most once per
 * resolution epoch.
 */
export async function getCallbackChannel(): Promise<CallbackChannelPort> {
  if (channel) {
    return channel;
  }
  if (channelResolution === null) {
    const resolution = resolveCallbackChannel().then(resolved => {
      channel = resolved;
      channelResolution = null;
      return resolved;
    });
    channelResolution = resolution;
  }
  return channelResolution;
}

/**
 * Invalidates the resolved channel, the shared env snapshot it was resolved
 * from, and any captured test-delivery seams. The next
 * `getCallbackChannel()` re-reads configuration from scratch, so env swaps
 * and test fixtures take effect immediately.
 */
export function resetCallbackChannel(): void {
  channel = null;
  channelResolution = null;
  testDeliverySeams = null;
  resetEnvironmentCache();
}

/**
 * Captures the test-delivery seams a channel-aware harness drives the
 * tunnel channel through (agent spawn stand-in, outbound transport,
 * cleanup registration). Development-only configuration: the seams are
 * consumed once at the next tunnel-channel construction and dropped by
 * `resetCallbackChannel()`. A production runtime rejects the call —
 * production never resolves a development channel, so the seams could
 * never be consumed there.
 */
export function configureCallbackChannelTestDelivery(seams: {
  readonly spawnAgent?: NgrokAgentSpawn;
  readonly fetch?: SimulationSurfaceFetch;
  readonly registerCleanup?: NgrokCleanupRegistration;
}): void {
  if (isProductionRuntime()) {
    throw new DomainError(
      "PAYMENT_CALLBACK_TEST_DELIVERY_UNSUPPORTED",
      "Test callback delivery is a development-only surface; the real channel receives provider deliveries at its operator-configured URL."
    );
  }
  testDeliverySeams = seams;
}

/** One resolution pass over the documented resolution order. */
async function resolveCallbackChannel(): Promise<CallbackChannelPort> {
  if (isProductionRuntime() || getPaymentGatewayProvider() !== PAYMOB_PROVIDER_VALUE) {
    return REAL_CALLBACK_CHANNEL;
  }
  const acquisition = await acquireTunnelChannel();
  if (acquisition.channel) {
    return acquisition.channel;
  }
  logger.info("Callback delivery channel resolved to simulation", {
    reason: acquisition.fallbackReason,
    detail: acquisition.fallbackDetail,
  });
  return new SimulationCallbackChannel(resolveSimulationChannelConfig());
}

/**
 * The single acquisition seam for the development tunnel channel. Tunnel
 * eligibility is decided here from the typed ngrok configuration (both the
 * authtoken and a usable reserved public domain must be set); the eligible
 * case constructs the tunnel channel and verifies its readiness sequence —
 * the channel spawns the ngrok agent and probes the PUBLIC reserved-domain
 * URL — falling back to simulation with a named reason when that sequence
 * fails. A failed readiness sequence disposes the spawned channel first, so
 * an acquisition that never became ready cannot leak the ngrok child
 * process. The detail carries the tunnel's own error message (never the
 * authtoken); an unconfigured deployment is never an error.
 */
async function acquireTunnelChannel(): Promise<TunnelAcquisition> {
  const { authtoken, domain } = getEnvironmentConfig().ngrok;
  if (!authtoken || !domain) {
    return { fallbackReason: "ngrok-not-configured" };
  }
  if (domain.includes("://")) {
    return { fallbackReason: "ngrok-not-configured" };
  }
  const normalizedDomain = domain.endsWith("/") ? domain.slice(0, -1) : domain;
  if (normalizedDomain.length === 0) {
    return { fallbackReason: "ngrok-not-configured" };
  }
  const tunnel = new NgrokCallbackChannel(resolveNgrokChannelConfig(authtoken, normalizedDomain));
  try {
    await tunnel.ensureReady();
  } catch (error) {
    tunnel.dispose();
    return {
      fallbackReason: "ngrok-unreachable",
      fallbackDetail: error instanceof Error ? error.message : String(error),
    };
  }
  return { channel: tunnel };
}

/**
 * Reads the ngrok channel's configuration from the typed env snapshot. The
 * eligibility check already narrowed the authtoken and the domain (both
 * configured and normalized — no scheme prefix, no trailing slash); the
 * test-delivery seams (transport, spawn, cleanup registration) are
 * injectable so channel-aware tests and tooling can drive the channel
 * without touching the network or the real agent binary.
 */
function resolveNgrokChannelConfig(authtoken: string, domain: string): NgrokCallbackChannelConfig {
  const { hmacSecret, httpTimeoutMs } = getPaymobConfig();
  const { port } = getEnvironmentConfig().ngrok;
  const channelConfig: {
    authtoken: string;
    domain: string;
    port: number;
    hmacSecret: string | null;
    probeTimeoutMs: number;
    probeRetryDelayMs: number;
    spawnAgent?: NgrokAgentSpawn;
    fetch?: SimulationSurfaceFetch;
    registerCleanup?: NgrokCleanupRegistration;
  } = {
    authtoken,
    domain,
    port,
    hmacSecret,
    probeTimeoutMs: httpTimeoutMs,
    probeRetryDelayMs: resolveProbeRetryDelayMs(),
  };
  if (testDeliverySeams !== null) {
    channelConfig.spawnAgent = testDeliverySeams.spawnAgent;
    channelConfig.fetch = testDeliverySeams.fetch;
    channelConfig.registerCleanup = testDeliverySeams.registerCleanup;
  }
  return channelConfig;
}

/**
 * Readiness-retry interval: the readiness budget is the paymob HTTP timeout
 * (10s default); a 500ms retry delay leaves roughly twenty public probes in
 * budget — enough for the agent to establish the tunnel session, small
 * enough that a dead tunnel falls back quickly.
 */
function resolveProbeRetryDelayMs(): number {
  return Math.max(Math.floor(getPaymobConfig().httpTimeoutMs / 20), MIN_PROBE_RETRY_DELAY_MS);
}

/** Reads the simulation channel's configuration from the typed env snapshot. */
function resolveSimulationChannelConfig(): SimulationCallbackChannelConfig {
  const { hmacSecret, httpTimeoutMs } = getPaymobConfig();
  const { port } = getEnvironmentConfig().ngrok;
  return {
    hmacSecret,
    localBaseUrl: `http://localhost:${port}`,
    probeTimeoutMs: httpTimeoutMs,
  };
}

/** Production runtimes never resolve a development channel. */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}
