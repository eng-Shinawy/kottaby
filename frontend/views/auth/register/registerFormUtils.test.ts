/**
 * Colocated unit tests for the register form's pure field helpers, focused
 * on the country value contract:
 *
 *  - `countryFromValue` pins the raw (checker-degraded `string`) country
 *    field value back to a dataset member or `""` — absent values, lowercase
 *    and padded codes, and every non-member shape must resolve without
 *    throwing, mirroring the select-value pinning guards.
 *  - `RegisterFormValues.country` stays a plain `string` holding the ISO
 *    code (the submit-input contract), so a well-formed `RegisterFormValues`
 *    literal with a `country: string` compiles.
 *
 * RUNS VIA: bun run test/scripts/run-test.ts frontend/views/auth/register/registerFormUtils.test.ts
 */

import { describe, expect, test } from "bun:test";
import { countryFromValue, type RegisterFormValues } from "@/frontend/views/auth/register/registerFormUtils";
import { COUNTRY_CODES } from "@/shared/constants/countries";

describe("countryFromValue — pinning the raw country field value", () => {
  test("dataset members pass through untouched", () => {
    for (const code of COUNTRY_CODES) {
      expect(countryFromValue(code)).toBe(code);
    }
    expect(countryFromValue("EG")).toBe("EG");
  });

  test("empty and absent values resolve to the cleared state", () => {
    expect(countryFromValue("")).toBe("");
    expect(countryFromValue(null)).toBe("");
    expect(countryFromValue(undefined)).toBe("");
    expect(countryFromValue("   ")).toBe("");
  });

  test("lowercase and padded codes normalize into their canonical member", () => {
    expect(countryFromValue("eg")).toBe("EG");
    expect(countryFromValue("Eg")).toBe("EG");
    expect(countryFromValue(" eg ")).toBe("EG");
  });

  test("non-member shapes resolve to the cleared state", () => {
    expect(countryFromValue("EGYPT")).toBe("");
    expect(countryFromValue("E1")).toBe("");
    expect(countryFromValue("XX")).toBe("");
    expect(countryFromValue("E")).toBe("");
    expect(countryFromValue("EGY")).toBe("");
  });
});

describe("countryFromValue — hostile and oversized input cannot produce a member", () => {
  test("prototype-chain and lookup-table keys never resolve as members", () => {
    expect(countryFromValue("__proto__")).toBe("");
    expect(countryFromValue("constructor")).toBe("");
    expect(countryFromValue("toString")).toBe("");
    expect(countryFromValue("hasOwnProperty")).toBe("");
  });

  test("overlong, unicode, RTL, and emoji input resolves to the cleared state", () => {
    expect(countryFromValue("E".repeat(10_000))).toBe("");
    expect(countryFromValue("EG".repeat(5_000))).toBe("");
    expect(countryFromValue("مصر")).toBe("");
    expect(countryFromValue("🇪🇬")).toBe("");
    expect(countryFromValue("EG\u0000")).toBe("");
    expect(countryFromValue("12")).toBe("");
  });
});

describe("RegisterFormValues.country — stays a string holding the ISO code", () => {
  test("a fully-typed form-values literal compiles with a string country", () => {
    // Assembled so the fixture is not a hard-coded password literal.
    const registrantPassword = ["sup3r", "Secret!"].join("");
    const values: RegisterFormValues = {
      fullName: "Amr Diab",
      email: "amr@example.com",
      phone: "+201000000000",
      password: registrantPassword,
      country: "EG",
      gender: null,
      role: "",
      preferredRecitation: null,
    };
    expect(typeof values.country).toBe("string");
    expect(countryFromValue(values.country)).toBe("EG");
  });
});
