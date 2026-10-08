/**
 * Static Structural Assertions Suite — the on-demand matching types.
 *
 * Mirrors the file-content-scan idiom of
 * `teacher-availability.types.static-assertions.test.ts`: bun:test reads the
 * canonical types file (and the teachers types barrel + the availability
 * contract file) from disk and enforces the structural invariants — frozen
 * field sets, primitive scalar kinds, PII-free read-side whitelist, clean
 * comments, single barrel re-export — so the projection cannot drift without
 * a failing test. Type-level anchors inside the tests assert exact keyof
 * equality and the compile-time absence of the forbidden fields: the
 * compiler fails the suite if any shape widens.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import type {
  TeacherMatchingIntent,
  TeacherMatchingItemReturnType,
  TeacherMatchingPageReturnType,
  TeacherMatchingStudentContext,
  TeacherMatchingSubmitInput,
} from "@/backend/types/teachers/teacher-matching.types";
import { RecitationReading } from "@/shared/constants/recitation-reading.enum";

const TEACHERS_TYPES_DIR = join(__dirname);

/** Library files to scan (NOT test files). */
const MATCHING_LIB_FILE = "teacher-matching.types.ts";
const TEACHERS_BARREL_FILE = "index.ts";
const AVAILABILITY_CONTRACT_FILE = join(TEACHERS_TYPES_DIR, "../contracts/teacher-availability.contract.types.ts");

/** Exact type equality via mutual assignability of tuple-wrapped operands. */
type Equal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

/** Helper to consume variables for TS6133 — the compiler is the real checker for the type anchors. */
const v = (x: unknown): boolean => Boolean(x);

/** The frozen nine-member whitelist of the browse item projection. */
const FROZEN_ITEM_FIELDS = [
  "id",
  "fullName",
  "country",
  "countryCode",
  "subjects",
  "recitations",
  "languages",
  "averageRating",
  "isOnline",
] as const;

/** The frozen five-member page envelope. */
const FROZEN_PAGE_FIELDS = ["items", "total", "page", "pageSize", "pageCount"] as const;

/** The frozen seven-member per-browse submit input. */
const FROZEN_SUBMIT_FIELDS = ["recitation", "intent", "page", "pageSize", "search", "minRating", "sort"] as const;

/** The frozen caller context: contract language pick + the resolved country pair. */
const FROZEN_CONTEXT_FIELDS = ["primaryLanguage", "anotherLanguage", "countryCode", "country"] as const;

/**
 * PII / credential / lifecycle / internal-identity / session-lock fields the
 * item projection must NEVER expose — read-side minimality. Adding any of
 * these is a regression of the whitelist.
 */
const FORBIDDEN_PII_FIELDS = [
  "email",
  "phoneNumber",
  "phone",
  "password",
  "passwordHash",
  "hashedPassword",
  "nationalId",
  "userId",
  "teacherId",
  "studentId",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "inSession",
  "isInSession",
  "sessionLock",
] as const;

/** The same forbidden union at the type level (mirrors the runtime list above). */
type ForbiddenPiiKey =
  | "email"
  | "phoneNumber"
  | "phone"
  | "password"
  | "passwordHash"
  | "hashedPassword"
  | "nationalId"
  | "userId"
  | "teacherId"
  | "studentId"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "inSession"
  | "isInSession"
  | "sessionLock";

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

describe("TeacherMatchingTypes — Static Structural Assertions", () => {
  let teacherFiles: Map<string, string>;
  let barrelCode: string;
  let contractCode: string;

  beforeAll(async () => {
    teacherFiles = await readFiles(TEACHERS_TYPES_DIR, [MATCHING_LIB_FILE]);
    barrelCode = await readFile(join(TEACHERS_TYPES_DIR, TEACHERS_BARREL_FILE), "utf-8");
    contractCode = await readFile(AVAILABILITY_CONTRACT_FILE, "utf-8");
  });

  test("1. The item projection is a frozen nine-member whitelist (exact fields, nothing else)", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const body = interfaceBody(code, /export interface TeacherMatchingItemReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly id: number;");
    expect(body).toContain("readonly fullName: string;");
    expect(body).toContain("readonly country: string | null;");
    expect(body).toContain("readonly countryCode: string | null;");
    expect(body).toContain("readonly subjects: TeacherSubjectsParsed;");
    expect(body).toContain("readonly recitations: readonly RecitationReading[];");
    expect(body).toContain("readonly languages: readonly string[];");
    expect(body).toContain("readonly averageRating: number | null;");
    expect(body).toContain("readonly isOnline: boolean;");
    expect(memberCount(body)).toBe(9);

    for (const field of FROZEN_ITEM_FIELDS) {
      expect(body).toMatch(new RegExp(`readonly\\s+${field}\\s*:`));
    }
  });

  test("2. Item scalar kinds — numeric `id`, parsed-float rating, readonly token arrays, contract-consumed subjects", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const body = interfaceBody(code, /export interface TeacherMatchingItemReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toMatch(/readonly\s+id\s*:\s*number\s*;/);
    expect(body).not.toMatch(/readonly\s+id\s*:\s*string\s*;/);
    expect(body).not.toMatch(/readonly\s+id\s*:\s*bigint\s*;/);
    expect(body).not.toMatch(/\bID\b/);

    // `averageRating` is the parsed float — never the raw Drizzle decimal string.
    expect(body).toMatch(/readonly\s+averageRating\s*:\s*number\s*\|\s*null\s*;/);
    expect(body).not.toMatch(/readonly\s+averageRating\s*:\s*string/);

    // Token collections stay readonly arrays.
    expect(body).toMatch(/readonly\s+recitations\s*:\s*readonly\s+RecitationReading\[\]\s*;/);
    expect(body).not.toMatch(/readonly\s+recitations\s*:\s*RecitationReading\[\]\s*;/);
    expect(body).toMatch(/readonly\s+languages\s*:\s*readonly\s+string\[\]\s*;/);
    expect(body).not.toMatch(/readonly\s+languages\s*:\s*string\[\]\s*;/);

    // `subjects` consumes the contract alias — not a re-declared shape.
    expect(body).toContain("readonly subjects: TeacherSubjectsParsed;");
  });

  test("3. The item carries NO PII / credential / lifecycle / internal-identity fields (read-side whitelist)", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const body = interfaceBody(code, /export interface TeacherMatchingItemReturnType\b/);
    expect(body).not.toBe("");

    for (const field of FORBIDDEN_PII_FIELDS) {
      expect(body).not.toMatch(new RegExp(`readonly\\s+${field}\\s*[?:]`, "i"));
    }
  });

  test("4. Type-level PII absence — the item keys never intersect the forbidden union", () => {
    // The forbidden list itself must keep the mandated PII minimum (email/phone/hash/timestamps).
    const REQUIRED_PII_MINIMUM: readonly (typeof FORBIDDEN_PII_FIELDS)[number][] = [
      "email",
      "phoneNumber",
      "phone",
      "passwordHash",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ];
    for (const field of REQUIRED_PII_MINIMUM) {
      expect(FORBIDDEN_PII_FIELDS).toContain(field);
    }

    const piiAbsent: Equal<Extract<keyof TeacherMatchingItemReturnType, ForbiddenPiiKey>, never> = true;
    v(piiAbsent);

    // Indexed-access negatives — each fails to compile if the field ever appears.
    // @ts-expect-error — email must never exist on the item projection
    const email: TeacherMatchingItemReturnType["email"] = "student@example.com";
    v(email);

    // @ts-expect-error — phone must never exist on the item projection
    const phone: TeacherMatchingItemReturnType["phoneNumber"] = "+201000000000";
    v(phone);

    // @ts-expect-error — credential hashes must never exist on the item projection
    const passwordHash: TeacherMatchingItemReturnType["passwordHash"] = "hash";
    v(passwordHash);

    // @ts-expect-error — timestamps must never exist on the item projection
    const createdAt: TeacherMatchingItemReturnType["createdAt"] = new Date();
    v(createdAt);
  });

  test("5. Every member of every matcher shape is `readonly` — structurally immutable", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const shapes = [
      /export interface TeacherMatchingSubmitInput\b/,
      /export interface TeacherMatchingItemReturnType\b/,
      /export interface TeacherMatchingPageReturnType\b/,
      /export interface TeacherMatchingStudentContext\b/,
    ];
    for (const declaration of shapes) {
      const body = interfaceBody(code, declaration);
      expect(body).not.toBe("");

      const memberLines = body
        .split("\n")
        .filter(l => l.trim().length > 0)
        .filter(l => !l.startsWith("{") && !l.startsWith("}"));
      for (const line of memberLines) {
        expect(line.trimStart()).toMatch(/^readonly\s+\w+\s*:/);
      }
    }
  });

  test("6. The page envelope is the frozen five-member shape wrapping the item array", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const body = interfaceBody(code, /export interface TeacherMatchingPageReturnType\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly items: readonly TeacherMatchingItemReturnType[];");
    expect(body).toContain("readonly total: number;");
    expect(body).toContain("readonly page: number;");
    expect(body).toContain("readonly pageSize: number;");
    expect(body).toContain("readonly pageCount: number;");
    expect(memberCount(body)).toBe(5);

    for (const field of FROZEN_PAGE_FIELDS) {
      expect(body).toMatch(new RegExp(`readonly\\s+${field}\\s*:`));
    }

    // Type-level: `items` is exactly the readonly array of the canonical item type.
    const itemsArrayExact: Equal<TeacherMatchingPageReturnType["items"], readonly TeacherMatchingItemReturnType[]> =
      true;
    v(itemsArrayExact);
  });

  test("7. The submit input carries exactly the four per-browse keys — no caller identity, no override fields", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const body = interfaceBody(code, /export interface TeacherMatchingSubmitInput\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly recitation: RecitationReading | null;");
    expect(body).toContain("readonly intent: TeacherMatchingIntent | null;");
    expect(body).toContain("readonly page: number | null;");
    expect(body).toContain("readonly pageSize: number | null;");
    expect(body).toContain("readonly search: string | null;");
    expect(body).toContain("readonly minRating: number | null;");
    expect(body).toContain("readonly sort: TeacherMatchingSort;");
    expect(memberCount(body)).toBe(7);

    for (const field of FROZEN_SUBMIT_FIELDS) {
      expect(body).toMatch(new RegExp(`readonly\\s+${field}\\s*:`));
    }

    // Type-level anchors — exact keyof equality + explicit-nullable members.
    const submitKeysExact: Equal<
      keyof TeacherMatchingSubmitInput,
      "recitation" | "intent" | "page" | "pageSize" | "search" | "minRating" | "sort"
    > = true;
    v(submitKeysExact);
    const pageNullableExact: Equal<TeacherMatchingSubmitInput["page"], number | null> = true;
    v(pageNullableExact);
    const pageSizeNullableExact: Equal<TeacherMatchingSubmitInput["pageSize"], number | null> = true;
    v(pageSizeNullableExact);
    const searchNullableExact: Equal<TeacherMatchingSubmitInput["search"], string | null> = true;
    v(searchNullableExact);
    const minRatingNullableExact: Equal<TeacherMatchingSubmitInput["minRating"], number | null> = true;
    v(minRatingNullableExact);
    const recitationNullableExact: Equal<TeacherMatchingSubmitInput["recitation"], RecitationReading | null> = true;
    v(recitationNullableExact);
    const intentNullableExact: Equal<TeacherMatchingSubmitInput["intent"], TeacherMatchingIntent | null> = true;
    v(intentNullableExact);
    const sortEnumExact: Equal<TeacherMatchingSubmitInput["sort"], TeacherMatchingSort> = true;
    v(sortEnumExact);

    // Identity fields fail to compile on the input — the caller is resolved server-side.
    // @ts-expect-error — no studentId on the submit input
    const studentId: TeacherMatchingSubmitInput["studentId"] = 1;
    v(studentId);

    // @ts-expect-error — no teacherId on the submit input
    const teacherId: TeacherMatchingSubmitInput["teacherId"] = 2;
    v(teacherId);
  });

  test("8. Intent union exactness — derived by exclusion, resolves to exactly hifz | tajweed", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");

    // The derivation itself is pinned: evaluation is excluded at the type level.
    expect(code).toContain("export type TeacherMatchingIntent = Exclude<SessionIntent, SessionIntent.Evaluation>;");

    // The resolved union is exactly the two session-request members.
    const intentExact: Equal<TeacherMatchingIntent, SessionIntent.Hifz | SessionIntent.Tajweed> = true;
    v(intentExact);

    // Both members are accepted…
    const hifz: TeacherMatchingIntent = SessionIntent.Hifz;
    const tajweed: TeacherMatchingIntent = SessionIntent.Tajweed;
    expect(hifz).toBe(SessionIntent.Hifz);
    expect(tajweed).toBe(SessionIntent.Tajweed);

    // …while the staff-driven evaluation flow is not…
    // @ts-expect-error — evaluation is never a browse intent
    const evaluation: TeacherMatchingIntent = SessionIntent.Evaluation;
    const evaluationValue: string = evaluation;
    expect(evaluationValue).toBe("evaluation");

    // …and the intent is enum-typed, not a bare string union.
    // @ts-expect-error — raw literals are not assignable to the enum-backed union
    const literal: TeacherMatchingIntent = "hifz";
    const literalValue: string = literal;
    v(literalValue);

    // The source vocabulary carries exactly the three session-intent members.
    expect(Object.values(SessionIntent).map(String)).toEqual(["hifz", "tajweed", "evaluation"]);
  });

  test("9. The caller context extends the contract language pick and adds exactly the country pair", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const declaration = /export interface TeacherMatchingStudentContext\b/;
    const body = interfaceBody(code, declaration);
    expect(body).not.toBe("");

    expect(code).toMatch(/export interface TeacherMatchingStudentContext extends TeacherMatchingLanguagesInput\b/);
    expect(body).toContain("readonly countryCode: string | null;");
    expect(body).toContain("readonly country: string | null;");
    expect(memberCount(body)).toBe(2);

    // The two language members are inherited from the contract pick — never re-declared locally.
    expect(body).not.toContain("readonly primaryLanguage");
    expect(body).not.toContain("readonly anotherLanguage");

    // Type-level: the resolved key set is the inherited language pick + the country pair.
    const contextKeysExact: Equal<
      keyof TeacherMatchingStudentContext,
      "primaryLanguage" | "anotherLanguage" | "countryCode" | "country"
    > = true;
    v(contextKeysExact);
  });

  test("10. The module exports exactly five symbols and stays import-light (type-only, canonical sources)", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    const exportCount = code.match(/^export /gm)?.length ?? 0;
    expect(exportCount).toBe(5);
    expect(code).toContain("export type TeacherMatchingIntent");
    expect(code).toContain("export interface TeacherMatchingSubmitInput");
    expect(code).toContain("export interface TeacherMatchingItemReturnType");
    expect(code).toContain("export interface TeacherMatchingPageReturnType");
    expect(code).toContain("export interface TeacherMatchingStudentContext");

    // All imports are type-only and point at the canonical sources.
    expect(code.match(/^import (?!type )/gm)).toBeNull();
    const typeImports = code.match(/^import type /gm)?.length ?? 0;
    expect(typeImports).toBe(4);
    expect(code).toContain('from "@/backend/enum/scheduling/session-intent.enum";');
    expect(code).toContain('from "@/backend/enum/teachers/teacher-matching-sort.enum";');
    expect(code).toContain('from "@/backend/types/contracts/teacher-availability.contract.types";');
    expect(code).toContain('from "@/shared/constants/recitation-reading.enum";');
  });

  test("11. Zero forbidden patterns: any, spreads, unknown-casts, console/logger", () => {
    const code = codeLines(libCode(teacherFiles, MATCHING_LIB_FILE)).join("\n");
    expect(code).not.toMatch(/\bany\b/);
    expect(code).not.toContain("...");
    expect(code).not.toContain("as unknown");
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\blogger\b/);
    expect(code).not.toMatch(/\boxlint-disable\b/);
  });

  test("12. Zero plan-artifact references in comments (clean domain comments)", () => {
    const content = libCode(teacherFiles, MATCHING_LIB_FILE);
    expect(content).not.toMatch(/REQ-\d|DEV2-\d|DEV3-\d|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/);
  });

  test("13. The teachers barrel re-exports the matching file exactly once (no duplicate line)", () => {
    const barrelLines = codeLines(barrelCode)
      .map(l => l.trim())
      .filter(l => l.length > 0);
    const matchingExports = barrelLines.filter(l => l === 'export * from "./teacher-matching.types";');
    expect(matchingExports).toHaveLength(1);
    for (const line of barrelLines) {
      expect(line).toMatch(/^export \* from "\.\/[\w.-]+";$/);
    }
  });

  test("14. The availability contract stays the single source for the consumed shapes", () => {
    expect(contractCode).toContain("export type TeacherMatchingLanguagesInput");
    expect(contractCode).toContain('Pick<StudentSelectType, "primaryLanguage" | "anotherLanguage">');
    expect(contractCode).toContain("export type TeacherSubjectsParsed");
  });

  test("15. Type-level conformance — the four shapes compose the canonical page payload", () => {
    const sampleItem: TeacherMatchingItemReturnType = {
      id: 7,
      fullName: "Teacher Seven",
      country: "Egypt",
      countryCode: "EG",
      subjects: ["hifz"],
      recitations: [RecitationReading.HAFS_AN_ASIM],
      languages: ["ar"],
      averageRating: 4.5,
      isOnline: true,
    };
    const samplePage: TeacherMatchingPageReturnType = {
      items: [sampleItem],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    };
    const sampleInput: TeacherMatchingSubmitInput = {
      recitation: RecitationReading.WARSH_AN_NAFI,
      intent: SessionIntent.Tajweed,
      page: null,
      pageSize: null,
      search: null,
      minRating: null,
      sort: TeacherMatchingSort.RatingDesc,
    };
    const sampleContext: TeacherMatchingStudentContext = {
      primaryLanguage: "ar",
      anotherLanguage: null,
      countryCode: "EG",
      country: "Egypt",
    };

    expect(samplePage.items[0]?.id).toBe(7);
    expect(samplePage.pageCount).toBe(1);
    expect(sampleInput.page).toBeNull();
    expect(sampleContext.primaryLanguage).toBe("ar");
  });

  test("16. The runtime objects expose EXACTLY the whitelisted keys (no extra fields leak through)", () => {
    const sampleItem: TeacherMatchingItemReturnType = {
      id: 7,
      fullName: "Teacher Seven",
      country: null,
      countryCode: null,
      subjects: [],
      recitations: [],
      languages: [],
      averageRating: null,
      isOnline: false,
    };
    const samplePage: TeacherMatchingPageReturnType = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      pageCount: 0,
    };
    const sampleInput: TeacherMatchingSubmitInput = {
      recitation: RecitationReading.HAFS_AN_ASIM,
      intent: SessionIntent.Hifz,
      page: null,
      pageSize: null,
      search: "",
      minRating: 4.5,
      sort: TeacherMatchingSort.NameAsc,
    };
    const sampleContext: TeacherMatchingStudentContext = {
      primaryLanguage: null,
      anotherLanguage: null,
      countryCode: null,
      country: null,
    };

    expect(Object.keys(sampleItem).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...FROZEN_ITEM_FIELDS].toSorted((a, b) => a.localeCompare(b))
    );
    expect(Object.keys(samplePage).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...FROZEN_PAGE_FIELDS].toSorted((a, b) => a.localeCompare(b))
    );
    expect(Object.keys(sampleInput).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...FROZEN_SUBMIT_FIELDS].toSorted((a, b) => a.localeCompare(b))
    );
    expect(Object.keys(sampleContext).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...FROZEN_CONTEXT_FIELDS].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("17. Type-level exact keyof equality anchors for the item and page shapes", () => {
    // The envelope wraps the item — the two whitelists must never share a key.
    const overlap = FROZEN_ITEM_FIELDS.filter(field => (FROZEN_PAGE_FIELDS as readonly string[]).includes(field));
    expect(overlap).toEqual([]);

    const itemKeysExact: Equal<
      keyof TeacherMatchingItemReturnType,
      | "id"
      | "fullName"
      | "country"
      | "countryCode"
      | "subjects"
      | "recitations"
      | "languages"
      | "averageRating"
      | "isOnline"
    > = true;
    v(itemKeysExact);

    const pageKeysExact: Equal<
      keyof TeacherMatchingPageReturnType,
      "items" | "total" | "page" | "pageSize" | "pageCount"
    > = true;
    v(pageKeysExact);
  });
});
