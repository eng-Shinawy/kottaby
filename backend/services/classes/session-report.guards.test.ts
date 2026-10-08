/**
 * Session Report Guards 4-Tier Unit Test Suite (pure validators — zero DB).
 *
 * Tier 1: 100% statement & branch coverage for every exported guard.
 * Tier 2: Boundary & edge cases (notes length 2000/2001, rating 0/5, grade
 *         0/100, ayah span endpoints, ayah storage bound).
 * Tier 3: Seeded deterministic fuzz sweep over ALL guards — the ONLY thrown
 *         class ever is the localized `ValidationError` (`code` "VALIDATION")
 *         whose message is always a member of the closed en copy set.
 * Tier 4: Security & purity — frozen-payload immutability, statelessness,
 *         wire-null fail-closed semantics, enum string smuggling through the
 *         `isSurahJuzRef` integration, no-input-echo denials, and a source
 *         pin proving the module stays dependency-free (no DB, no logger).
 */

import { describe, expect, test } from "bun:test";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ValidationError } from "@/backend/lib/errors";
import {
  assertGrade0To100,
  assertHomeWorkBlock,
  assertPositiveSessionId,
  assertRating0To5,
  assertTeacherNotes,
  validateAssignment,
  validatePreviousGrades,
} from "@/backend/services/classes/session-report.guards";
import type { HomeWorkAssignInput, HomeWorkBlockInput, HomeWorkGradeFieldsInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

function t() {
  return getServerTranslations("en").errorsTranslations;
}

function tAr() {
  return getServerTranslations("ar").errorsTranslations;
}

function validBlock(): HomeWorkBlockInput {
  return { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.SurahAlFatihah };
}

function blockWith(overrides: Partial<HomeWorkBlockInput>): HomeWorkBlockInput {
  return { ...validBlock(), ...overrides };
}

function validGrades(): HomeWorkGradeFieldsInput {
  return { currentGrade: 25, revisionGrade: 75 };
}

/**
 * try/catch denial helper (the house pattern): asserts the ONLY thrown
 * class is `ValidationError` with the `VALIDATION` code and the exact
 * expected localized message — never a plain Error/TypeError.
 */
function expectValidationError(execute: () => void, message: string): void {
  let caught: unknown = null;
  try {
    execute();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  if (caught instanceof ValidationError) {
    expect(caught.code).toBe("VALIDATION");
    expect(caught.message).toBe(message);
  }
}

/** Seeded deterministic PRNG (mulberry32) — identical seed ⇒ identical sweep. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function picker(random: () => number): <T>(pool: readonly T[]) => T {
  return <T>(pool: readonly T[]): T => pool[Math.floor(random() * pool.length)];
}

const ID_POOL: unknown[] = [
  1,
  42,
  9007199254740991,
  0,
  -3,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "7",
  null,
  undefined,
  true,
  {},
  [],
  BigInt(7),
];

const RATING_POOL = [
  0,
  1,
  2,
  3,
  4,
  5,
  -1,
  -5,
  6,
  10,
  0.5,
  2.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  1e21,
];

const GRADE_POOL = [
  0,
  50,
  100,
  -1,
  101,
  1000,
  0.5,
  99.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
];

const AYAH_POOL = [
  1,
  2,
  5,
  10,
  23,
  0,
  -1,
  -7,
  0.5,
  3.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2_147_483_647,
  2_147_483_648,
];

/**
 * Deliberate NON-members of the 144-member vocabulary (wrong case, whitespace,
 * near-miss, overflow, unicode) — every entry audited against the canonical
 * mushaf dataset: `juz_0`/`juz_31`/`juz_300` are outside the 1..30 juz range,
 * `page_1` names no member of ANY family, and `surah_an_nuh` is the naming
 * trap — surah 71 ships as `surah_nuh`, so the an-prefixed spelling stays a
 * non-member at every vocabulary size.
 */
const INVALID_SURAH_STRINGS = [
  "",
  "juz_0",
  "juz_31",
  "juz_300",
  "page_1",
  "surah_an_nuh",
  "SURAH_AL_FATIHAH",
  "surah_al_fatihah ",
  " surah_al_fatihah",
  "surah_alfatihah",
  "juz_1 ",
  "juz_1\0",
  "surah_al_baqarah;drop",
  "٥",
];

const SURAH_POOL: unknown[] = [...Object.values(SurahJuzRef), ...INVALID_SURAH_STRINGS];

const NOTES_POOL = [
  "",
  "   ",
  "\t\n  ",
  "valid teacher notes",
  "a".repeat(1999),
  "a".repeat(2000),
  "a".repeat(2001),
  "a".repeat(2100),
  `  ${"b".repeat(1000)}  `,
  "ملاحظات المعلم بعد الجلسة",
];

/**
 * Builds a wire-shaped block whose surahJuz is an arbitrary runtime value: a
 * transport delivers the surah/juz reference as an unchecked string, so the
 * smuggled shapes are injected past the type system at this one pinned call
 * site instead of scattering casts.
 */
function wireBlock(fromAyah: number, toAyah: number, surahJuz: unknown): HomeWorkBlockInput {
  const block: HomeWorkBlockInput = { fromAyah, toAyah, surahJuz: SurahJuzRef.SurahAlFatihah };
  Object.assign(block, { surahJuz });
  return block;
}

function fuzzBlock(random: () => number): HomeWorkBlockInput {
  const pick = picker(random);
  return wireBlock(pick(AYAH_POOL), pick(AYAH_POOL), pick(SURAH_POOL));
}

/**
 * Builds a wire-shaped assignment payload: a transport can deliver `null` (or
 * any non-object) for an optional member even though the canonical input type
 * says `undefined` — this helper injects such runtime shapes past the type
 * system at one pinned call site instead of scattering casts.
 */
function wireAssignment(jadid: unknown, madi: unknown): HomeWorkAssignInput {
  const payload: HomeWorkAssignInput = {};
  Object.assign(payload, { jadid, madi });
  return payload;
}

function fuzzLeg(roll: number, random: () => number): unknown {
  if (roll < 0.4) {
    return undefined;
  }
  if (roll < 0.45) {
    return null;
  }
  return fuzzBlock(random);
}

/** Random assignment shape: absent (undefined), wire-null, or fuzzed block legs. */
function fuzzAssignment(random: () => number): HomeWorkAssignInput {
  const jadid = fuzzLeg(random(), random);
  const madi = fuzzLeg(random(), random);
  return wireAssignment(jadid, madi);
}

/** One deterministic sweep pass; records "ok" or the thrown message per case. */
function runSweep(): string[] {
  const random = mulberry32(0x5eed);
  const pick = picker(random);
  const en = t();
  const outcomes: string[] = [];
  for (let iteration = 0; iteration < 300; iteration++) {
    const cases: Array<() => void> = [
      () => assertPositiveSessionId(pick(ID_POOL), en),
      () => {
        assertTeacherNotes(pick(NOTES_POOL), en);
      },
      () => assertRating0To5(pick(RATING_POOL), en),
      () => assertGrade0To100(pick(GRADE_POOL), en),
      () => assertHomeWorkBlock(fuzzBlock(random), en),
      () => validateAssignment(fuzzAssignment(random), en),
      () => validatePreviousGrades({ currentGrade: pick(GRADE_POOL), revisionGrade: pick(GRADE_POOL) }, en),
    ];
    for (const execute of cases) {
      let caught: unknown = null;
      try {
        execute();
      } catch (error: unknown) {
        caught = error;
      }
      if (caught === null) {
        outcomes.push("ok");
        continue;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      if (caught instanceof ValidationError) {
        expect(caught.code).toBe("VALIDATION");
        outcomes.push(caught.message);
      }
    }
  }
  return outcomes;
}

describe("assertPositiveSessionId", () => {
  describe("Tier 1 — branch coverage", () => {
    test("accepts positive safe integer session ids", () => {
      expect(() => assertPositiveSessionId(1, t())).not.toThrow();
      expect(() => assertPositiveSessionId(42, t())).not.toThrow();
      expect(() => assertPositiveSessionId(9007199254740991, t())).not.toThrow();
    });

    test("rejects every malformed id shape with the localized VALIDATION denial", () => {
      const en = t();
      const invalidInputs: unknown[] = ["abc", "7", 0, -10, 1.5, Number.NaN, null, undefined, {}, [], true, BigInt(7)];
      for (const input of invalidInputs) {
        expectValidationError(() => assertPositiveSessionId(input, en), en.validation);
      }
    });
  });

  describe("Tier 1 — asserts narrowing contract", () => {
    test("the `asserts id is number` predicate narrows the caller's unknown", () => {
      const candidate: unknown = Number("7");
      assertPositiveSessionId(candidate, t());
      // Compiles only because the guard asserted `candidate is number` — on a
      // declared-unknown binding the same arithmetic without the assert call
      // fails compilation (unknown operand).
      expect(candidate + 1).toBe(8);
    });
  });
});

describe("assertTeacherNotes", () => {
  describe("Tier 1 — branch coverage", () => {
    test("returns the trimmed value for valid notes", () => {
      expect(assertTeacherNotes("  Great session, well done.  ", t())).toBe("Great session, well done.");
      expect(assertTeacherNotes("ملاحظات المعلم", t())).toBe("ملاحظات المعلم");
    });

    test("rejects empty and whitespace-only notes with the required key", () => {
      const en = t();
      expectValidationError(() => assertTeacherNotes("", en), en.sessionReportNotesRequired);
      expectValidationError(() => assertTeacherNotes("   \t\n  ", en), en.sessionReportNotesRequired);
    });

    test("rejects over-limit notes with the too-long key", () => {
      expectValidationError(() => assertTeacherNotes("a".repeat(2001), t()), t().sessionReportNotesTooLong);
    });
  });

  describe("Tier 2 — boundary & edge cases", () => {
    test("exactly 2000 characters accepted, 2001 rejected", () => {
      const en = t();
      expect(assertTeacherNotes("a".repeat(2000), en)).toHaveLength(2000);
      expect(() => assertTeacherNotes("a".repeat(2001), en)).toThrow(ValidationError);
    });

    test("padding interacts with the bound through the trimmed length", () => {
      const en = t();
      expect(assertTeacherNotes(`   ${"c".repeat(2000)}   `, en)).toHaveLength(2000);
      expectValidationError(() => assertTeacherNotes(`  ${"d".repeat(2001)}  `, en), en.sessionReportNotesTooLong);
    });

    test("unicode / RTL characters within the bound are preserved trimmed", () => {
      expect(assertTeacherNotes("  سبب الحفظ \u05D0\u05D1\u05D2  ", t())).toBe("سبب الحفظ \u05D0\u05D1\u05D2");
    });

    test("rejects notes containing null bytes", () => {
      expectValidationError(
        () => assertTeacherNotes("  \u0000 سبب الحفظ \u05D0\u05D1\u05D2  ", t()),
        t().sessionReportNotesRequired
      );
    });
  });
});

describe("assertRating0To5", () => {
  describe("Tier 1 — branch coverage", () => {
    test("accepts every integer in 0..5", () => {
      const en = t();
      for (const rating of [0, 1, 2, 3, 4, 5]) {
        expect(() => assertRating0To5(rating, en)).not.toThrow();
      }
    });

    test("rejects non-integers, specials, and out-of-range values", () => {
      const en = t();
      for (const rating of [-1, 6, 10, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expectValidationError(() => assertRating0To5(rating, en), en.sessionRatingRange);
      }
    });
  });

  describe("Tier 2 — boundary & edge cases", () => {
    test("bounds 0 and 5 are inclusive, -1 and 6 are exclusive", () => {
      const en = t();
      expect(() => assertRating0To5(0, en)).not.toThrow();
      expect(() => assertRating0To5(5, en)).not.toThrow();
      expectValidationError(() => assertRating0To5(-1, en), en.sessionRatingRange);
      expectValidationError(() => assertRating0To5(6, en), en.sessionRatingRange);
    });

    test("unsafe-integer magnitudes fail closed", () => {
      const en = t();
      expectValidationError(() => assertRating0To5(Number.MAX_SAFE_INTEGER + 1, en), en.sessionRatingRange);
      expectValidationError(() => assertRating0To5(1e21, en), en.sessionRatingRange);
    });
  });
});

describe("assertGrade0To100", () => {
  describe("Tier 1 — branch coverage", () => {
    test("accepts integers in 0..100", () => {
      const en = t();
      for (const grade of [0, 1, 25, 50, 75, 99, 100]) {
        expect(() => assertGrade0To100(grade, en)).not.toThrow();
      }
    });

    test("rejects non-integers, specials, and out-of-range values", () => {
      const en = t();
      for (const grade of [-1, 101, 1000, 0.5, 99.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expectValidationError(() => assertGrade0To100(grade, en), en.homeworkGradeRange);
      }
    });
  });

  describe("Tier 2 — boundary & edge cases", () => {
    test("bounds 0 and 100 are inclusive, -1 and 101 are exclusive", () => {
      const en = t();
      expect(() => assertGrade0To100(0, en)).not.toThrow();
      expect(() => assertGrade0To100(100, en)).not.toThrow();
      expectValidationError(() => assertGrade0To100(-1, en), en.homeworkGradeRange);
      expectValidationError(() => assertGrade0To100(101, en), en.homeworkGradeRange);
    });

    test("unsafe-integer magnitudes fail closed", () => {
      const en = t();
      expectValidationError(() => assertGrade0To100(Number.MAX_SAFE_INTEGER + 1, en), en.homeworkGradeRange);
      expectValidationError(() => assertGrade0To100(Number.NEGATIVE_INFINITY, en), en.homeworkGradeRange);
    });
  });
});

describe("assertHomeWorkBlock", () => {
  describe("Tier 1 — branch coverage", () => {
    test("accepts a valid block", () => {
      expect(() => assertHomeWorkBlock(validBlock(), t())).not.toThrow();
    });

    test("rejects malformed ayah endpoints with the ayah-range key", () => {
      const en = t();
      expectValidationError(() => assertHomeWorkBlock(blockWith({ fromAyah: 0 }), en), en.homeworkAyahRangeInvalid);
      expectValidationError(() => assertHomeWorkBlock(blockWith({ fromAyah: -2 }), en), en.homeworkAyahRangeInvalid);
      expectValidationError(
        () => assertHomeWorkBlock(blockWith({ fromAyah: Number.NaN }), en),
        en.homeworkAyahRangeInvalid
      );
      expectValidationError(() => assertHomeWorkBlock(blockWith({ toAyah: 0 }), en), en.homeworkAyahRangeInvalid);
      expectValidationError(
        () => assertHomeWorkBlock(blockWith({ toAyah: Number.NaN }), en),
        en.homeworkAyahRangeInvalid
      );
      expectValidationError(
        () => assertHomeWorkBlock(blockWith({ fromAyah: 3, toAyah: 2 }), en),
        en.homeworkAyahRangeInvalid
      );
    });

    test("rejects a non-member surah/juz reference with the vocabulary key (fixtures audited against the canonical dataset)", () => {
      const en = t();
      expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "juz_31"), en), en.homeworkSurahJuzInvalid);
      expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "juz_0"), en), en.homeworkSurahJuzInvalid);
      expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "page_1"), en), en.homeworkSurahJuzInvalid);
      expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "surah_an_nuh"), en), en.homeworkSurahJuzInvalid);
      expectValidationError(
        () => assertHomeWorkBlock(wireBlock(1, 5, "SURAH_AL_FATIHAH"), en),
        en.homeworkSurahJuzInvalid
      );
      expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "Juz_3"), en), en.homeworkSurahJuzInvalid);
    });

    test("accepts EVERY shipped SurahJuzRef member (enum-value integration, 144/144)", () => {
      const en = t();
      for (const member of Object.values(SurahJuzRef)) {
        expect(() => assertHomeWorkBlock(blockWith({ surahJuz: member }), en)).not.toThrow();
      }
    });
  });

  describe("Tier 2 — boundary & edge cases", () => {
    test("fromAyah = toAyah is a legal single-ayah span", () => {
      expect(() => assertHomeWorkBlock(blockWith({ fromAyah: 7, toAyah: 7 }), t())).not.toThrow();
    });

    test("ayah 0 and negative ayahs are rejected", () => {
      const en = t();
      expectValidationError(
        () => assertHomeWorkBlock(blockWith({ fromAyah: 0, toAyah: 7 }), en),
        en.homeworkAyahRangeInvalid
      );
      expectValidationError(() => assertHomeWorkBlock(blockWith({ toAyah: -1 }), en), en.homeworkAyahRangeInvalid);
    });

    test("non-safe-integer ayahs are rejected (fractional, infinite, unsafe magnitude)", () => {
      const en = t();
      for (const ayah of [0.5, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        expectValidationError(
          () => assertHomeWorkBlock(blockWith({ fromAyah: ayah }), en),
          en.homeworkAyahRangeInvalid
        );
        expectValidationError(() => assertHomeWorkBlock(blockWith({ toAyah: ayah }), en), en.homeworkAyahRangeInvalid);
      }
    });

    test("ayah storage bound: the largest persistable span is accepted, one above is rejected", () => {
      const en = t();
      // 2_147_483_647 is the PostgreSQL integer ceiling of the home_work
      // ayah columns — the largest value that can ever persist.
      expect(() =>
        assertHomeWorkBlock(blockWith({ fromAyah: 2_147_483_647, toAyah: 2_147_483_647 }), en)
      ).not.toThrow();
      expectValidationError(
        () => assertHomeWorkBlock(blockWith({ fromAyah: 2_147_483_647, toAyah: 2_147_483_648 }), en),
        en.homeworkAyahRangeInvalid
      );
      expectValidationError(
        () => assertHomeWorkBlock(blockWith({ fromAyah: 2_147_483_648, toAyah: 2_147_483_648 }), en),
        en.homeworkAyahRangeInvalid
      );
    });
  });
});

describe("validateAssignment", () => {
  describe("Tier 1 — branch coverage", () => {
    test("rejects a payload with neither block present", () => {
      expectValidationError(() => validateAssignment({}, t()), t().homeworkAssignmentBlocksRequired);
      expectValidationError(
        () => validateAssignment({ jadid: undefined, madi: undefined }, t()),
        t().homeworkAssignmentBlocksRequired
      );
    });

    test("accepts jadid-only, madi-only, and both-blocks payloads", () => {
      expect(() => validateAssignment({ jadid: validBlock() }, t())).not.toThrow();
      expect(() => validateAssignment({ madi: validBlock() }, t())).not.toThrow();
      expect(() => validateAssignment({ jadid: validBlock(), madi: validBlock() }, t())).not.toThrow();
    });

    test("each present block is validated — a malformed leg denies with its own key", () => {
      const en = t();
      expectValidationError(
        () => validateAssignment({ jadid: blockWith({ fromAyah: 9, toAyah: 3 }) }, en),
        en.homeworkAyahRangeInvalid
      );
      expectValidationError(
        () => validateAssignment({ madi: wireBlock(1, 5, "juz_99") }, en),
        en.homeworkSurahJuzInvalid
      );
      expectValidationError(
        () => validateAssignment({ jadid: blockWith({ fromAyah: 0 }), madi: wireBlock(1, 5, "juz_99") }, en),
        en.homeworkAyahRangeInvalid
      );
    });
  });

  describe("Tier 4 — wire-null fail-closed semantics", () => {
    test("a null leg counts as ABSENT — null-only payload denies with the blocks key, never a TypeError", () => {
      const en = t();
      expectValidationError(
        () => validateAssignment(wireAssignment(null, undefined), en),
        en.homeworkAssignmentBlocksRequired
      );
      expectValidationError(
        () => validateAssignment(wireAssignment(undefined, null), en),
        en.homeworkAssignmentBlocksRequired
      );
      expectValidationError(
        () => validateAssignment(wireAssignment(null, null), en),
        en.homeworkAssignmentBlocksRequired
      );
    });

    test("a null leg beside a valid leg validates the valid leg", () => {
      expect(() => validateAssignment(wireAssignment(null, validBlock()), t())).not.toThrow();
      expect(() => validateAssignment(wireAssignment(validBlock(), null), t())).not.toThrow();
    });
  });
});

describe("validatePreviousGrades", () => {
  describe("Tier 1 — branch coverage", () => {
    test("accepts in-range pairs including both boundary extremes", () => {
      const en = t();
      expect(() => validatePreviousGrades({ currentGrade: 0, revisionGrade: 100 }, en)).not.toThrow();
      expect(() => validatePreviousGrades(validGrades(), en)).not.toThrow();
    });

    test("rejects an out-of-range current grade", () => {
      expectValidationError(
        () => validatePreviousGrades({ currentGrade: -1, revisionGrade: 50 }, t()),
        t().homeworkGradeRange
      );
    });

    test("rejects an out-of-range revision grade", () => {
      expectValidationError(
        () => validatePreviousGrades({ currentGrade: 50, revisionGrade: 101 }, t()),
        t().homeworkGradeRange
      );
    });

    test("both grades invalid denies on the CURRENT grade first (deterministic order)", () => {
      expectValidationError(
        () => validatePreviousGrades({ currentGrade: -1, revisionGrade: 101 }, t()),
        t().homeworkGradeRange
      );
    });
  });

  describe("Tier 2 — boundary & edge cases", () => {
    test("0/0 and 100/100 pairs are legal; 0.5 pairs are not", () => {
      const en = t();
      expect(() => validatePreviousGrades({ currentGrade: 0, revisionGrade: 0 }, en)).not.toThrow();
      expect(() => validatePreviousGrades({ currentGrade: 100, revisionGrade: 100 }, en)).not.toThrow();
      expectValidationError(
        () => validatePreviousGrades({ currentGrade: 0.5, revisionGrade: 50 }, en),
        en.homeworkGradeRange
      );
      expectValidationError(
        () => validatePreviousGrades({ currentGrade: 50, revisionGrade: 0.5 }, en),
        en.homeworkGradeRange
      );
    });
  });
});

describe("Tier 3 — seeded deterministic fuzz sweep (all guards)", () => {
  test("the ONLY thrown class is ValidationError (code VALIDATION) with a closed en message set", () => {
    const en = t();
    const allowed = new Set([
      en.validation,
      en.sessionReportNotesRequired,
      en.sessionReportNotesTooLong,
      en.sessionRatingRange,
      en.homeworkGradeRange,
      en.homeworkAyahRangeInvalid,
      en.homeworkSurahJuzInvalid,
      en.homeworkAssignmentBlocksRequired,
    ]);
    const outcomes = runSweep();
    expect(outcomes).toHaveLength(300 * 7);
    const thrown = outcomes.filter(outcome => outcome !== "ok");
    expect(thrown.length).toBeGreaterThan(0);
    for (const message of thrown) {
      expect(allowed.has(message)).toBe(true);
    }
  });

  test("identical seed reproduces the identical accept/deny trace (determinism pin)", () => {
    expect(runSweep()).toEqual(runSweep());
  });
});

describe("Tier 4 — security & purity", () => {
  test("guards mutate nothing — frozen payloads pass through untouched", () => {
    const block = Object.freeze(validBlock());
    const grades = Object.freeze(validGrades());
    const assignment = Object.freeze({ jadid: validBlock(), madi: undefined });
    expect(() => assertHomeWorkBlock(block, t())).not.toThrow();
    expect(() => validatePreviousGrades(grades, t())).not.toThrow();
    expect(() => validateAssignment(assignment, t())).not.toThrow();
    expect(assignment.jadid).toEqual(validBlock());
  });

  test("rejected payloads leave the input object byte-identical (zero side effects)", () => {
    const payload: HomeWorkAssignInput = { jadid: validBlock(), madi: blockWith({ fromAyah: 5, toAyah: 2 }) };
    const snapshot = structuredClone(payload);
    expect(() => validateAssignment(payload, t())).toThrow(ValidationError);
    expect(payload).toEqual(snapshot);
  });

  test("guards are stateless — repeated calls are pure and deterministic", () => {
    const en = t();
    expect(assertTeacherNotes("  repeat  ", en)).toBe(assertTeacherNotes("  repeat  ", en));
    expect(() => assertRating0To5(3, en)).not.toThrow();
    expect(() => assertRating0To5(3, en)).not.toThrow();
    for (let attempt = 0; attempt < 50; attempt++) {
      expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "juz_31"), en), en.homeworkSurahJuzInvalid);
    }
  });

  test("enum values arrive as strings from the wire and are rejected unless members", () => {
    const en = t();
    for (const smuggled of INVALID_SURAH_STRINGS) {
      expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, smuggled), en), en.homeworkSurahJuzInvalid);
    }
    // A raw string carrying an actual enum VALUE passes — the guard integrates
    // the isSurahJuzRef enum guard (value-set membership), not literal equality
    // against a hand-written list in the module.
    expect(() => assertHomeWorkBlock(wireBlock(1, 5, "juz_30"), en)).not.toThrow();
    expect(() => assertHomeWorkBlock(wireBlock(1, 5, "surah_al_maidah"), en)).not.toThrow();
  });

  test("denials never echo the rejected payload", () => {
    const hostile = `${"x".repeat(2001)} <script>alert(1)</script>`;
    let message = "";
    try {
      assertTeacherNotes(hostile, t());
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        message = error.message;
      }
    }
    expect(message).toBe(t().sessionReportNotesTooLong);
    expect(message).not.toContain("script");
    expect(message).not.toContain("xxxx");
  });

  test("source pin — the module stays dependency-free: zero DB, zero logging, zero injected seams", async () => {
    const source = await Bun.file(new URL("./session-report.guards.ts", import.meta.url)).text();
    expect(source).not.toContain("@/backend/db");
    expect(source).not.toContain("Repository");
    expect(source).not.toContain("logger");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("tx");
    // Translations arrive ONLY as the parameter handle — never a runtime
    // getServerTranslations call inside the module (type import only).
    expect(source).toContain('import type { getServerTranslations } from "@/shared/locale/server-graphql";');
    expect(source).not.toContain("import { getServerTranslations }");
  });
});

describe("localized denials — en + ar leaf maps", () => {
  test("every guard's denial resolves its dedicated flat key in en", () => {
    const en = t();
    expectValidationError(() => assertPositiveSessionId(0, en), en.validation);
    expectValidationError(() => assertTeacherNotes("", en), en.sessionReportNotesRequired);
    expectValidationError(() => assertTeacherNotes("a".repeat(2001), en), en.sessionReportNotesTooLong);
    expectValidationError(() => assertRating0To5(6, en), en.sessionRatingRange);
    expectValidationError(() => assertGrade0To100(101, en), en.homeworkGradeRange);
    expectValidationError(
      () => assertHomeWorkBlock(blockWith({ fromAyah: 3, toAyah: 2 }), en),
      en.homeworkAyahRangeInvalid
    );
    expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "juz_31"), en), en.homeworkSurahJuzInvalid);
    expectValidationError(() => validateAssignment({}, en), en.homeworkAssignmentBlocksRequired);
  });

  test("the same denials resolve the arabic leaf map (locale passed through the handle)", () => {
    const ar = tAr();
    expectValidationError(() => assertPositiveSessionId("abc", ar), ar.validation);
    expectValidationError(() => assertTeacherNotes("   ", ar), ar.sessionReportNotesRequired);
    expectValidationError(() => assertTeacherNotes("a".repeat(2001), ar), ar.sessionReportNotesTooLong);
    expectValidationError(() => assertRating0To5(-1, ar), ar.sessionRatingRange);
    expectValidationError(() => assertGrade0To100(-1, ar), ar.homeworkGradeRange);
    expectValidationError(() => assertHomeWorkBlock(blockWith({ fromAyah: 0 }), ar), ar.homeworkAyahRangeInvalid);
    expectValidationError(() => assertHomeWorkBlock(wireBlock(1, 5, "juz_31"), ar), ar.homeworkSurahJuzInvalid);
    expectValidationError(() => validateAssignment({}, ar), ar.homeworkAssignmentBlocksRequired);
  });

  test("en and ar copies are distinct localizations of the same keys (not one language twice)", () => {
    const en = t();
    const ar = tAr();
    expect(en.sessionReportNotesRequired).not.toBe(ar.sessionReportNotesRequired);
    expect(en.homeworkSurahJuzInvalid).not.toBe(ar.homeworkSurahJuzInvalid);
    expect(ar.sessionReportNotesRequired).toBe("ملاحظات تقرير الجلسة مطلوبة ولا يمكن تركها فارغة.");
  });
});
