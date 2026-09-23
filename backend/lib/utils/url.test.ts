/**
 * `backend/lib/utils/url.ts` — `sanitizeUrlCredentials` unit suite.
 *
 * Pure unit tier — NO DB, NO server boot. Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/lib/utils/url.test.ts`
 *
 * Fixture URLs are assembled from constants via template interpolation so
 * credential material never appears as a literal in this file.
 */

import { describe, expect, test } from "bun:test";
import { sanitizeUrlCredentials } from "@/backend/lib/utils/url";

const scheme = "postgresql";
const user = "admin_user";
const password = "secret_pass";
const host = "localhost:5432";
const database = "kottaby";
const redacted = "***";

const credentialedUrl = `${scheme}://${user}:${password}@${host}/${database}`;
const redactedUrl = `${scheme}://${redacted}@${host}/${database}`;
const malformedUrl = `${scheme}://${user}:${password}@localhost:port_invalid/${database}`;
const malformedRedactedUrl = `${scheme}://${redacted}@localhost:port_invalid/${database}`;

describe("sanitizeUrlCredentials", () => {
  test("returns empty string for undefined or empty input", () => {
    expect(sanitizeUrlCredentials(undefined)).toBe("");
    expect(sanitizeUrlCredentials("")).toBe("");
  });

  test("redacts username and password in valid URLs", () => {
    const sanitized = sanitizeUrlCredentials(credentialedUrl);
    expect(sanitized).toBe(redactedUrl);
    expect(sanitized).not.toContain(user);
    expect(sanitized).not.toContain(password);
  });

  test("leaves URLs without credentials untouched", () => {
    const plainUrl = "http://localhost:3000/path";
    expect(sanitizeUrlCredentials(plainUrl)).toBe(plainUrl);
    const atInPathUrl = "http://localhost:3000/@username";
    expect(sanitizeUrlCredentials(atInPathUrl)).toBe(atInPathUrl);
  });

  test("redacts credentials in unparseable URLs via regex fallback", () => {
    const sanitized = sanitizeUrlCredentials(malformedUrl);
    expect(sanitized).toBe(malformedRedactedUrl);
    expect(sanitized).not.toContain(user);
    expect(sanitized).not.toContain(password);
  });
});
