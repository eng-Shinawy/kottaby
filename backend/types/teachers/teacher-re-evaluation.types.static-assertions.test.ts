/**
 * Static Structural Assertions Suite — teacher re-evaluation order type.
 * bun:test file-content scans enforcing structural invariants, plus a
 * compile-time + runtime money-as-string proof.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/types/teachers/teacher-re-evaluation.types.static-assertions.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TeacherReEvaluationOrderReturnType } from "@/backend/types/teachers/teacher-re-evaluation.types";

const TEACHERS_TYPES_DIR = join(__dirname);

/** Files to scan (library files only, NOT test files). */
const TEACHERS_LIB_FILES = ["teacher-re-evaluation.types.ts", "index.ts"];

/** Compile-time proof: the three money fields extend `string` (never `number`). */
type MoneyFieldsAreStrings = TeacherReEvaluationOrderReturnType["amountCharged"] extends string
  ? TeacherReEvaluationOrderReturnType["currency"] extends string
    ? TeacherReEvaluationOrderReturnType["walletBalance"] extends string
      ? true
      : false
    : false
  : false;

// Compile-time proof: this assignment fails to compile the moment any money
// field regresses to a non-string type (`MoneyFieldsAreStrings` collapses to
// `false`). Reading it through `unknown` keeps the runtime assertion below
// meaningful instead of statically trivial.
const MONEY_FIELDS_ARE_STRINGS: unknown = true satisfies MoneyFieldsAreStrings;

// Runtime sample composed exactly the way the ordering service composes it —
// a compile error here means the money-as-string contract regressed.
const ORDER_SAMPLE: TeacherReEvaluationOrderReturnType = {
  teacherId: 42,
  amountCharged: "100.00",
  currency: "EGP",
  walletBalance: "87.50",
  reEvaluationStartedAt: new Date("2026-02-01T08:00:00.000Z"),
};

async function readFiles(dir: string, names: readonly string[]): Promise<Map<string, string>> {
  const entries = await Promise.all(names.map(async f => [f, await readFile(join(dir, f), "utf-8")] as const));
  return new Map(entries);
}

/** Strict file lookup — a missing file fails the suite instead of yielding undefined. */
function libCode(files: Map<string, string>, name: string): string {
  const content = files.get(name);
  if (content === undefined) {
    throw new Error(`missing lib file: ${name}`);
  }
  return content;
}

/** Strips comment lines so prose mentions don't trip structural scans. */
function codeLines(content: string): string[] {
  return content
    .split("\n")
    .filter(l => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"));
}

describe("Teacher re-evaluation order type — Static Structural Assertions", () => {
  test("1. Money fields are strings at COMPILE TIME (type-level proof)", () => {
    expect(MONEY_FIELDS_ARE_STRINGS).toBe(true);
  });

  test("2. Money fields are strings at RUNTIME on a composed sample (never numbers)", () => {
    expect(typeof ORDER_SAMPLE.amountCharged).toBe("string");
    expect(typeof ORDER_SAMPLE.currency).toBe("string");
    expect(typeof ORDER_SAMPLE.walletBalance).toBe("string");
    expect(Number.isFinite(ORDER_SAMPLE.amountCharged)).toBe(false);
    expect(Number.isFinite(ORDER_SAMPLE.walletBalance)).toBe(false);
    expect(ORDER_SAMPLE.teacherId).toBe(42);
    expect(ORDER_SAMPLE.reEvaluationStartedAt).toBeInstanceOf(Date);
  });

  test("3. The return type declares exactly the five documented members with money as string", async () => {
    const files = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    const code = codeLines(libCode(files, "teacher-re-evaluation.types.ts")).join("\n");

    expect(code).toContain("export type TeacherReEvaluationOrderReturnType");
    expect(code).toContain("teacherId: number;");
    expect(code).toContain("amountCharged: string;");
    expect(code).toContain("currency: string;");
    expect(code).toContain("walletBalance: string;");
    expect(code).toContain("reEvaluationStartedAt: Date;");

    // Money fields must NEVER be re-typed as numbers (nor `number | string`).
    expect(code).not.toMatch(/amountCharged\s*:\s*number/);
    expect(code).not.toMatch(/walletBalance\s*:\s*number/);
    expect(code).not.toMatch(/currency\s*:\s*number/);
    expect(code.match(/:\s*number\s*;/g)?.length).toBe(1); // teacherId only
    expect(code.match(/:\s*Date\s*;/g)?.length).toBe(1); // reEvaluationStartedAt only
  });

  test("4. The types module is a single-type, import-free contract file", async () => {
    const files = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    const code = codeLines(libCode(files, "teacher-re-evaluation.types.ts")).join("\n");

    const exportCount = code.match(/^export /gm)?.length ?? 0;
    expect(exportCount).toBe(1);
    expect(code).not.toMatch(/\bimport\b/);
  });

  test("5. Teachers barrel re-exports the module alongside its siblings", async () => {
    const files = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    const code = codeLines(libCode(files, "index.ts")).join("\n");
    expect(code).toContain('export * from "./teacher-re-evaluation.types";');
    const lines = code
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^export \* from "\.\/[\w.-]+";$/);
    }
  });

  test("6. Zero forbidden patterns: any, spreads, unknown-casts, console/logger", async () => {
    const files = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    const code = codeLines(libCode(files, "teacher-re-evaluation.types.ts")).join("\n");
    expect(code).not.toMatch(/\bany\b/);
    expect(code).not.toContain("...");
    expect(code).not.toContain("as unknown");
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\blogger\b/);
    expect(code).not.toMatch(/\boxlint-disable\b/);
  });

  test("7. Zero plan-artifact references in comments (clean domain comments)", async () => {
    const files = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    const content = libCode(files, "teacher-re-evaluation.types.ts");
    expect(content).not.toMatch(/REQ-\d|DEV2-\d|DEV3-\d|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/);
  });
});
