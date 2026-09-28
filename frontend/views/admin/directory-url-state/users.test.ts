/**
 * `/users` directory URL-contract round-trip — the pure parse/serialize half
 * of the shareable filtered-view feature.
 *
 * Pins (focusing the applicant-lifecycle keys this module owns):
 *  - `cooldown` parses ONLY the canonical lowercase wire values verbatim
 *    (fail-closed: unknown spellings fall back to the unfiltered default);
 *  - `expiring` parses ONLY the sanctioned spellings (`1` / `true`) into the
 *    window narrow — a hand-edited or stale link can never poison the
 *    directory state;
 *  - serialize OMITTS every default (a clean URL shares as the bare path)
 *    and emits the panel's exact deep-link shape for the applied filters;
 *  - the round-trip parse(serialize(x)) ≡ x for every applied member.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/views/admin/directory-url-state/users.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { parseUsersUrlState, serializeUsersUrlState } from "@/frontend/views/admin/directory-url-state/users";

/** Minimal ReadableSearchParams stand-in built from a plain record. */
function paramsOf(record: Record<string, string>): { get: (key: string) => string | null } {
  return {
    get: (key: string) => (key in record ? record[key] : null),
  };
}

const EMPTY: Record<string, string> = {};

describe("users URL state — parse direction (fail-closed)", () => {
  test("cooldown parses the canonical wire values verbatim and rejects foreign spellings", () => {
    expect(parseUsersUrlState(paramsOf({ cooldown: "active" })).cooldownState).toBe("Active");
    expect(parseUsersUrlState(paramsOf({ cooldown: "expired" })).cooldownState).toBe("Expired");
    expect(parseUsersUrlState(paramsOf({ cooldown: "none" })).cooldownState).toBe("None");
    // Fail-closed: uppercase / typo / empty all read as the default.
    expect(parseUsersUrlState(paramsOf({ cooldown: "ACTIVE" })).cooldownState).toBe("");
    expect(parseUsersUrlState(paramsOf({ cooldown: "actve" })).cooldownState).toBe("");
    expect(parseUsersUrlState(paramsOf(EMPTY)).cooldownState).toBe("");
  });

  test("expiring parses ONLY the sanctioned spellings into the window narrow", () => {
    expect(parseUsersUrlState(paramsOf({ expiring: "1" })).cooldownExpiringSoon).toBe(true);
    expect(parseUsersUrlState(paramsOf({ expiring: "true" })).cooldownExpiringSoon).toBe(true);
    // Fail-closed: yes/0/on and even `TRUE` (case-sensitive contract) fall back.
    expect(parseUsersUrlState(paramsOf({ expiring: "yes" })).cooldownExpiringSoon).toBe(false);
    expect(parseUsersUrlState(paramsOf({ expiring: "0" })).cooldownExpiringSoon).toBe(false);
    expect(parseUsersUrlState(paramsOf({ expiring: "TRUE" })).cooldownExpiringSoon).toBe(false);
    expect(parseUsersUrlState(paramsOf(EMPTY)).cooldownExpiringSoon).toBe(false);
  });
});

describe("users URL state — serialize direction (clean URLs)", () => {
  const base = {
    q: "",
    role: "" as const,
    governance: "" as const,
    applicantStatus: "" as const,
    cooldownState: "" as const,
    cooldownExpiringSoon: false,
    country: "",
    page: 0,
    pageSize: 10,
  };

  test("defaults serialize to an EMPTY query string (untouched surface shares as the bare path)", () => {
    expect(serializeUsersUrlState(base)).toBe("");
  });

  test("the expiring-soon narrow serializes as expiring=1 alongside its state narrow", () => {
    const applied = { ...base, cooldownState: "Active" as const, cooldownExpiringSoon: true };
    expect(serializeUsersUrlState(applied)).toBe("cooldown=active&expiring=1");
  });

  test("the window narrow WITHOUT the state narrow still serializes standalone", () => {
    const applied = { ...base, cooldownExpiringSoon: true };
    expect(serializeUsersUrlState(applied)).toBe("expiring=1");
  });
});

describe("users URL state — round-trip", () => {
  test("parse(serialize(applied)) ≡ applied for the lifecycle members", () => {
    const search = serializeUsersUrlState({
      q: "",
      role: "",
      governance: "",
      applicantStatus: "Failed" as const,
      cooldownState: "Active" as const,
      cooldownExpiringSoon: true,
      country: "",
      page: 0,
      pageSize: 10,
    });
    const parsed = parseUsersUrlState(paramsOf(Object.fromEntries(new URLSearchParams(search))));
    expect(parsed.applicantStatus).toBe("Failed");
    expect(parsed.cooldownState).toBe("Active");
    expect(parsed.cooldownExpiringSoon).toBe(true);
  });
});
