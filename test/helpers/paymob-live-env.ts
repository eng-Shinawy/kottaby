/**
 * Live Paymob credentials resolver for the opt-in live provider suites
 * (`test/integration/paymob/`, the live tunnel journey, and the Paymob E2E).
 *
 * Canonical `PAYMOB_*` keys (the documented operator configuration, see
 * `.env.example`) take precedence; the legacy `Paymob__*` spelling from
 * earlier operator exports is honored as a fallback so pre-existing local
 * env files keep working without a rename.
 *
 * Gating is deliberately two-key: live vendor traffic NEVER happens unless
 * the caller explicitly opts in via `PAYMOB_LIVE_TESTS=1` AND a full
 * credential set resolves. Plain `bun run test` / `test:integration` runs
 * therefore skip these suites even on machines whose env files carry real
 * sandbox credentials — every live file gates on
 * {@link arePaymobLiveTestsEnabled} (plus the tunnel gate where the tunnel
 * is part of the flow).
 *
 * Production keys are refused outright: a resolved `sk_live_…` secret key
 * skips the suites (never runs them) unless the operator adds the explicit
 * override `PAYMOB_ALLOW_PROD_KEYS=1` — an operator-error guard against
 * creating real production intentions from a live run.
 *
 * Secrets never leave this module's callers: the resolver returns them for
 * env-fixture installation, and no log line or assertion message may
 * include them.
 */

/** A fully resolved live Paymob credential set (test-mode or production keys). */
export interface PaymobLiveCredentials {
  readonly secretKey: string;
  readonly publicKey: string;
  readonly hmacSecret: string;
  readonly apiKey: string;
  readonly integrationIdCard: number;
  readonly integrationIdWallet: number | null;
}

/** The ngrok tunnel configuration the live tunnel suites require. */
export interface NgrokTunnelConfig {
  readonly authtoken: string;
  readonly domain: string;
  readonly port: number;
}

/** The canonical env keys the live fixture installs (and later restores). */
const PAYMOB_ENV_KEYS = [
  "PAYMOB_SECRET_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_API_KEY",
  "PAYMOB_INTEGRATION_ID_CARD",
  "PAYMOB_INTEGRATION_ID_WALLET",
] as const;

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

/**
 * True when the current run explicitly opted into live Paymob traffic via
 * the dedicated runner scripts (`PAYMOB_LIVE_TESTS=1`).
 */
export function isPaymobLiveRunRequested(): boolean {
  return process.env.PAYMOB_LIVE_TESTS === "1";
}

/** Parses a non-negative decimal integer env value; anything else is `null`. */
function parseOptionalInteger(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** The explicit override env that re-enables live suites under production keys. */
const PROD_KEY_OVERRIDE_ENV = "PAYMOB_ALLOW_PROD_KEYS" as const;

/** True when the resolved secret key is a production-mode Paymob key (`sk_live_…`). */
function isProductionSecretKey(secretKey: string): boolean {
  return secretKey.startsWith("sk_live_");
}

/**
 * Resolves the live credential set from the process environment: canonical
 * `PAYMOB_*` keys first, then the legacy `Paymob__*` spelling. Returns
 * `null` when any required member is missing — the caller must skip, never
 * guess, a partial credential set. A resolved `sk_live_…` key also returns
 * `null` (skip, never run) unless `PAYMOB_ALLOW_PROD_KEYS=1` explicitly
 * allows production keys.
 */
export function resolvePaymobLiveCredentials(): PaymobLiveCredentials | null {
  const secretKey = nonEmpty(process.env.PAYMOB_SECRET_KEY) ?? nonEmpty(process.env.Paymob__SecretKey);
  const publicKey = nonEmpty(process.env.PAYMOB_PUBLIC_KEY) ?? nonEmpty(process.env.Paymob__PublicKey);
  const hmacSecret = nonEmpty(process.env.PAYMOB_HMAC_SECRET) ?? nonEmpty(process.env.Paymob__HmacSecret);
  const apiKey = nonEmpty(process.env.PAYMOB_API_KEY) ?? nonEmpty(process.env.Paymob__ApiKey);
  const integrationIdCard =
    parseOptionalInteger(process.env.PAYMOB_INTEGRATION_ID_CARD) ??
    parseOptionalInteger(process.env.Paymob__IntegrationId);
  const integrationIdWallet = parseOptionalInteger(process.env.PAYMOB_INTEGRATION_ID_WALLET);

  if (
    secretKey === null ||
    publicKey === null ||
    hmacSecret === null ||
    apiKey === null ||
    integrationIdCard === null
  ) {
    return null;
  }
  // Production-key refusal (see the module docblock): live vendor traffic
  // under `sk_live_` keys needs the explicit override, without echoing the
  // key itself anywhere.
  if (isProductionSecretKey(secretKey) && process.env[PROD_KEY_OVERRIDE_ENV] !== "1") {
    return null;
  }
  return { secretKey, publicKey, hmacSecret, apiKey, integrationIdCard, integrationIdWallet };
}

/**
 * Resolves the ngrok tunnel configuration (both keys required, per the
 * callback-channel factory's eligibility rule). Returns `null` when either
 * key is absent so tunnel-dependent suites skip cleanly.
 */
export function resolveNgrokTunnelConfig(): NgrokTunnelConfig | null {
  const authtoken = nonEmpty(process.env.NGROK_AUTHTOKEN);
  const domain = nonEmpty(process.env.NGROK_DOMAIN);
  if (authtoken === null || domain === null || domain.includes("://")) {
    return null;
  }
  const port = parseOptionalInteger(process.env.NGROK_PORT) ?? 3000;
  return { authtoken, domain: domain.endsWith("/") ? domain.slice(0, -1) : domain, port };
}

/** Live API suites run only when explicitly opted in AND fully credentialed. */
export function arePaymobLiveTestsEnabled(): boolean {
  return isPaymobLiveRunRequested() && resolvePaymobLiveCredentials() !== null;
}

/** Tunnel suites additionally require a resolvable reserved-domain config. */
export function arePaymobLiveTunnelTestsEnabled(): boolean {
  return arePaymobLiveTestsEnabled() && resolveNgrokTunnelConfig() !== null;
}

/**
 * Installs the canonical env fixture the gateway adapter + callback-channel
 * factory read (`getPaymobConfig()`), from the resolved live credentials.
 * Callers MUST pair this with the returned restore function in `afterAll`
 * (and call `resetEnvironmentCache()` / the factory resets around it).
 */
export function installPaymobLiveEnvFixture(creds: PaymobLiveCredentials): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of PAYMOB_ENV_KEYS) {
    saved.set(key, process.env[key]);
  }
  process.env.PAYMOB_SECRET_KEY = creds.secretKey;
  process.env.PAYMOB_PUBLIC_KEY = creds.publicKey;
  process.env.PAYMOB_HMAC_SECRET = creds.hmacSecret;
  process.env.PAYMOB_API_KEY = creds.apiKey;
  process.env.PAYMOB_INTEGRATION_ID_CARD = String(creds.integrationIdCard);
  if (creds.integrationIdWallet !== null) {
    process.env.PAYMOB_INTEGRATION_ID_WALLET = String(creds.integrationIdWallet);
  } else {
    delete process.env.PAYMOB_INTEGRATION_ID_WALLET;
  }
  return () => {
    for (const [key, value] of saved.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
