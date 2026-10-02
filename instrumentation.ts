/**
 * Next.js instrumentation — dev-server warm-up for the payment callback
 * channel.
 *
 * `register()` runs once per Next.js server instance before the server
 * handles requests (Next 16 file convention). In development it resolves
 * the callback channel eagerly through the factory's ONE resolver, so the
 * ngrok tunnel (when `NGROK_AUTHTOKEN` + `NGROK_DOMAIN` are configured and
 * the public probe answers) is already up — and the dev console shows
 * which delivery channel is live — before the first purchase instead of at
 * it. The factory owns every tunnel decision (provider gate, key gate,
 * spawn/adoption, readiness probe, simulation fallback with its one
 * structured log); this file adds no tunnel heuristics of its own.
 *
 * The resolution is fire-and-forget: server startup is never blocked, and
 * the factory's lazy singleton shares one in-flight resolution, so a warm
 * -up racing the first intention creation cannot double-spawn the agent.
 * The summary log names only the channel kind and its public base — never
 * the authtoken.
 *
 * Guards: non-node runtimes return (the dynamic import keeps the edge
 * bundle free of the factory), production never resolves a development
 * channel, and test servers (`TEST_SERVER=1`) resolve the simulation
 * channel by design and must not acquire tunnels.
 */

export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  if (process.env.NODE_ENV === "production" || process.env.TEST_SERVER === "1") {
    return;
  }
  void (async () => {
    const { getCallbackChannel } = await import(
      "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory"
    );
    const { logger } = await import("@/backend/lib/logger");
    try {
      const channel = await getCallbackChannel();
      logger.info("Payment callback channel warmed up", {
        kind: channel.kind,
        publicBaseUrl: channel.publicBaseUrl,
      });
    } catch (error) {
      logger.error("Payment callback channel warm-up failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
