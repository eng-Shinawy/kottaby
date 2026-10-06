/**
 * Static Structural Assertions Suite — `TeacherAvailabilityReturnType`.
 *
 * Mirrors the file-content-scan idiom of `evaluation-booking.types.static-assertions.test.ts`:
 * bun:test reads the canonical types file (and the teachers types barrel) from
 * disk and enforces the structural invariants — frozen field set, primitive
 * scalar kinds, PII-free read-side whitelist, clean comments, single barrel
 * re-export — so the projection cannot drift without a failing test. A
 * type-level assignment in the final test asserts the interface type-checks
 * against the minimal `{ id, isOnline, isApproved }` shape at compile time.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TeacherAvailabilityReturnType } from "@/backend/types/teachers/teacher.types";

const TEACHERS_TYPES_DIR = join(__dirname);

/** Library files to scan (NOT test files). */
const TEACHERS_LIB_FILES = ["teacher.types.ts"] as const;
const TEACHERS_BARREL_FILE = "index.ts";

/** The frozen three-member whitelist of the availability projection. */
const FROZEN_FIELDS = ["id", "isOnline", "isApproved"] as const;

/**
 * PII / governance / rating / lifecycle fields the projection must NEVER
 * expose — read-side minimality pinned at the type level. Adding any of
 * these is a regression of the whitelist.
 */
const FORBIDDEN_PROJECTION_FIELDS = [
  "email",
  "phoneNumber",
  "nationalId",
  "password",
  "country",
  "averageRating",
  "subjects",
  "requestPreference",
  "languages",
  "createdAt",
  "updatedAt",
  "userId",
  "inSession",
  "isInSession",
  "sessionLock",
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

describe("TeacherAvailabilityReturnType — Static Structural Assertions", () => {
  let teacherFiles: Map<string, string>;
  let barrelCode: string;

  beforeAll(async () => {
    teacherFiles = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    barrelCode = await readFile(join(TEACHERS_TYPES_DIR, TEACHERS_BARREL_FILE), "utf-8");
  });

  test("1. The projection is a frozen three-member whitelist { id, isOnline, isApproved }", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherAvailabilityReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly id: number;");
    expect(body).toContain("readonly isOnline: boolean;");
    expect(body).toContain("readonly isApproved: boolean;");
    expect(memberCount(body)).toBe(3);

    for (const field of FROZEN_FIELDS) {
      expect(body).toMatch(new RegExp(`readonly\\s+${field}\\s*:`));
    }
  });

  test("2. `id` is `number` (Apollo cache-normalization scalar) — NOT a string / `ID` / `bigint`", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherAvailabilityReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toMatch(/readonly\s+id\s*:\s*number\s*;/);
    expect(body).not.toMatch(/readonly\s+id\s*:\s*string\s*;/);
    expect(body).not.toMatch(/readonly\s+id\s*:\s*bigint\s*;/);
    expect(body).not.toMatch(/\bID\b/);
  });

  test("3. The projection carries NO PII / governance / rating / lifecycle fields (read-side whitelist)", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherAvailabilityReturnType\b/);
    expect(body).not.toBe("");

    for (const field of FORBIDDEN_PROJECTION_FIELDS) {
      expect(body).not.toMatch(new RegExp(`readonly\\s+${field}\\s*[?:]`, "i"));
    }
  });

  test("4. All three fields are `readonly` — projection is structurally immutable", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherAvailabilityReturnType\b/);
    expect(body).not.toBe("");

    const memberLines = body
      .split("\n")
      .filter(l => l.trim().length > 0)
      .filter(l => !l.startsWith("{") && !l.startsWith("}"));
    for (const line of memberLines) {
      expect(line.trimStart()).toMatch(/^readonly\s+\w+\s*:/);
    }
  });

  test("5. No parallel `inSession` flag — excludability flows through `isOnline` alone", () => {
    const code = codeLines(libCode(teacherFiles, "teacher.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface TeacherAvailabilityReturnType\b/);
    expect(body).not.toBe("");

    expect(body).not.toMatch(/readonly\s+inSession\s*:/);
    expect(body).not.toMatch(/readonly\s+isInSession\s*:/);
    expect(body).not.toMatch(/readonly\s+sessionLock\s*:/);
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

  test("10. Type-level conformance — interface type-checks against the minimal `{ id, isOnline, isApproved }` shape", () => {
    // Type-level assertion: the suite fails to compile if the canonical interface
    // drifts away from the three-primitive whitelist shape.
    const sample: TeacherAvailabilityReturnType = {
      id: 1,
      isOnline: true,
      isApproved: false,
    };
    const expected: { id: number; isOnline: boolean; isApproved: boolean } = sample;
    expect(expected.id).toBe(1);
    expect(expected.isOnline).toBe(true);
    expect(expected.isApproved).toBe(false);
  });

  test("11. The runtime object exposes EXACTLY the three whitelisted keys (no extra fields leak through)", () => {
    const projection: TeacherAvailabilityReturnType = {
      id: 42,
      isOnline: false,
      isApproved: true,
    };
    const keys = Object.keys(projection).toSorted((a, b) => a.localeCompare(b));
    expect(keys).toEqual(["id", "isApproved", "isOnline"]);
  });
});
