/**
 * Teacher-profile mapper parser tests — the pure fail-safe parsers shared
 * by the admin directory projection and the student matching projection.
 *
 * Why a dedicated pure tier: these parsers are the fail-closed boundary
 * between corrupt stored payloads and every read surface that renders
 * them. Corrupt input (null, empty, garbage JSON, wrong root shape,
 * mixed-type members) MUST degrade its own field to `[]` / `null` — it
 * must never throw and never leak non-conforming members. This suite
 * hammers that boundary directly without a database.
 *
 * Pure unit tier — NO DB, NO server boot, NO disk writes. Runs via the
 * mandated runner:
 *   bun run test/scripts/run-test.ts backend/services/teachers/teacher-profile.mappers.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  parseAverageRating,
  parseSubjectsJson,
  parseTeacherLanguages,
  parseTeacherRecitations,
} from "@/backend/services/teachers/teacher-profile.mappers";
import { RECITATION_READINGS, RecitationReading } from "@/shared/constants/recitation-reading.enum";

/** Runs `parse` and reports whether it threw — the never-throw probe. */
function attempt<T>(parse: () => T): { threw: true } | { threw: false; value: T } {
  try {
    return { threw: false, value: parse() };
  } catch {
    return { threw: true };
  }
}

/** Every corrupt/awkward raw payload the varchar columns could ever hold. */
const CORRUPT_PAYLOADS: (string | null)[] = [
  null,
  "",
  "   ",
  "not json",
  "[1,2]",
  "[",
  "{",
  "42",
  "null",
  "true",
  '"bare string"',
  '{"subjects":["quran"]}',
  '{"a":1}',
  "[1,2,]",
  '["unclosed',
  "[{}]",
  "[[1]]",
  "undefined",
  "NaN",
  "x".repeat(300),
];

describe("parseSubjectsJson", () => {
  test("corrupt payloads degrade to [] (never throw)", () => {
    for (const payload of CORRUPT_PAYLOADS) {
      const outcome = attempt(() => parseSubjectsJson(payload));
      expect(outcome.threw).toBe(false);
      if (!outcome.threw) {
        expect(outcome.value).toEqual([]);
      }
    }
  });

  test("valid string arrays pass through member-for-member", () => {
    expect(parseSubjectsJson('["quran","tajweed"]')).toEqual(["quran", "tajweed"]);
    expect(parseSubjectsJson("[]")).toEqual([]);
    expect(parseSubjectsJson('["\\u0627\\u0644\\u0642\\u0631\\u0622\\u0646"]')).toEqual(["القرآن"]);
  });

  test("mixed-type arrays keep only the string members", () => {
    expect(parseSubjectsJson('["hafs_an_asim", 42]')).toEqual(["hafs_an_asim"]);
    expect(parseSubjectsJson('[null,"tajweed",{"nested":true},["deep"]]')).toEqual(["tajweed"]);
  });

  test("unicode tokens survive the JSON round-trip", () => {
    expect(parseSubjectsJson('["القرآن الكريم","fiqh 📖","فقه"]')).toEqual(["القرآن الكريم", "fiqh 📖", "فقه"]);
  });

  test("max-length payloads (at and beyond the varchar(255) bound) parse or degrade, never throw", () => {
    const atBound = `["${"a".repeat(251)}"]`;
    expect(atBound).toHaveLength(255);
    expect(parseSubjectsJson(atBound)).toEqual(["a".repeat(251)]);
    expect(parseSubjectsJson(`["${"a".repeat(600)}"]`)).toEqual(["a".repeat(600)]);
  });
});

describe("parseAverageRating", () => {
  test("null passes through as null (unrated teacher)", () => {
    expect(parseAverageRating(null)).toBeNull();
  });

  test("decimal read-backs parse to floats", () => {
    expect(parseAverageRating("4.50")).toBeCloseTo(4.5);
    expect(parseAverageRating("0.00")).toBe(0);
    expect(parseAverageRating("5")).toBe(5);
    expect(parseAverageRating("2.55")).toBeCloseTo(2.55, 2);
  });

  test("surrounding whitespace is tolerated", () => {
    expect(parseAverageRating("  3.25  ")).toBeCloseTo(3.25);
  });

  test("unparseable payloads degrade to null, never NaN and never throw", () => {
    for (const payload of ["", "not a number", "1e999", "abc", "--5"]) {
      const outcome = attempt(() => parseAverageRating(payload));
      expect(outcome.threw).toBe(false);
      if (!outcome.threw) {
        expect(outcome.value).toBeNull();
      }
    }
  });

  test("float prefix semantics are pinned (verbatim parser behavior)", () => {
    expect(parseAverageRating("2.5abc")).toBeCloseTo(2.5);
    expect(parseAverageRating("12")).toBe(12);
  });
});

describe("parseTeacherRecitations", () => {
  test("corrupt payloads degrade to [] (never throw)", () => {
    for (const payload of CORRUPT_PAYLOADS) {
      const outcome = attempt(() => parseTeacherRecitations(payload));
      expect(outcome.threw).toBe(false);
      if (!outcome.threw) {
        expect(outcome.value).toEqual([]);
      }
    }
  });

  test("catalog members pass through as RecitationReading values", () => {
    expect(parseTeacherRecitations('["hafs_an_asim"]')).toEqual([RecitationReading.HAFS_AN_ASIM]);
    expect(parseTeacherRecitations('["hafs_an_asim","warsh_an_nafi"]')).toEqual([
      RecitationReading.HAFS_AN_ASIM,
      RecitationReading.WARSH_AN_NAFI,
    ]);
    expect(parseTeacherRecitations("[]")).toEqual([]);
  });

  test("every catalog value survives its own guard (full-catalog payload)", () => {
    const fullCatalog = JSON.stringify(Object.values(RecitationReading));
    expect(parseTeacherRecitations(fullCatalog)).toEqual([...RECITATION_READINGS]);
  });

  test("mixed arrays keep only catalog members", () => {
    expect(parseTeacherRecitations('["hafs_an_asim", 42]')).toEqual([RecitationReading.HAFS_AN_ASIM]);
    expect(parseTeacherRecitations('[null,"warsh_an_nafi","bogus_reading",7]')).toEqual([
      RecitationReading.WARSH_AN_NAFI,
    ]);
  });

  test("out-of-catalog and case-mismatched members are dropped (fail-closed)", () => {
    expect(parseTeacherRecitations('["bogus_reading"]')).toEqual([]);
    expect(parseTeacherRecitations('["HAFS_AN_ASIM"]')).toEqual([]);
    expect(parseTeacherRecitations('["القرآن"]')).toEqual([]);
    expect(parseTeacherRecitations('["hafs_an_asim ","hafs_an_asim"]')).toEqual([RecitationReading.HAFS_AN_ASIM]);
  });

  test("duplicate catalog members are preserved as-is", () => {
    expect(parseTeacherRecitations('["hafs_an_asim","hafs_an_asim"]')).toEqual([
      RecitationReading.HAFS_AN_ASIM,
      RecitationReading.HAFS_AN_ASIM,
    ]);
  });

  test("max-length payloads (at and beyond the varchar(255) bound) parse or degrade, never throw", () => {
    const fullCatalog = JSON.stringify(Object.values(RecitationReading));
    expect(fullCatalog.length).toBeLessThan(255);
    expect(parseTeacherRecitations(fullCatalog)).toHaveLength(RECITATION_READINGS.length);
    expect(parseTeacherRecitations(`["${"x".repeat(300)}"]`)).toEqual([]);
  });
});

describe("parseTeacherLanguages", () => {
  test("corrupt payloads degrade to [] (never throw)", () => {
    for (const payload of CORRUPT_PAYLOADS) {
      const outcome = attempt(() => parseTeacherLanguages(payload));
      expect(outcome.threw).toBe(false);
      if (!outcome.threw) {
        expect(outcome.value).toEqual([]);
      }
    }
  });

  test("string tokens pass through member-for-member", () => {
    expect(parseTeacherLanguages('["english","french"]')).toEqual(["english", "french"]);
    expect(parseTeacherLanguages("[]")).toEqual([]);
  });

  test("mixed-type arrays keep only the string members", () => {
    expect(parseTeacherLanguages('["english", 42]')).toEqual(["english"]);
    expect(parseTeacherLanguages('[null,"french",{"nested":true},["deep"]]')).toEqual(["french"]);
  });

  test("unicode tokens survive the JSON round-trip; casing is preserved verbatim", () => {
    expect(parseTeacherLanguages('["العربية","français"]')).toEqual(["العربية", "français"]);
    expect(parseTeacherLanguages('["English"]')).toEqual(["English"]);
  });

  test("max-length payloads (at and beyond the varchar(255) bound) parse or degrade, never throw", () => {
    const atBound = `["${"a".repeat(251)}"]`;
    expect(atBound).toHaveLength(255);
    expect(parseTeacherLanguages(atBound)).toEqual(["a".repeat(251)]);
    expect(parseTeacherLanguages(`["${"a".repeat(600)}"]`)).toEqual(["a".repeat(600)]);
  });
});
