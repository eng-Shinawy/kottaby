/**
 * Stamped, redacted JSON artifact writer for the `scripts/load/` CLI
 * tools.
 *
 * Artifacts land under `scratch/load/` (gitignored) as
 * `<prefix>-<UTC-stamp>.json`. The redaction pass enforces the launch
 * report's evidence discipline on load artifacts too: credential-shaped
 * keys are dropped and JWT-shaped strings are masked, so an artifact can
 * only ever carry latency counts, verdicts, and configuration numbers.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Key fragments that mark a value as credential-shaped — dropped recursively. */
const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|credential|dsn/i;

/** Rough JWT shape — three base64url segments joined by dots. */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    const target: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      target[key] = redactValue(nested);
    }
    return target;
  }
  if (typeof value === "string" && JWT_PATTERN.test(value)) {
    return "<redacted-jwt>";
  }
  return value;
}

/** UTC stamp safe for file names (`2026-10-09T12-34-56-789Z`). */
function artifactStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Writes the redacted payload to `scratch/load/<prefix>-<stamp>.json`
 * and returns the written path.
 */
export function writeLoadArtifact(prefix: string, payload: Record<string, unknown>): string {
  const directory = join(process.cwd(), "scratch", "load");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${prefix}-${artifactStamp(new Date())}.json`);
  writeFileSync(path, `${JSON.stringify(redactValue(payload), null, 2)}\n`);
  return path;
}
