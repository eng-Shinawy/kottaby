/**
 * Generates `.env.paymob.test` — the dedicated server env file for the live
 * Paymob E2E suite (`bun run test:ui:e2e:paymob`), gitignored like every
 * other `.env*` artifact.
 *
 * The file is `.env.test` (the sanctioned test base: DB, auth, test-CI
 * markers) plus the canonical Paymob block the spawned Next.js server needs
 * to resolve the paymob provider: `PAYMENT_GATEWAY_PROVIDER=paymob`,
 * `PAYMENT_WEBHOOK_ENABLED=true`, and the six `PAYMOB_*` credential keys.
 *
 * Tunnel keys are deliberately NOT emitted: the ngrok free tier answers
 * every non-browser user agent (the channel's readiness probe, and
 * importantly the vendor's own server-side webhook deliveries) with a bare
 * 502 bot-filter page, so a tunnel-dependent E2E could never receive the
 * processed callback on this environment. The E2E server therefore resolves
 * the simulation channel (the documented development default), and the
 * REAL tunnel delivery coverage lives in
 * `test/workflows/billing/paymob-live-tunnel.journey.test.ts`, whose
 * in-process receiver + node-fetch deliveries pass the free-tier filter.
 *
 * Credentials resolve canonical-keys-first with the legacy `Paymob__*`
 * spelling as fallback (same resolution the live test helper uses), read
 * from `.env.test` / `.env` / the process environment — never printed. The
 * legacy `Paymob__*` lines and any existing `NGROK_*`/`PAYMOB_*`/payment
 * lines are stripped from the base so the emitted block is the single
 * source of truth.
 *
 * Usage:
 *   bun run test/scripts/gen-paymob-test-env.ts [--port 3100] [--check]
 *   --check  exit 0/1 without writing (preflight for runner scripts)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_FILE = ".env.paymob.test";
const BASE_ENV_FILE = ".env.test";
const LEGACY_ENV_FILE = ".env";

/** Keys removed from the base file before the generated blocks are appended. */
const STRIP_PREFIXES = [
  "PAYMOB_",
  "NGROK_",
  "Paymob__",
  "PAYMENT_GATEWAY_PROVIDER",
  "PAYMENT_WEBHOOK_ENABLED",
  "PORT",
  "NEXT_PUBLIC_APP_URL",
] as const;

interface CliOptions {
  readonly port: number;
  readonly check: boolean;
}

function parseArgs(args: string[]): CliOptions {
  let port = 3100;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" && index + 1 < args.length) {
      const parsed = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65535) {
        port = parsed;
      }
      index += 1;
    } else if (arg.startsWith("--port=")) {
      const parsed = Number.parseInt(arg.split("=")[1] ?? "", 10);
      if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65535) {
        port = parsed;
      }
    } else if (arg === "--check") {
      check = true;
    }
  }
  return { port, check };
}

/** Reads a dotenv-style file into a flat map (last value wins; no expansion). */
function parseEnvFile(path: string): Map<string, string> {
  const parsed = new Map<string, string>();
  if (!existsSync(path)) {
    return parsed;
  }
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    parsed.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return parsed;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

/**
 * Resolves one credential member canonical-first, then the legacy
 * `Paymob__` spelling, across the env files and the process environment.
 */
function resolveMember(canonical: string, legacy: string | null, ...sources: Map<string, string>[]): string | null {
  const candidates: string[] = [canonical, ...(legacy ? [legacy] : [])];
  for (const key of candidates) {
    const fromProcess = nonEmpty(process.env[key]);
    if (fromProcess !== null) {
      return fromProcess;
    }
    for (const source of sources) {
      const fromFile = nonEmpty(source.get(key));
      if (fromFile !== null) {
        return fromFile;
      }
    }
  }
  return null;
}

function main(): void {
  const { port, check } = parseArgs(process.argv.slice(2));

  const base = parseEnvFile(BASE_ENV_FILE);
  const legacy = parseEnvFile(LEGACY_ENV_FILE);

  const secretKey = resolveMember("PAYMOB_SECRET_KEY", "Paymob__SecretKey", base, legacy);
  const publicKey = resolveMember("PAYMOB_PUBLIC_KEY", "Paymob__PublicKey", base, legacy);
  const hmacSecret = resolveMember("PAYMOB_HMAC_SECRET", "Paymob__HmacSecret", base, legacy);
  const apiKey = resolveMember("PAYMOB_API_KEY", "Paymob__ApiKey", base, legacy);
  const integrationIdCard = resolveMember("PAYMOB_INTEGRATION_ID_CARD", "Paymob__IntegrationId", base, legacy);

  const missing: string[] = [];
  if (secretKey === null) missing.push("PAYMOB_SECRET_KEY");
  if (publicKey === null) missing.push("PAYMOB_PUBLIC_KEY");
  if (hmacSecret === null) missing.push("PAYMOB_HMAC_SECRET");
  if (apiKey === null) missing.push("PAYMOB_API_KEY");
  if (integrationIdCard === null) missing.push("PAYMOB_INTEGRATION_ID_CARD");
  if (missing.length > 0) {
    process.stderr.write(
      `[gen-paymob-test-env] cannot generate ${OUTPUT_FILE}: missing ${missing.join(", ")}.\n` +
        `Add the Paymob sandbox credentials to ${BASE_ENV_FILE} or ${LEGACY_ENV_FILE} (see .env.example).\n`
    );
    process.exit(1);
  }

  if (check) {
    process.stdout.write(`[gen-paymob-test-env] live credentials resolvable; ${OUTPUT_FILE} is generatable.\n`);
    return;
  }

  const lines: string[] = [];
  for (const rawLine of readFileSync(BASE_ENV_FILE, "utf8").split("\n")) {
    const key = rawLine.trim().split("=")[0]?.trim() ?? "";
    if (STRIP_PREFIXES.some(prefix => key === prefix || key.startsWith(prefix))) {
      continue;
    }
    lines.push(rawLine);
  }

  lines.push(
    "",
    "# ─── Generated by test/scripts/gen-paymob-test-env.ts (gitignored) ──────────",
    "# Live Paymob sandbox provider for the E2E purchase funnel — do not edit by hand.",
    "# NGROK_* deliberately ABSENT: the ngrok free tier 502s every non-browser",
    "# user agent (the vendor's server-side webhook deliveries included), so the",
    "# E2E resolves the simulation channel; real tunnel delivery is covered by",
    "# test/workflows/billing/paymob-live-tunnel.journey.test.ts.",
    `PORT=${port}`,
    `NEXT_PUBLIC_APP_URL=http://localhost:${port}`,
    "PAYMENT_GATEWAY_PROVIDER=paymob",
    "PAYMENT_WEBHOOK_ENABLED=true",
    "TEST_CI=1",
    `PAYMOB_SECRET_KEY=${secretKey}`,
    `PAYMOB_PUBLIC_KEY=${publicKey}`,
    `PAYMOB_HMAC_SECRET=${hmacSecret}`,
    `PAYMOB_API_KEY=${apiKey}`,
    `PAYMOB_INTEGRATION_ID_CARD=${integrationIdCard}`,
    "# Tunnel keys deliberately EMPTY: backend/lib/env.ts's dev-.env DB override",
    "# re-loads the operator's NGROK_* values inside the spawned server, which",
    "# would route the server through the free-tier tunnel (502s non-browser",
    "# user agents). Empty overrides win the last-value-wins dotenv order.",
    "NGROK_AUTHTOKEN=",
    "NGROK_DOMAIN=",
    `NGROK_PORT=${port}`,
    ""
  );

  writeFileSync(OUTPUT_FILE, lines.join("\n"), { mode: 0o600 });
  process.stdout.write(
    `[gen-paymob-test-env] wrote ${join(process.cwd(), OUTPUT_FILE)} (server port ${port}; tunnel forwarded to it).\n`
  );
}

main();
