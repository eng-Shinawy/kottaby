/**
 * Static Structural Assertions Suite — evaluation-booking canonical types.
 * bun:test file-content scans enforcing structural invariants.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TEACHERS_TYPES_DIR = join(__dirname);
const SESSIONS_TYPES_DIR = join(__dirname, "../classes");

/** Files to scan (library files only, NOT test files). */
const TEACHERS_LIB_FILES = ["evaluation-booking.types.ts", "index.ts"];
const SESSIONS_LIB_FILES = ["session.types.ts"];

/** Server-controlled session columns that must never appear on the booking-input whitelist. */
const FORBIDDEN_BOOKING_FIELDS = [
  "id",
  "studentId",
  "teacherId",
  "status",
  "sessionType",
  "intent",
  "fee",
  "feeHeld",
  "heldBalanceLane",
  "confirmationDeadline",
  "confirmedByStudentAt",
  "confirmedByTeacherAt",
  "startedAt",
  "endedAt",
  "cancelReason",
  "disputeReason",
  "disputedAt",
  "resolutionNote",
  "resolvedAt",
  "createdAt",
  "updatedAt",
];

/** PII columns the evaluator picker surface must never expose. */
const FORBIDDEN_OPTION_FIELDS = ["email", "phoneNumber", "country", "password", "nationalId"];

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

/** Counts member declarations inside an interface body (anchored to member lines). */
function memberCount(body: string): number {
  // Linear scan (no regex): member lines are exactly two-space indented `readonly` declarations.
  return body.split("\n").filter(l => l.startsWith("  readonly ")).length;
}

describe("Evaluation-Booking Canonical Types — Static Structural Assertions", () => {
  let teacherFiles: Map<string, string>;
  let sessionFiles: Map<string, string>;

  beforeAll(async () => {
    teacherFiles = await readFiles(TEACHERS_TYPES_DIR, TEACHERS_LIB_FILES);
    sessionFiles = await readFiles(SESSIONS_TYPES_DIR, SESSIONS_LIB_FILES);
  });

  test("1. Booking input is the SEALED single-field whitelist { evaluatorId } — server-controlled fields structurally absent", () => {
    const code = codeLines(libCode(sessionFiles, "session.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface BookEvaluationSessionInput\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly evaluatorId: number;");
    expect(memberCount(body)).toBe(1);

    for (const field of FORBIDDEN_BOOKING_FIELDS) {
      expect(body).not.toMatch(new RegExp(`readonly\\s+${field}\\s*[?:]`));
    }
  });

  test("2. Loop-status blob carries exactly the four cycle counters", () => {
    const code = codeLines(libCode(teacherFiles, "evaluation-booking.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface EvaluationLoopStatusReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly bookedCount: number;");
    expect(body).toContain("readonly completedCount: number;");
    expect(body).toContain("readonly remainingCredits: number;");
    expect(body).toContain("readonly cycleStartDate: Date | null;");
    expect(memberCount(body)).toBe(4);
  });

  test("3. Evaluator option is the minimal PII-free surface (five members, no identity columns)", () => {
    const code = codeLines(libCode(teacherFiles, "evaluation-booking.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface EvaluationEvaluatorOptionType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly id: number;");
    expect(body).toContain("readonly fullName: string;");
    expect(body).toContain("readonly isOnline: boolean;");
    expect(body).toContain("readonly averageRating: string | null;");
    expect(body).toContain("readonly subjects: string | null;");
    expect(memberCount(body)).toBe(5);

    for (const field of FORBIDDEN_OPTION_FIELDS) {
      expect(body).not.toMatch(new RegExp(`readonly\\s+${field}\\s*[?:]`, "i"));
    }
  });

  test("4. Evaluator option page echoes items, totalCount, page, pageSize", () => {
    const code = codeLines(libCode(teacherFiles, "evaluation-booking.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface EvaluationEvaluatorOptionPageReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly items: readonly EvaluationEvaluatorOptionType[];");
    expect(body).toContain("readonly totalCount: number;");
    expect(body).toContain("readonly page: number;");
    expect(body).toContain("readonly pageSize: number;");
    expect(memberCount(body)).toBe(4);
  });

  test("5. The booking types module exports exactly the three interfaces and stays import-free", () => {
    const code = codeLines(libCode(teacherFiles, "evaluation-booking.types.ts")).join("\n");
    const exportCount = code.match(/^export /gm)?.length ?? 0;
    expect(exportCount).toBe(3);
    expect(code).toContain("export interface EvaluationLoopStatusReturnType");
    expect(code).toContain("export interface EvaluationEvaluatorOptionType");
    expect(code).toContain("export interface EvaluationEvaluatorOptionPageReturnType");
    // Rubric-scoring evaluation types stay in the sibling module (type-only separation).
    expect(code).not.toMatch(/\bimport\b/);
  });

  test("6. Teachers barrel re-exports the booking types module alongside its siblings", () => {
    const code = codeLines(libCode(teacherFiles, "index.ts")).join("\n");
    expect(code).toContain('export * from "./evaluation-booking.types";');
    const lines = code
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^export \* from "\.\/[\w.-]+";$/);
    }
  });

  test("7. Zero forbidden patterns: any, spreads, unknown-casts, console/logger", () => {
    const code = codeLines(libCode(teacherFiles, "evaluation-booking.types.ts")).join("\n");
    expect(code).not.toMatch(/\bany\b/);
    expect(code).not.toContain("...");
    expect(code).not.toContain("as unknown");
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\blogger\b/);
    expect(code).not.toMatch(/\boxlint-disable\b/);
  });

  test("8. Zero plan-artifact references in comments (clean domain comments)", () => {
    const content = libCode(teacherFiles, "evaluation-booking.types.ts");
    expect(content).not.toMatch(/REQ-\d|DEV2-\d|DEV3-\d|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/);
  });
});
