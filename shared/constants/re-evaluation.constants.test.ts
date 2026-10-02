/**
 * Re-evaluation fee constants test suite.
 * Pure unit tier — NO DB, NO network, NO env reads.
 * Tier 1: Constant shape — the fee is a decimal STRING (never a number),
 *         the currency literal is EGP, every export is a primitive.
 * Tier 2: Money-discipline purity — the module contains zero numeric
 *         coercion, zero imports, zero env reads, and the values survive
 *         barrel re-export and JSON round-trips as verbatim strings.
 * Tier 3/4: N/A — the module exposes immutable primitives and parses,
 *         accepts, and widens nothing, so there is no behavioral input
 *         surface to abuse (hostile-read coverage lives in Tier 2's
 *         export-surface scans).
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts shared/constants/re-evaluation.constants.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as constantsBarrel from "@/shared/constants";
import * as reEvaluationConstants from "@/shared/constants/re-evaluation.constants";
import { RE_EVALUATION_FEE, RE_EVALUATION_FEE_CURRENCY } from "@/shared/constants/re-evaluation.constants";

/** Canonical decimal-string money format: integer part + up to 2 fraction digits. */
const DECIMAL_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Export names the constants module must expose — exactly these, nothing else. */
const EXPECTED_EXPORTS = ["RE_EVALUATION_FEE", "RE_EVALUATION_FEE_CURRENCY"];

/** Reads an export's value through its own property descriptor (getter or slot). */
function readThroughDescriptor(source: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor) {
    throw new Error(`export descriptor missing for ${key}`);
  }
  expect(descriptor.enumerable).toBe(true);
  return descriptor.get ? descriptor.get.call(source) : descriptor.value;
}

/** Reads a repo file from disk, cwd-relative (same layout as the sibling fee test). */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("re-evaluation fee constants", () => {
  // ---- Tier 1: Constant Shape ----
  describe("Tier 1 — constant shape", () => {
    test("RE_EVALUATION_FEE is a decimal STRING matching the canonical money pattern", () => {
      const value: unknown = readThroughDescriptor(reEvaluationConstants, "RE_EVALUATION_FEE");
      expect(typeof value).toBe("string");
      expect(value).toMatch(DECIMAL_STRING_PATTERN);
      expect(value).toBe(RE_EVALUATION_FEE);
      expect(RE_EVALUATION_FEE).toBe("100.00");
    });

    test("RE_EVALUATION_FEE is never a number (money discipline)", () => {
      const value: unknown = readThroughDescriptor(reEvaluationConstants, "RE_EVALUATION_FEE");
      expect(typeof value).not.toBe("number");
      expect(Number.isFinite(value)).toBe(false);
      expect(Number.isInteger(value)).toBe(false);
    });

    test("currency literal is exactly the platform default EGP", () => {
      expect(RE_EVALUATION_FEE_CURRENCY).toBe("EGP");
      expect(typeof RE_EVALUATION_FEE_CURRENCY).toBe("string");
      expect(RE_EVALUATION_FEE_CURRENCY).toMatch(/^[A-Z]{3}$/);
    });

    test("every export is a primitive — no objects, no functions", () => {
      for (const name of Object.keys(reEvaluationConstants)) {
        const value: unknown = readThroughDescriptor(reEvaluationConstants, name);
        expect(["string"]).toContain(typeof value);
        expect(typeof value).not.toBe("function");
        expect(typeof value).not.toBe("object");
      }
    });
  });

  // ---- Tier 2: Money-Discipline Purity ----
  describe("Tier 2 — money-discipline purity", () => {
    test("module namespace exposes EXACTLY the two constants — no helpers", () => {
      const actual = Object.keys(reEvaluationConstants).toSorted((a, b) => a.localeCompare(b));
      expect(actual).toEqual([...EXPECTED_EXPORTS].toSorted((a, b) => a.localeCompare(b)));
    });

    test("constants module has zero imports, zero numeric coercion, zero env reads", () => {
      const source = readSource("shared/constants/re-evaluation.constants.ts");
      expect(/^import\b/m.test(source)).toBe(false);
      expect(/\b(Number|parseFloat|parseInt)\s*\(/.test(source)).toBe(false);
      expect(source.includes("process.env")).toBe(false);
      expect(/^export const /m.test(source)).toBe(true);
    });

    test("every export survives Object.getOwnPropertyDescriptors inspection with its mandated value", () => {
      const descriptors = Object.getOwnPropertyDescriptors(reEvaluationConstants);
      expect(Object.keys(descriptors).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [...EXPECTED_EXPORTS].toSorted((a, b) => a.localeCompare(b))
      );
      for (const name of EXPECTED_EXPORTS) {
        const descriptor = descriptors[name];
        expect(descriptor).toBeDefined();
        expect(descriptor.enumerable).toBe(true);
        expect(typeof descriptor.value).not.toBe("undefined");
      }
      expect(descriptors.RE_EVALUATION_FEE.value).toBe("100.00");
      expect(descriptors.RE_EVALUATION_FEE_CURRENCY.value).toBe("EGP");
    });

    test("barrel re-export carries the identical primitives (Object.is stable)", () => {
      expect(Object.is(constantsBarrel.RE_EVALUATION_FEE, RE_EVALUATION_FEE)).toBe(true);
      expect(Object.is(constantsBarrel.RE_EVALUATION_FEE_CURRENCY, RE_EVALUATION_FEE_CURRENCY)).toBe(true);
    });

    test("fee string survives a JSON round-trip as a string (never collapses to a number)", () => {
      const value: unknown = readThroughDescriptor(reEvaluationConstants, "RE_EVALUATION_FEE");
      const roundTripped: unknown = JSON.parse(JSON.stringify(value));
      expect(typeof roundTripped).toBe("string");
      expect(roundTripped).toBe(value);
    });

    test("barrel source contains exactly one additive line for the constants module", () => {
      const barrelLines = readSource("shared/constants/index.ts")
        .split("\n")
        .filter(line => line.includes("re-evaluation.constants"));
      expect(barrelLines).toEqual(['export * from "./re-evaluation.constants";']);
    });
  });
});
