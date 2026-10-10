/**
 * Colocated unit tests for `print-export-csv.ts` — the byte contract of
 * the shared print/export dialog's CSV cells.
 *
 * Regression lock: the golden strings below are the byte-level outputs of
 * the PRE-extraction `escapeCsv` composition (the dialog's original local
 * `neutralizeCsvFormulas` + quoting), captured before the guard moved into
 * `@/frontend/utils/csv-formula`. The dialog must keep producing identical
 * bytes after the extraction — the refactor is behavior-preserving for
 * every input shape.
 */
import { describe, expect, test } from "bun:test";
import { escapeCsv } from "@/frontend/views/shared/print-export/print-export-csv";

describe("escapeCsv — golden bytes (pre-extraction regression lock)", () => {
  test("defuses formula triggers with the leading single quote", () => {
    expect(escapeCsv("=cmd|'/C calc'!A0")).toBe("\"'=cmd|'/C calc'!A0\"");
    expect(escapeCsv("+1=1")).toBe('"\'+1=1"');
    expect(escapeCsv("-2+3")).toBe('"\'-2+3"');
    expect(escapeCsv("@SUM(A1:A2)")).toBe('"\'@SUM(A1:A2)"');
    expect(escapeCsv("\t=cmd")).toBe('"\'\t=cmd"');
    expect(escapeCsv("\r=cmd")).toBe('"\'\r=cmd"');
  });

  test("passes benign values through quoted but otherwise byte-identical", () => {
    expect(escapeCsv("hello")).toBe('"hello"');
    expect(escapeCsv("a=b")).toBe('"a=b"');
    expect(escapeCsv("€")).toBe('"€"');
    expect(escapeCsv("مرحبا بالعالم")).toBe('"مرحبا بالعالم"');
    expect(escapeCsv("")).toBe('""');
  });

  test("doubles embedded quotes and flattens CRLF/LF newlines to spaces", () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv("line1\r\nline2")).toBe('"line1 line2"');
    expect(escapeCsv("line1\nline2")).toBe('"line1 line2"');
    expect(escapeCsv('=a,"b"\r\nc')).toBe('"\'=a,""b"" c"');
  });
});
