/**
 * Session fee constants 4-Tier Test Suite.
 * Pure unit tier — NO DB, NO network, NO env reads.
 * Tier 1: Constant shape — decimal-string format, currency literal, primitive types.
 * Tier 2: Confirmation window — exactly 86_400_000 ms (24 hours).
 * Tier 3: Hostile reads — export surface survives descriptor inspection; no
 *         coercion helpers exported; values stable through barrel re-export.
 * Tier 4: N/A — these constants have NO input surface: the module parses,
 *         accepts, and widens nothing; it only exposes immutable primitives,
 *         so there is no input to abuse (hostile-read coverage lives in Tier 3).
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts shared/constants/session-fees.constants.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as constantsBarrel from "@/shared/constants";
import * as feeConstants from "@/shared/constants/session-fees.constants";
import {
  SESSION_CONFIRMATION_WINDOW_MS,
  SESSION_FEE_CURRENCY,
  SESSION_FEE_HIFZ,
  SESSION_FEE_TAJWEED,
} from "@/shared/constants/session-fees.constants";

/** Canonical decimal-string money format: integer part + exactly 2 fraction digits. */
const DECIMAL_STRING_PATTERN = /^\d+\.\d{2}$/;

/** Export names the constants module must expose — exactly these, nothing else. */
const EXPECTED_EXPORTS = [
  "SESSION_CONFIRMATION_WINDOW_MS",
  "SESSION_FEE_CURRENCY",
  "SESSION_FEE_HIFZ",
  "SESSION_FEE_TAJWEED",
];

/** Fee constants and their exact mandated decimal-string values. */
const EXPECTED_FEES: ReadonlyArray<readonly [string, typeof SESSION_FEE_HIFZ]> = [
  ["SESSION_FEE_HIFZ", SESSION_FEE_HIFZ],
  ["SESSION_FEE_TAJWEED", SESSION_FEE_TAJWEED],
];

/** Reads an export's value through its own property descriptor (getter or slot). */
function readThroughDescriptor(source: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor) {
    throw new Error(`export descriptor missing for ${key}`);
  }
  expect(descriptor.enumerable).toBe(true);
  return descriptor.get ? descriptor.get.call(source) : descriptor.value;
}

/** Reads a repo file from disk, cwd-relative (same layout as the parity-test precedent). */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("session fee constants", () => {
  // ---- Tier 1: Constant Shape ----
  describe("Tier 1 — constant shape", () => {
    test.each(EXPECTED_FEES)("%s is exactly the mandated decimal string", (name, expected) => {
      const actual: unknown = readThroughDescriptor(feeConstants, name);
      expect(typeof actual).toBe("string");
      expect(actual).toMatch(DECIMAL_STRING_PATTERN);
      expect(actual).toBe(expected);
    });

    test("fee constants are strings, never numbers (money discipline)", () => {
      for (const [name] of EXPECTED_FEES) {
        const value: unknown = readThroughDescriptor(feeConstants, name);
        expect(typeof value).toBe("string");
        expect(Number.isFinite(value)).toBe(false);
        expect(Number.isInteger(value)).toBe(false);
      }
    });

    test("currency literal is exactly the platform default EGP", () => {
      expect(SESSION_FEE_CURRENCY).toBe("EGP");
      expect(typeof SESSION_FEE_CURRENCY).toBe("string");
      expect(SESSION_FEE_CURRENCY).toMatch(/^[A-Z]{3}$/);
    });

    test("every export is a primitive — no objects, no functions", () => {
      for (const name of Object.keys(feeConstants)) {
        const value: unknown = readThroughDescriptor(feeConstants, name);
        expect(["string", "number"]).toContain(typeof value);
        expect(typeof value).not.toBe("function");
        expect(typeof value).not.toBe("object");
      }
    });
  });

  // ---- Tier 2: Confirmation Window Boundary ----
  describe("Tier 2 — confirmation window", () => {
    test("window constant equals exactly 86_400_000 ms", () => {
      expect(SESSION_CONFIRMATION_WINDOW_MS).toBe(86_400_000);
      expect(Object.is(SESSION_CONFIRMATION_WINDOW_MS, 86_400_000)).toBe(true);
    });

    test("window constant expresses 24 hours in milliseconds", () => {
      expect(SESSION_CONFIRMATION_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    });

    test("window constant is a positive safe integer", () => {
      expect(Number.isSafeInteger(SESSION_CONFIRMATION_WINDOW_MS)).toBe(true);
      expect(SESSION_CONFIRMATION_WINDOW_MS).toBeGreaterThan(0);
    });
  });

  // ---- Tier 3: Hostile Reads & Export Surface ----
  describe("Tier 3 — hostile reads & export surface", () => {
    test("module namespace exposes EXACTLY the four constants — no helpers", () => {
      const actual = Object.keys(feeConstants).toSorted((a, b) => a.localeCompare(b));
      expect(actual).toEqual([...EXPECTED_EXPORTS].toSorted((a, b) => a.localeCompare(b)));
    });

    test("no numeric-coercion or parse helper is exported", () => {
      const coercionShaped = /coerce|parse|numberify|tonum|valueof/i;
      for (const name of Object.keys(feeConstants)) {
        expect(coercionShaped.test(name)).toBe(false);
        expect(typeof readThroughDescriptor(feeConstants, name)).not.toBe("function");
      }
    });

    test("every export survives Object.getOwnPropertyDescriptors inspection with its mandated value", () => {
      const descriptors = Object.getOwnPropertyDescriptors(feeConstants);
      expect(Object.keys(descriptors).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [...EXPECTED_EXPORTS].toSorted((a, b) => a.localeCompare(b))
      );
      for (const name of EXPECTED_EXPORTS) {
        const descriptor = descriptors[name];
        expect(descriptor).toBeDefined();
        expect(descriptor.enumerable).toBe(true);
        expect(typeof descriptor.value).not.toBe("undefined");
      }
      expect(descriptors.SESSION_FEE_HIFZ.value).toBe("25.00");
      expect(descriptors.SESSION_FEE_TAJWEED.value).toBe("25.00");
      expect(descriptors.SESSION_FEE_CURRENCY.value).toBe("EGP");
      expect(descriptors.SESSION_CONFIRMATION_WINDOW_MS.value).toBe(86_400_000);
    });

    test("barrel re-export carries the identical primitives (Object.is stable)", () => {
      expect(Object.is(constantsBarrel.SESSION_FEE_HIFZ, SESSION_FEE_HIFZ)).toBe(true);
      expect(Object.is(constantsBarrel.SESSION_FEE_TAJWEED, SESSION_FEE_TAJWEED)).toBe(true);
      expect(Object.is(constantsBarrel.SESSION_FEE_CURRENCY, SESSION_FEE_CURRENCY)).toBe(true);
      expect(Object.is(constantsBarrel.SESSION_CONFIRMATION_WINDOW_MS, SESSION_CONFIRMATION_WINDOW_MS)).toBe(true);
    });

    test("fee strings survive a JSON round-trip as strings (never collapse to numbers)", () => {
      for (const [name] of EXPECTED_FEES) {
        const value: unknown = readThroughDescriptor(feeConstants, name);
        const roundTripped: unknown = JSON.parse(JSON.stringify(value));
        expect(typeof roundTripped).toBe("string");
        expect(roundTripped).toBe(value);
      }
    });

    test("purity pins: constants module has zero imports, zero coercion calls, zero env reads", () => {
      const source = readSource("shared/constants/session-fees.constants.ts");
      expect(/^import\b/m.test(source)).toBe(false);
      expect(/\b(Number|parseFloat|parseInt)\s*\(/.test(source)).toBe(false);
      expect(source.includes("process.env")).toBe(false);
      expect(/^export const /m.test(source)).toBe(true);
    });

    test("barrel source contains exactly one additive line for the constants module", () => {
      const barrelLines = readSource("shared/constants/index.ts")
        .split("\n")
        .filter(line => line.includes("session-fees.constants"));
      expect(barrelLines).toEqual(['export * from "./session-fees.constants";']);
    });
  });
});
