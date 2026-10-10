/**
 * Colocated unit tests for `csv-formula.ts` — the CWE-1236 neutralization
 * every CSV cell builder routes through.
 *
 * Assertion discipline: STRUCTURE only — the fixture payloads are neutral
 * mechanical strings (classic OWASP CSV-injection probes), no user-facing
 * copy is involved.
 */
import { describe, expect, test } from "bun:test";
import { neutralizeCsvFormulas } from "@/frontend/utils/csv-formula";

/**
 * The always-quote builder recipe (walletLedgerCsv / PrintExportDialog):
 * quote every cell with embedded quotes doubled.
 */
const quoteAlways = (value: string): string => `"${neutralizeCsvFormulas(value).replace(/"/g, '""')}"`;

/**
 * The conditional-quote builder recipe (directory-csv /
 * platform-analytics-csv): quote only when the defused value carries the
 * delimiter, a quote, or a newline.
 */
const quoteWhenNeeded = (value: string): string => {
  const safe = neutralizeCsvFormulas(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The classic spreadsheet-exfiltration payload (Excel DDE probe). */
const DDE_PAYLOAD = "=cmd|'/C calc'!A0";

/** Trigger prefixes the guard defuses (regex class order). */
const TRIGGERS: ReadonlyArray<[label: string, value: string, expected: string]> = [
  ["equals sign", "=cmd|'/C calc'!A0", "'=cmd|'/C calc'!A0"],
  ["plus sign", "+1=1", "'+1=1"],
  ["minus sign", "-2+3", "'-2+3"],
  ["at sign", "@SUM(A1:A2)", "'@SUM(A1:A2)"],
  ["leading TAB", "\t=cmd", "'\t=cmd"],
  ["leading CR", "\r=cmd", "'\r=cmd"],
  ["DDE full payload", DDE_PAYLOAD, "'=cmd|'/C calc'!A0"],
];

/** Values that must flow through byte-identical (no trigger prefix). */
const NON_TRIGGERS: readonly string[] = [
  "hello",
  "a=b",
  "€",
  "مرحبا بالعالم",
  "تاريخ الدورة",
  "",
  "1+1",
  "'already-prefixed",
  "tab inside\tafter",
  "newline inside\nafter",
];

describe("neutralizeCsvFormulas — trigger branches", () => {
  for (const [label, value, expected] of TRIGGERS) {
    test(`defuses a leading ${label} with a single-quote prefix`, () => {
      expect(neutralizeCsvFormulas(value)).toBe(expected);
    });
  }
});

describe("neutralizeCsvFormulas — non-trigger branches", () => {
  for (const value of NON_TRIGGERS) {
    test(`passes through byte-identical: ${JSON.stringify(value)}`, () => {
      expect(neutralizeCsvFormulas(value)).toBe(value);
    });
  }

  test("a trigger character anywhere except position 0 does not defuse", () => {
    expect(neutralizeCsvFormulas("a=b")).toBe("a=b");
    expect(neutralizeCsvFormulas("x+y")).toBe("x+y");
    expect(neutralizeCsvFormulas(" -1")).toBe(" -1");
  });
});

describe("neutralizeCsvFormulas — edge shapes", () => {
  test("a single `=` char value is still a trigger", () => {
    expect(neutralizeCsvFormulas("=")).toBe("'=");
  });

  test("a leading whitespace-only value is not a trigger (no quote prefix)", () => {
    expect(neutralizeCsvFormulas(" ")).toBe(" ");
    expect(neutralizeCsvFormulas("   ")).toBe("   ");
  });

  test("a CRLF-prefixed value defuses (the CR prefix is the trigger)", () => {
    expect(neutralizeCsvFormulas("\r\n=cmd")).toBe("'\r\n=cmd");
  });

  test("an LF-prefixed value alone is not a trigger", () => {
    expect(neutralizeCsvFormulas("\n=cmd")).toBe("\n=cmd");
  });
});

describe("neutralizeCsvFormulas — idempotence", () => {
  test("applying the guard twice yields the same bytes as applying it once", () => {
    for (const value of [DDE_PAYLOAD, "+1=1", "-2+3", "@SUM(A1:A2)", "\t=cmd", "\r=cmd", "hello", ""]) {
      const once = neutralizeCsvFormulas(value);
      expect(neutralizeCsvFormulas(once)).toBe(once);
    }
  });
});

describe("neutralizeCsvFormulas — quoting interplay", () => {
  test("composes with the always-quote builder (doubled embedded quotes)", () => {
    expect(quoteAlways('=SUM(A1,"x")')).toBe('"\'=SUM(A1,""x"")"');
    expect(quoteAlways("plain")).toBe('"plain"');
  });

  test("composes with the conditional-quote builder (quote test runs on the defused value)", () => {
    expect(quoteWhenNeeded("=cmd|'/C calc'!A0")).toBe("'=cmd|'/C calc'!A0");
    expect(quoteWhenNeeded('=a,"b"')).toBe('"\'=a,""b"""');
    expect(quoteWhenNeeded("plain,text")).toBe('"plain,text"');
  });
});
