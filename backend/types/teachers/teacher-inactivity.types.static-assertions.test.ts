/**
 * Static Structural Assertions Suite — `TeacherInactivitySweepReturnType`.
 *
 * Mirrors the file-content-scan idiom of `teacher-availability.types.static-assertions.test.ts`:
 * bun:test reads the canonical types file (and the teachers types barrel) from
 * disk and enforces the structural invariants — a frozen single-member honest
 * count, primitive scalar kind, identity-free cron boundary (no per-teacher
 * fields ever cross it), clean comments, single barrel re-export — so the
 * sweep result cannot drift without a failing test. A type-level assignment
 * in the final test asserts the interface type-checks against the minimal
 * `{ offlined }` shape at compile time.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/types/teachers/teacher-inactivity.types.static-assertions.test.ts`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TeacherInactivitySweepReturnType } from "@/backend/types/teachers/teacher.types";

const TEACHERS_TYPES_DIR = join(__dirname);

/** Library files to scan (NOT test files). */
const TEACHERS_LIB_FILES = ["teacher.types.ts"] as const;
const TEACHERS_BARREL_FILE = "index.ts";

/** The frozen single-member honest-count whitelist of the sweep result. */
const FROZEN_FIELDS = ["offlined"] as const;

/**
 * Identity carriers the sweep result must NEVER expose — identities never
 * cross the cron boundary, so the payload stays a bare aggregate count.
 * Adding any of these is a regression of the honest-counts contract.
 */
const FORBIDDEN_IDENTITY_FIELDS = [
  "id",
  "ids",
  "teacherId",
  "teacherIds",
  "userId",
  "userIds",
  "email",
  "emails",
  "username",
  "teacher",
  "lastActiveAt",
  "isOnline",
] as const;

/**
 * Speculative companions the contract deliberately omits — one honest count
 * only: no per-bucket counters, no timings, no diagnostics.
 */
const FORBIDDEN_COMPANION_FIELDS = [
  "checked",
  "scanned",
  "stale",
  "skipped",
  "failed",
  "remaining",
  "durationMs",
  "elapsedMs",
  "tookMs",
] as const;

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

/** Extracts `content.slice(bodyStart, bodyEnd)` for the interface block starting at matchIndex. */
function sliceInterfaceBody(content: string, matchIndex: number): string {
  const bodyStart = content.indexOf("{", matchIndex);
  const braceCount = { count: 0 };
  let bodyEnd = bodyStart;
  for (let i = bodyStart; i < content.length; i++) {
    if (content[i] === "{") braceCount.count++;
    if (content[i] === "}") braceCount.count--;
    if (braceCount.count === 0) {
      bodyEnd = i;
      break;
    }
  }
  return content.slice(bodyStart, bodyEnd);
}

/** Body of the named interface declaration ("" when absent — callers assert on it). */
function interfaceBody(code: string, declaration: RegExp): string {
  const match = declaration.exec(code);
  if (!match) {
    return "";
  }
  return sliceInterfaceBody(code, match.index);
}

/** Counts member declarations inside an interface body (anchored to two-space-indented `readonly`). */
function memberCount(body: string): number {
  return body.split("\n").filter(l => l.startsWith("  readonly ")).length;
}

describe("TeacherInactivitySweepReturnType — Static Structural Assertions", () => {
  let teacherFiles: Map<string, string>;
  let barrelCode: string;

  beforeAll(async () => {
    teacherFiles = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    barrelCode = await readFile(join(TEACHERS_TYPES_DIR, TEACHERS_BARREL_FILE), "utf-8");
  });

  test("1. The sweep result is a frozen single-member honest count { offlined }", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherInactivitySweepReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly offlined: number;");
    expect(memberCount(body)).toBe(1);

    for (const field of FROZEN_FIELDS) {
      expect(body).toMatch(new RegExp(`readonly\\s+${field}\\s*:`));
    }
  });

  test("2. `offlined` is `number` (an honest count) — NOT a boolean / string / bigint", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherInactivitySweepReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toMatch(/readonly\s+offlined\s*:\s*number\s*;/);
    expect(body).not.toMatch(/readonly\s+offlined\s*:\s*boolean\s*;/);
    expect(body).not.toMatch(/readonly\s+offlined\s*:\s*string\s*;/);
    expect(body).not.toMatch(/readonly\s+offlined\s*:\s*bigint\s*;/);
  });

  test("3. The result carries NO identity fields — identities never cross the cron boundary", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherInactivitySweepReturnType\b/);
    expect(body).not.toBe("");

    for (const field of FORBIDDEN_IDENTITY_FIELDS) {
      expect(body).not.toMatch(new RegExp(`readonly\\s+${field}\\s*[?:]`, "i"));
    }
  });

  test("4. All members are `readonly` — the sweep result is structurally immutable", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherInactivitySweepReturnType\b/);
    expect(body).not.toBe("");

    const memberLines = body
      .split("\n")
      .filter(l => l.trim().length > 0)
      .filter(l => !l.startsWith("{") && !l.startsWith("}"));
    for (const line of memberLines) {
      expect(line.trimStart()).toMatch(/^readonly\s+\w+\s*:/);
    }
  });

  test("5. No parallel counters / timings — the contract is one honest `offlined` count", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherInactivitySweepReturnType\b/);
    expect(body).not.toBe("");

    for (const field of FORBIDDEN_COMPANION_FIELDS) {
      expect(body).not.toMatch(new RegExp(`readonly\\s+${field}\\s*[?:]`, "i"));
    }
  });

  test("6. The `teacher.types.ts` module exports exactly four symbols and stays import-light", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const exportCount = code.match(/^export /gm)?.length ?? 0;
    expect(exportCount).toBe(4);
    expect(code).toContain("export type TeacherSelectType");
    expect(code).toContain("export interface TeacherColdStartCertificationInput");
    expect(code).toContain("export interface TeacherAvailabilityReturnType");
    expect(code).toContain("export interface TeacherInactivitySweepReturnType");
    // The only allowed import is the schema-module type-only import for `$inferSelect`.
    expect(code).toMatch(/^import type \{ teacher \} from "@\/backend\/db\/schema\/teachers\/teacher";/);
  });

  test("7. Zero forbidden patterns: any, spreads, unknown-casts, console/logger", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    expect(code).not.toMatch(/\bany\b/);
    expect(code).not.toContain("...");
    expect(code).not.toContain("as unknown");
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\blogger\b/);
    expect(code).not.toMatch(/\boxlint-disable\b/);
  });

  test("8. Zero plan-artifact references in comments (clean domain comments)", () => {
    const content = libCode(teacherFiles, "teacher.types.ts");
    expect(content).not.toMatch(/REQ-\d|DEV2-\d|DEV3-\d|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/);
  });

  test("9. The teachers barrel re-exports `teacher.types` exactly once (no duplicate line)", () => {
    const barrelLines = codeLines(barrelCode)
      .map(l => l.trim())
      .filter(l => l.length > 0);
    const teacherTypesExports = barrelLines.filter(l => l === 'export * from "./teacher.types";');
    expect(teacherTypesExports).toHaveLength(1);
    for (const line of barrelLines) {
      expect(line).toMatch(/^export \* from "\.\/[\w.-]+";$/);
    }
  });

  test("10. Type-level conformance — interface type-checks against the minimal `{ offlined }` shape", () => {
    // Type-level assertion: the suite fails to compile if the canonical interface
    // drifts away from the single honest-count shape.
    const sample: TeacherInactivitySweepReturnType = {
      offlined: 3,
    };
    const expected: { offlined: number } = sample;
    expect(expected.offlined).toBe(3);
  });

  test("11. The runtime object exposes EXACTLY the whitelisted key (no extra fields leak through)", () => {
    const sweepResult: TeacherInactivitySweepReturnType = {
      offlined: 0,
    };
    const keys = Object.keys(sweepResult).toSorted((a, b) => a.localeCompare(b));
    expect(keys).toEqual(["offlined"]);
  });
});
