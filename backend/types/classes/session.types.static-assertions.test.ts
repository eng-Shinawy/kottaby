/**
 * Static Structural Assertions Suite — session canonical types.
 * bun:test file-content scans enforcing structural invariants.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TYPES_DIR = join(__dirname);

/** Files to scan (library files only, NOT test files). */
const LIB_FILES = ["session.types.ts", "session-request-idempotency.types.ts", "index.ts"];

/** Server-controlled session columns that must never appear on the submit-input whitelist. */
const FORBIDDEN_SUBMIT_FIELDS = [
  "id",
  "studentId",
  "status",
  "sessionType",
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

async function readLibFiles(): Promise<Map<string, string>> {
  const entries = await Promise.all(
    LIB_FILES.map(async f => [f, await readFile(join(TYPES_DIR, f), "utf-8")] as const)
  );
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

describe("Session Canonical Types — Static Structural Assertions", () => {
  let files: Map<string, string>;

  beforeAll(async () => {
    files = await readLibFiles();
  });

  test("1. SessionReturnType is derived from the schema select row, never re-declared", () => {
    const code = codeLines(libCode(files, "session.types.ts")).join("\n");
    expect(code).toContain("export type SessionReturnType = typeof session.$inferSelect;");
    expect(code).not.toContain("export type SessionReturnType = SessionSelectType;");
    expect(code).not.toMatch(/interface\s+SessionReturnType\b/);
    expect(code).not.toContain("Omit<");
  });

  test("2. Submit-input whitelist is exactly { teacherId, intent } — server-controlled fields structurally absent", () => {
    const code = codeLines(libCode(files, "session.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface SessionSubmitInput\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly teacherId: number;");
    expect(body).toContain("readonly intent: SessionStudentIntentType;");
    expect(memberCount(body)).toBe(2);

    for (const field of FORBIDDEN_SUBMIT_FIELDS) {
      expect(body).not.toMatch(new RegExp(`readonly\\s+${field}\\s*[?:]`));
    }
  });

  test("3. List filter carries only the optional nullable status member", () => {
    const code = codeLines(libCode(files, "session.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface SessionListFilterInput\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly status?: SessionStatus | null;");
    expect(memberCount(body)).toBe(1);
  });

  test("4. Page return shape echoes items, totalCount, page, pageSize — all readonly", () => {
    const code = codeLines(libCode(files, "session.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface SessionPageReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly items: readonly SessionReturnType[];");
    expect(body).toContain("readonly totalCount: number;");
    expect(body).toContain("readonly page: number;");
    expect(body).toContain("readonly pageSize: number;");
    expect(memberCount(body)).toBe(4);
  });

  test("5. Transition probe row is a Pick projection of the select row (five classification columns)", () => {
    const code = codeLines(libCode(files, "session.types.ts")).join("\n");
    // Whitespace-normalized: biome wraps the >100-column signature across
    // lines — the STRUCTURE (Pick of the select row over exactly these five
    // members) is the pin, not the line wrapping.
    const normalized = code.replace(/\s+/g, " ");
    expect(normalized).toContain(
      'export type SessionTransitionProbeRowType = Pick< SessionSelectType, "id" | "status" | "startedAt" | "studentId" | "teacherId" >;'
    );
  });

  test("6. Claim-table types derive exactly the two $infer projections — nothing else", () => {
    const code = codeLines(libCode(files, "session-request-idempotency.types.ts")).join("\n");
    expect(code).toContain(
      "export type SessionRequestIdempotencySelectType = typeof sessionRequestIdempotency.$inferSelect;"
    );
    expect(code).toContain(
      "export type SessionRequestIdempotencyInsertType = typeof sessionRequestIdempotency.$inferInsert;"
    );
    const exportCount = code.match(/^export /gm)?.length ?? 0;
    expect(exportCount).toBe(2);
    expect(code).not.toContain("Omit<");
    expect(code).not.toContain("interface ");
  });

  test("7. Barrel re-exports both type modules and stays a pure relative export * barrel", () => {
    const code = codeLines(libCode(files, "index.ts")).join("\n");
    expect(code).toContain('export * from "./session-request-idempotency.types";');
    expect(code).toContain('export * from "./session.types";');
    const lines = code
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^export \* from "\.\/[\w.-]+";$/);
    }
  });

  test("8. Zero forbidden patterns: any, spreads, unknown-casts, console/logger", () => {
    for (const name of ["session.types.ts", "session-request-idempotency.types.ts"]) {
      const code = codeLines(libCode(files, name)).join("\n");
      expect(code).not.toMatch(/\bany\b/);
      expect(code).not.toContain("...");
      expect(code).not.toContain("as unknown");
      expect(code).not.toMatch(/console\./);
      expect(code).not.toMatch(/\blogger\b/);
      expect(code).not.toMatch(/\boxlint-disable\b/);
    }
  });

  test("9. Zero plan-artifact references in comments (clean domain comments)", () => {
    for (const name of ["session.types.ts", "session-request-idempotency.types.ts"]) {
      const content = libCode(files, name);
      expect(content).not.toMatch(/REQ-\d|DEV3-\d|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/);
    }
  });
});
