/**
 * Admin user-management helpers tests — the pure update-path country bridge
 * (`buildUpdatePatch`) plus the defense-in-depth `validateUpdatePatch` guard
 * for the service-derived `countryCode` twin.
 *
 * Why a dedicated pure tier: the admin EDIT dialog now submits the shared
 * `CountrySelector`'s ISO code, while the `AdminUpdateUserInput.country`
 * wire field stays legacy nullable `String` (pinned by
 * `country-input-retype.wire.test.ts`). The bridge is the contract that
 * keeps every write path on ONE row shape — `countryCode` non-null ⟺
 * `country` is a dataset display name — for every historical spelling the
 * surface has ever accepted:
 *  - canonical codes ("EG") and padded/lowercase variants (" eg ") resolve
 *    onto the code + English display-name pair,
 *  - legacy display text ("Egypt" — what the free-text edit field and older
 *    consumers sent) resolves through the same case-insensitive index the
 *    directory-filter URL seed uses, so a legacy patch UPDATES the twin
 *    instead of erasing it,
 *  - truly unresolvable free text keeps its legacy shape (raw text +
 *    `countryCode: null`) rather than persisting an unmapped code,
 *  - the audit `changedFields` projection therefore includes `countryCode`
 *    whenever a country value is patched (pinned through the service suite).
 *
 * The create path is intentionally NOT bridged here — its wire input is
 * already the `CountryCode` scalar and `buildCreateUserInsert` pins the
 * strict normalize→membership pipeline (covered by the service suite).
 *
 * Pure unit tier — NO DB, NO server boot, NO disk writes. Runs via the
 * mandated runner:
 *   bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts
 */

import { describe, expect, test } from "bun:test";
import { Gender } from "@/backend/enum/users/gender.enum";
import { ValidationError } from "@/backend/lib/errors";
import { buildUpdatePatch, validateUpdatePatch } from "@/backend/services/admin/user-management.helpers";
import type { AdminUpdateUserPatchInput } from "@/backend/types";
import { COUNTRIES } from "@/shared/constants/countries";

/**
 * Type-guard / assertion helper: narrows a caught `Error` to
 * `ValidationError` via a real `instanceof` runtime check — the
 * `no-unsafe-type-assertion`-safe alternative to `error as ValidationError`.
 */
function asValidationError(error: Error): ValidationError {
  if (!(error instanceof ValidationError)) {
    throw new Error(
      `expected a ValidationError instance, got ${error.constructor?.name ?? "unknown"}: ${error.message}`
    );
  }
  return error;
}

/** Catches a synchronous validator throw and returns the narrowed error. */
function catchValidationError(run: () => void): ValidationError {
  try {
    run();
  } catch (caught) {
    return asValidationError(caught instanceof Error ? caught : new Error(String(caught)));
  }
  throw new Error("expected the validator to throw, but it returned normally");
}

describe("buildUpdatePatch — country bridge onto the code + display-name pair", () => {
  test("canonical code persists the pair (EG → countryCode EG + English display name)", () => {
    const patch = buildUpdatePatch({ country: "EG" });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("padded + lowercase variant normalizes onto the pair ('  eg ' → EG)", () => {
    const patch = buildUpdatePatch({ country: "  eg " });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("legacy display text resolves through the shared seed bridge (Egypt → EG, twin updated not erased)", () => {
    const patch = buildUpdatePatch({ country: "Egypt" });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("unresolvable free text keeps the legacy shape (raw text + twin cleared to null)", () => {
    const patch = buildUpdatePatch({ country: "Wonderland" });
    expect(patch.country).toBe("Wonderland");
    expect(patch.countryCode).toBeNull();
  });

  test("empty string lands in the patch unchanged — validateUpdatePatch rejects it downstream", () => {
    // The service runs build → empty-patch check → validate, so the bridge
    // must not swallow the empty value: the validator owns the localized
    // COUNTRY_INVALID rejection the edit dialog projects.
    const patch = buildUpdatePatch({ country: "" });
    expect(patch.country).toBe("");
    expect(patch.countryCode).toBeNull();
  });

  test("country absent → no country keys in the patch (only touched columns land in SET)", () => {
    const patch = buildUpdatePatch({ fullName: "Renamed" });
    expect(patch.fullName).toBe("Renamed");
    expect("country" in patch).toBe(false);
    expect("countryCode" in patch).toBe(false);
  });

  test("other whitelisted fields pass through untouched alongside a bridged country", () => {
    const patch = buildUpdatePatch({
      fullName: "Renamed",
      phone: "+201000000001",
      country: "EG",
      gender: Gender.Female,
      dateOfBirth: "2000-01-01",
    });
    expect(patch.fullName).toBe("Renamed");
    expect(patch.phone).toBe("+201000000001");
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
    expect(patch.gender).toBe(Gender.Female);
    expect(patch.dateOfBirth).toBe("2000-01-01");
  });

  test("BOPLA discipline — transport-tampered extra keys are structurally unreachable", () => {
    // The whitelist is compile-typed; this transport-tamper simulation
    // Object.assigns hostile extras at runtime (no `as unknown as` cast) to
    // prove the builder never copies unknown keys.
    const smuggled: AdminUpdateUserPatchInput = { country: "EG" };
    Object.assign(smuggled, { role: "admin", passwordHash: "x" });
    const patch = buildUpdatePatch(smuggled);
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
    expect("role" in patch).toBe(false);
    expect("passwordHash" in patch).toBe(false);
  });
});

describe("validateUpdatePatch — defense-in-depth on the derived twin", () => {
  test("a bridged patch (code + name pair) passes", () => {
    const patch = buildUpdatePatch({ country: " eg " });
    expect(() => validateUpdatePatch(patch, "en")).not.toThrow();
  });

  test("a non-member countryCode fails closed on the `country` field path", () => {
    // Only reachable by a caller bypassing buildUpdatePatch — the guard keeps
    // the repo-facing invariant honest even then.
    const error = catchValidationError(() => validateUpdatePatch({ country: "Egypt", countryCode: "EGY" }, "en"));
    expect(error.fields?.[0]?.field).toBe("country");
    expect(error.fields?.[0]?.code).toBe("COUNTRY_INVALID");
  });

  test("a null countryCode twin is the legitimate legacy-clear arm, not a failure", () => {
    expect(() => validateUpdatePatch({ country: "Wonderland", countryCode: null }, "en")).not.toThrow();
  });

  test("legacy free-text country still validates on the length bounds (≤ 100)", () => {
    expect(() => validateUpdatePatch({ country: "Egypt" }, "en")).not.toThrow();
    const error = catchValidationError(() => validateUpdatePatch({ country: "c".repeat(101) }, "en"));
    expect(error.fields?.[0]?.field).toBe("country");
    expect(error.fields?.[0]?.code).toBe("COUNTRY_INVALID");
  });
});
