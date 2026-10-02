/**
 * Verification plan identity constants test suite.
 * Pure unit tier — NO DB, NO network, NO env reads.
 * Tier 1: Constant shape — the title is the exact seeded catalog string, the
 *         session count is exactly 5, both primitives.
 * Tier 2: Title fitness — the resolution key is a trimmed, single-line,
 *         length-bounded catalog title (fits the plans.title column).
 * Tier 3: Hostile reads & export surface — export surface survives descriptor
 *         inspection, values stable through barrel re-export, module purity
 *         pins, and a compile-time pin proving both constants are `as const`
 *         literal types (tsgo fails the build if a maintainer ever widens
 *         them).
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts shared/constants/verification-plan.constants.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as constantsBarrel from "@/shared/constants";
import * as verificationPlanConstants from "@/shared/constants/verification-plan.constants";
import {
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";

/** Export names the constants module must expose — exactly these, nothing else. */
const EXPECTED_EXPORTS = ["VERIFICATION_PLAN_SESSION_COUNT", "VERIFICATION_PLAN_TITLE"];

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

// Compile-time pin (conformance-suite idiom): both constants must be exact
// `as const` literal types — a widened `string`/`number` declaration fails
// tsgo here, before any runtime assertion can run.
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
const titleIsExactLiteral: Equals<typeof VERIFICATION_PLAN_TITLE, "New Teacher Verification & Evaluation Plan"> = true;
const sessionCountIsExactLiteral: Equals<typeof VERIFICATION_PLAN_SESSION_COUNT, 5> = true;

/** Consumes pin values so tsgo's unused-variable rule stays satisfied. */
const consumePin = (x: unknown): boolean => Boolean(x);

describe("verification plan identity constants", () => {
  // ---- Tier 1: Constant Shape ----
  describe("Tier 1 — constant shape", () => {
    test("title is exactly the seeded catalog string (server-side resolution key)", () => {
      const actual: unknown = readThroughDescriptor(verificationPlanConstants, "VERIFICATION_PLAN_TITLE");
      expect(typeof actual).toBe("string");
      expect(actual).toBe("New Teacher Verification & Evaluation Plan");
      expect(actual).toBe(VERIFICATION_PLAN_TITLE);
    });

    test("session count is exactly 5 (product contract: five evaluation sessions)", () => {
      const actual: unknown = readThroughDescriptor(verificationPlanConstants, "VERIFICATION_PLAN_SESSION_COUNT");
      expect(typeof actual).toBe("number");
      expect(actual).toBe(5);
      expect(Object.is(VERIFICATION_PLAN_SESSION_COUNT, 5)).toBe(true);
    });

    test("every export is a primitive — no objects, no functions", () => {
      for (const name of Object.keys(verificationPlanConstants)) {
        const value: unknown = readThroughDescriptor(verificationPlanConstants, name);
        expect(["string", "number"]).toContain(typeof value);
        expect(typeof value).not.toBe("function");
        expect(typeof value).not.toBe("object");
      }
    });

    test("constants are `as const` literal types (compile-time pin)", () => {
      // The two `Equals<...>` declarations above only compile when the
      // constants are literal types; consuming the pin values here (repo
      // conformance-suite idiom) also satisfies tsgo's unused-variable rule.
      expect(consumePin(titleIsExactLiteral)).toBe(true);
      expect(consumePin(sessionCountIsExactLiteral)).toBe(true);
    });
  });

  // ---- Tier 2: Title Fitness ----
  describe("Tier 2 — title fitness as a resolution key", () => {
    test("title is a single trimmed line with no surrounding whitespace", () => {
      expect(VERIFICATION_PLAN_TITLE.trim()).toBe(VERIFICATION_PLAN_TITLE);
      expect(VERIFICATION_PLAN_TITLE.includes("\n")).toBe(false);
      expect(VERIFICATION_PLAN_TITLE.includes("\t")).toBe(false);
    });

    test("title is non-empty and fits the catalog varchar ceiling", () => {
      expect(VERIFICATION_PLAN_TITLE.length).toBeGreaterThan(0);
      expect(VERIFICATION_PLAN_TITLE.length).toBeLessThanOrEqual(100);
    });
  });

  // ---- Tier 3: Hostile Reads & Export Surface ----
  describe("Tier 3 — hostile reads & export surface", () => {
    test("module namespace exposes EXACTLY the two constants — no helpers", () => {
      const actual = Object.keys(verificationPlanConstants).toSorted((a, b) => a.localeCompare(b));
      expect(actual).toEqual([...EXPECTED_EXPORTS].toSorted((a, b) => a.localeCompare(b)));
    });

    test("every export survives Object.getOwnPropertyDescriptors inspection with its mandated value", () => {
      const descriptors = Object.getOwnPropertyDescriptors(verificationPlanConstants);
      expect(Object.keys(descriptors).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [...EXPECTED_EXPORTS].toSorted((a, b) => a.localeCompare(b))
      );
      for (const name of EXPECTED_EXPORTS) {
        const descriptor = descriptors[name];
        expect(descriptor).toBeDefined();
        expect(descriptor.enumerable).toBe(true);
        expect(typeof descriptor.value).not.toBe("undefined");
      }
      expect(descriptors.VERIFICATION_PLAN_TITLE.value).toBe("New Teacher Verification & Evaluation Plan");
      expect(descriptors.VERIFICATION_PLAN_SESSION_COUNT.value).toBe(5);
    });

    test("barrel re-export carries the identical primitives (Object.is stable)", () => {
      expect(Object.is(constantsBarrel.VERIFICATION_PLAN_TITLE, VERIFICATION_PLAN_TITLE)).toBe(true);
      expect(Object.is(constantsBarrel.VERIFICATION_PLAN_SESSION_COUNT, VERIFICATION_PLAN_SESSION_COUNT)).toBe(true);
    });

    test("purity pins: constants module has zero imports, zero env reads", () => {
      const source = readSource("shared/constants/verification-plan.constants.ts");
      expect(/^import\b/m.test(source)).toBe(false);
      expect(source.includes("process.env")).toBe(false);
      expect(/^export const /m.test(source)).toBe(true);
    });

    test("barrel source contains exactly one additive line for the constants module", () => {
      const barrelLines = readSource("shared/constants/index.ts")
        .split("\n")
        .filter(line => line.includes("verification-plan.constants"));
      expect(barrelLines).toEqual(['export * from "./verification-plan.constants";']);
    });
  });
});
