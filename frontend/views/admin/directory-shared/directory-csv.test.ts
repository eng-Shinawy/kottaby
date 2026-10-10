/**
 * Colocated unit tests for `directory-csv.ts` — the shared serialization
 * recipe of the admin directory CSV exports (students / teachers /
 * applicants).
 *
 * Focus: the formula-injection payload row — a hostile cell must export
 * as inert text (CWE-1236 defused), never as a live formula, and benign
 * cells must stay byte-identical to the pre-guard contract.
 */
import { describe, expect, test } from "bun:test";
import { buildDirectoryCsv, csvBoolCell } from "@/frontend/views/admin/directory-shared/directory-csv";

describe("buildDirectoryCsv — formula-payload row", () => {
  test("a hostile cell exports as inert text (CWE-1236 defused)", () => {
    const csv = buildDirectoryCsv({
      headers: ["Name", "Email"],
      rows: [
        ["=cmd|'/C calc'!A0", "a@b.c"],
        ["+1=1", "-2+3"],
        ["@SUM(A1:A2)", "hello"],
      ],
    });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("\uFEFFName,Email");
    expect(lines[1]).toBe("'=cmd|'/C calc'!A0,a@b.c");
    expect(lines[2]).toBe("'+1=1,'-2+3");
    expect(lines[3]).toBe("'@SUM(A1:A2),hello");
  });

  test("defusal composes with conditional quoting (quote test runs on the defused value)", () => {
    const csv = buildDirectoryCsv({
      headers: ["H"],
      rows: [['=a,"b"'], ["=plain,comma"]],
    });
    expect(csv).toBe('\uFEFFH\n"\'=a,""b"""\n"\'=plain,comma"\n');
  });

  test("benign cells stay byte-identical to the pre-guard contract", () => {
    const csv = buildDirectoryCsv({
      headers: ["الاسم", "Email"],
      rows: [
        ["أحمد محمد", "a@b.c"],
        ["name, with comma", 'say "hi"'],
      ],
    });
    expect(csv).toBe('\uFEFFالاسم,Email\nأحمد محمد,a@b.c\n"name, with comma","say ""hi"""\n');
  });

  test("csvBoolCell serializes the lowercase wire strings", () => {
    expect(csvBoolCell(true)).toBe("true");
    expect(csvBoolCell(false)).toBe("false");
  });
});
