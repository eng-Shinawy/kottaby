/**
 * AdminBroadcastService guards — the country-kind seed canonicalization of
 * `validateAudienceCoherence` (pure unit tier: NO DB, NO server boot, NO
 * network; runs via the mandated runner
 * `bun run test/scripts/run-test.ts backend/services/notifications/admin-broadcast.guards.test.ts`).
 *
 * The country validator resolves its trimmed companion through the shared
 * `countrySeedToCode` bridge — the SAME normalization the directory filter
 * and the admin user patch use — so a resolvable seed canonicalizes onto the
 * dataset pair (canonical English display name + ISO twin) while
 * unresolvable free text keeps the legacy exact-match shape. These tests
 * pin every arm of that bridge at the guard tier, where the service and
 * repository tests then only need one integration probe each.
 *
 * `logger.logDomainError` is stubbed for the rejection probes so expected
 * denials stay silent (the tracked-spy convention of the service suite).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import {
  type ValidatedAudienceSelector,
  validateAudienceCoherence,
} from "@/backend/services/notifications/admin-broadcast.guards";

const LOCALE = "en";
const INVALID_MESSAGE = "audience invalid (test sentinel copy)";

/** The country-kind probe: one canonicalization hop through the guard. */
function validateCountry(country: string): ValidatedAudienceSelector {
  return validateAudienceCoherence({ type: BroadcastAudienceType.Country, country }, LOCALE, INVALID_MESSAGE);
}

describe("validateAudienceCoherence — country-kind seed canonicalization", () => {
  const logSpies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(() => {
    while (logSpies.length > 0) {
      logSpies.pop()?.mockRestore();
    }
  });

  /** Silences the rejection primitive's one bounded diagnostic for a probe. */
  function silenceDomainLogs(): void {
    logSpies.push(
      spyOn(logger, "logDomainError").mockImplementation((_message: string, _ctx?: DomainErrorContext) => {})
    );
  }

  test("a canonical code resolves onto the dataset pair (code + English display name)", () => {
    expect(validateCountry("EG")).toEqual({
      type: BroadcastAudienceType.Country,
      country: "Egypt",
      countryCode: "EG",
    });
  });

  test("padded lowercase code variants normalize onto the same pair", () => {
    expect(validateCountry("  eg ")).toEqual({
      type: BroadcastAudienceType.Country,
      country: "Egypt",
      countryCode: "EG",
    });
  });

  test("legacy English display text resolves onto the same pair (the name arm)", () => {
    expect(validateCountry("Egypt")).toEqual({
      type: BroadcastAudienceType.Country,
      country: "Egypt",
      countryCode: "EG",
    });
    expect(validateCountry("egypt")).toEqual({
      type: BroadcastAudienceType.Country,
      country: "Egypt",
      countryCode: "EG",
    });
  });

  test("unresolvable free text keeps the legacy exact-match shape (code null)", () => {
    const sentinel = `QT${Date.now().toString(36).toUpperCase()}`;
    expect(validateCountry(sentinel)).toEqual({
      type: BroadcastAudienceType.Country,
      country: sentinel,
      countryCode: null,
    });
  });

  test("the trimmed value is what resolves and what persists", () => {
    expect(validateCountry("  Egypt  ")).toEqual({
      type: BroadcastAudienceType.Country,
      country: "Egypt",
      countryCode: "EG",
    });
  });

  test("whitespace-only and over-ceiling values still reject (the pre-existing bounds)", () => {
    silenceDomainLogs();
    expect(() => validateCountry("   ")).toThrow();
    expect(() => validateCountry("C".repeat(101))).toThrow();
  });

  test("a hostile non-country companion still rejects (the coherence matrix is untouched)", () => {
    silenceDomainLogs();
    expect(() =>
      validateAudienceCoherence(
        { type: BroadcastAudienceType.Country, country: "Egypt", role: UserRole.Teacher },
        LOCALE,
        INVALID_MESSAGE
      )
    ).toThrow();
  });

  test("a non-country kind is untouched by the bridge (role arm unchanged)", () => {
    expect(
      validateAudienceCoherence({ type: BroadcastAudienceType.Role, role: UserRole.Teacher }, LOCALE, INVALID_MESSAGE)
    ).toEqual({ type: BroadcastAudienceType.Role, role: UserRole.Teacher });
  });
});
