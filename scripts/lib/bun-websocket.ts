/**
 * Bridge recovering Bun's extended WebSocket constructor at the type level.
 *
 * Bun's global `WebSocket` accepts a second `options` argument (custom
 * headers for the handshake), but the DOM lib types do not — this helper
 * re-derives the constructor signature so harness scripts can open
 * authenticated sockets without a cast.
 */

export type BunWebSocketConstructor = new (url: string | URL, options?: Bun.WebSocketOptions) => WebSocket;

function isBunWebSocketConstructor(value: unknown): value is BunWebSocketConstructor {
  return typeof value === "function";
}

function resolveBunWebSocketConstructor(): BunWebSocketConstructor {
  const candidate: unknown = WebSocket;
  if (isBunWebSocketConstructor(candidate)) {
    return candidate;
  }
  throw new Error("Bun WebSocket constructor unavailable");
}

export const createBunWebSocket: BunWebSocketConstructor = resolveBunWebSocketConstructor();
