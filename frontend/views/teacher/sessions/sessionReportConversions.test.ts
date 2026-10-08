/**
 * Pure-unit 4-Tier suite for the session-report conversion module.
 *
 * The backend → codegen SurahJuzRef mapper is exercised through the public
 * `toCodegenSubmitInput` surface:
 *  - Tier 1: byte-anchored member pairs + a round-trip over EVERY shipped
 *    backend member (`Object.values`, auto-grows with the vocabulary) and
 *    the full field-by-field payload mapping incl. the undefined → null legs.
 *  - Parity: sorted backend enum keys ≡ sorted codegen enum keys (144/144,
 *    order-insensitive — the backend enum declares mushaf order while the
 *    codegen emits natural-alphabetical order).
 *  - Tier 2: near-miss refs (the canonical hostile fixture, vocabulary
 *    overruns, case/whitespace variants, direction-confused wire names)
 *    all fail closed.
 *  - Tier 3: deterministic fuzz strings never leak through as values.
 *  - Tier 4: prototype / `__proto__` / function / symbol payloads throw,
 *    never coerce into a value.
 *
 * The hostile-value seam (`payloadWithForgedRef`) writes onto a REAL typed
 * payload via `Object.assign` — the suite carries no cast and no `any`.
 *
 * Pure unit tier — NO DB, NO server, NO mocks. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/sessionReportConversions.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { SurahJuzRef as BackendSurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type { SessionReportSubmitInput } from "@/backend/types";
import { SurahJuzRef as CodegenSurahJuzRef } from "@/frontend/graphql/generated/gql/graphql";
import { toCodegenSubmitInput } from "@/frontend/views/teacher/sessions/sessionReportConversions";

/** Builds a canonical homework block carrying the given backend ref. */
function backendBlock(surahJuz: BackendSurahJuzRef): {
  fromAyah: number;
  toAyah: number;
  surahJuz: BackendSurahJuzRef;
} {
  return { fromAyah: 1, toAyah: 7, surahJuz };
}

/** Full valid submission payload — both tracks and both grades present. */
function submitInput(overrides: Partial<SessionReportSubmitInput> = {}): SessionReportSubmitInput {
  return {
    teacherNotes: "Steady recitation; the revision plan continues next lesson.",
    studentRatingByTeacher: 4,
    homework: {
      jadid: backendBlock(BackendSurahJuzRef.SurahAlBaqarah),
      madi: backendBlock(BackendSurahJuzRef.Juz30),
    },
    previousGrades: { currentGrade: 80, revisionGrade: 90 },
    ...overrides,
  };
}

/**
 * Injects a ref value the static type cannot express onto a REAL typed
 * payload — the wire/runtime can deliver anything, so the suite must be
 * able to say so. This `Object.assign` write is the suite's single
 * deliberate type-erosion seam (no cast, no `any` anywhere).
 */
function payloadWithForgedRef(surahJuz: unknown): SessionReportSubmitInput {
  const payload = submitInput();
  const jadid = payload.homework?.jadid;
  if (jadid === undefined) {
    throw new Error("fixture invariant: the jadid block must exist on the base payload");
  }
  Object.assign(jadid, { surahJuz });
  return payload;
}

/**
 * Ground-truth wire value per backend ref: the Pothos enumType maps the TS
 * enum KEY to the wire and the codegen enum mirrors it, so the backend
 * member whose VALUE is the given ref names the codegen wire value
 * byte-identically.
 */
const WIRE_BY_REF: ReadonlyMap<string, string> = new Map(
  Object.entries(BackendSurahJuzRef).map(([member, ref]): [string, string] => [ref, member])
);

/** Byte-anchored conversion pairs — the frozen direction contract. */
const ANCHORED_PAIRS: ReadonlyArray<readonly [BackendSurahJuzRef, CodegenSurahJuzRef]> = [
  [BackendSurahJuzRef.SurahAlFatihah, CodegenSurahJuzRef.SurahAlFatihah],
  [BackendSurahJuzRef.SurahAlBaqarah, CodegenSurahJuzRef.SurahAlBaqarah],
  [BackendSurahJuzRef.SurahAalImran, CodegenSurahJuzRef.SurahAalImran],
  [BackendSurahJuzRef.SurahAnNisa, CodegenSurahJuzRef.SurahAnNisa],
  [BackendSurahJuzRef.SurahAlMaidah, CodegenSurahJuzRef.SurahAlMaidah],
  [BackendSurahJuzRef.Juz1, CodegenSurahJuzRef.Juz1],
  [BackendSurahJuzRef.Juz15, CodegenSurahJuzRef.Juz15],
  [BackendSurahJuzRef.Juz30, CodegenSurahJuzRef.Juz30],
];

/** Deterministic LCG-backed fuzz generator (same output on every run). */
function fuzzStrings(count: number): string[] {
  let seed = 20261004;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483647;
    return seed;
  };
  // The alphabet cannot spell any real member (no lowercase a/j/u/s/r/h),
  // so every generated candidate is a guaranteed non-member probe.
  const alphabet = "xyzXYZ019!@#$%^&*()[]{}<>~`|;:,./? ";
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = 1 + (next() % 24);
    let candidate = "";
    for (let j = 0; j < len; j++) {
      candidate += alphabet[next() % alphabet.length];
    }
    out.push(candidate);
  }
  return out;
}

describe("Tier 1 — mapper arms + full-vocabulary round-trip", () => {
  test("byte-anchored member pairs convert backend ref → codegen wire value", () => {
    for (const [ref, expected] of ANCHORED_PAIRS) {
      const out = toCodegenSubmitInput(
        submitInput({ homework: { jadid: backendBlock(ref), madi: backendBlock(BackendSurahJuzRef.Juz1) } })
      );
      expect(out.homework?.jadid?.surahJuz).toBe(expected);
    }
  });

  test("round-trips EVERY shipped member through the payload conversion (auto-grows via Object.values)", () => {
    const codegenWire = new Set(Object.values(CodegenSurahJuzRef));
    for (const ref of Object.values(BackendSurahJuzRef)) {
      const out = toCodegenSubmitInput(submitInput({ homework: { jadid: backendBlock(ref) } }));
      const wire = out.homework?.jadid?.surahJuz;
      if (wire === undefined) {
        throw new Error(`conversion dropped a present block for ref: ${ref}`);
      }
      expect(WIRE_BY_REF.get(ref)).toBe(wire);
      expect(codegenWire.has(wire)).toBe(true);
    }
  });

  test("both tracks convert through the same map in one payload", () => {
    const out = toCodegenSubmitInput(submitInput());
    expect(out.homework?.jadid?.surahJuz).toBe(CodegenSurahJuzRef.SurahAlBaqarah);
    expect(out.homework?.madi?.surahJuz).toBe(CodegenSurahJuzRef.Juz30);
  });
});

describe("backend ↔ codegen SurahJuzRef key parity (order-insensitive)", () => {
  test("sorted Object.keys of both enums are identical (144/144)", () => {
    const backendKeys = Object.keys(BackendSurahJuzRef).toSorted((a, b) => a.localeCompare(b));
    const codegenKeys = Object.keys(CodegenSurahJuzRef).toSorted((a, b) => a.localeCompare(b));
    expect(backendKeys).toHaveLength(144);
    expect(codegenKeys).toHaveLength(144);
    expect(backendKeys).toEqual(codegenKeys);
  });

  test("declaration orders differ between the mirrors (mushaf vs natural-alphabetical)", () => {
    expect(Object.keys(BackendSurahJuzRef)).not.toEqual(Object.keys(CodegenSurahJuzRef));
  });
});

describe("toCodegenSubmitInput — field-by-field mapping", () => {
  test("notes/rating pass through verbatim; both tracks and grades map field-by-field", () => {
    const out = toCodegenSubmitInput(submitInput());
    expect(out.teacherNotes).toBe("Steady recitation; the revision plan continues next lesson.");
    expect(out.studentRatingByTeacher).toBe(4);
    expect(out.homework?.jadid).toEqual({ fromAyah: 1, toAyah: 7, surahJuz: CodegenSurahJuzRef.SurahAlBaqarah });
    expect(out.homework?.madi).toEqual({ fromAyah: 1, toAyah: 7, surahJuz: CodegenSurahJuzRef.Juz30 });
    expect(out.previousGrades).toEqual({ currentGrade: 80, revisionGrade: 90 });
  });

  test("output carries exactly the four canonical fields (closed whitelist)", () => {
    const out = toCodegenSubmitInput(submitInput());
    expect(Object.keys(out).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "homework",
      "previousGrades",
      "studentRatingByTeacher",
      "teacherNotes",
    ]);
  });

  test("block whitelist — a mapped block carries exactly the three canonical fields", () => {
    const out = toCodegenSubmitInput(submitInput());
    const jadid = out.homework?.jadid;
    if (!jadid) {
      throw new Error("fixture invariant: the jadid block must be mapped");
    }
    expect(Object.keys(jadid).toSorted((a, b) => a.localeCompare(b))).toEqual(["fromAyah", "surahJuz", "toAyah"]);
  });

  test("undefined homework leg converts to an explicit null (not dropped, not undefined)", () => {
    const out = toCodegenSubmitInput(submitInput({ homework: undefined }));
    expect(out.homework).toBeNull();
    expect(out.previousGrades).toEqual({ currentGrade: 80, revisionGrade: 90 });
  });

  test("undefined previousGrades leg converts to an explicit null", () => {
    const out = toCodegenSubmitInput(submitInput({ previousGrades: undefined }));
    expect(out.previousGrades).toBeNull();
    expect(out.homework?.jadid).not.toBeNull();
  });

  test("a block absent on one track maps that leg to null (key stays present)", () => {
    const out = toCodegenSubmitInput(
      submitInput({ homework: { jadid: backendBlock(BackendSurahJuzRef.SurahAlFatihah) } })
    );
    expect(out.homework?.jadid?.surahJuz).toBe(CodegenSurahJuzRef.SurahAlFatihah);
    expect(out.homework?.madi).toBeNull();
    expect(Object.keys(out.homework ?? {})).toContain("madi");
  });

  test("a payload with both track keys present but unset maps both legs to null", () => {
    const out = toCodegenSubmitInput(submitInput({ homework: {} }));
    expect(out.homework).toEqual({ jadid: null, madi: null });
  });

  test("conversion is pure — the input payload is not mutated", () => {
    const payload = submitInput();
    const snapshot = structuredClone(payload);
    toCodegenSubmitInput(payload);
    expect(payload).toEqual(snapshot);
  });
});

describe("Tier 2 — near-miss refs fail closed", () => {
  test("the canonical hostile fixture and vocabulary overruns throw", () => {
    for (const ref of ["surah_an_nuh", "juz_31", "juz_0", "juz_00", "page_1", "surah_alfatihah", "surah_an_nisaa"]) {
      expect(() => toCodegenSubmitInput(payloadWithForgedRef(ref))).toThrow(/Unmapped SurahJuzRef value/);
    }
  });

  test("case and whitespace variants of real members throw", () => {
    for (const ref of [
      "JUZ_1",
      "Juz_1",
      " juz_1",
      "juz_1 ",
      " juz_30 ",
      "SURAH_AL_FATIHAH",
      "Surah_Al_Fatihah",
      "surah_al_fatihah\t",
      "\njuz_1",
    ]) {
      expect(() => toCodegenSubmitInput(payloadWithForgedRef(ref))).toThrow(/Unmapped SurahJuzRef value/);
    }
  });

  test("a PascalCase wire name fed into the ref slot throws (no identity passthrough)", () => {
    expect(() => toCodegenSubmitInput(payloadWithForgedRef("SurahAlFatihah"))).toThrow(/Unmapped SurahJuzRef value/);
    expect(() => toCodegenSubmitInput(payloadWithForgedRef("Juz30"))).toThrow(/Unmapped SurahJuzRef value/);
  });

  test("empty string throws", () => {
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(""))).toThrow(/Unmapped SurahJuzRef value/);
  });
});

describe("Tier 3 — deterministic fuzz never leaks through", () => {
  test("every fuzz string forged into the ref slot fails closed", () => {
    for (const candidate of fuzzStrings(150)) {
      expect(() => toCodegenSubmitInput(payloadWithForgedRef(candidate))).toThrow(/Unmapped SurahJuzRef value/);
    }
  });

  test("prefix/suffix/splice variants of a real member fail closed", () => {
    for (const candidate of ["juz_1@", "@juz_1", "juz_1x", "xjuz_1", "juz__1", "ju z_1", "juz_1;", "juz_1/"]) {
      expect(() => toCodegenSubmitInput(payloadWithForgedRef(candidate))).toThrow(/Unmapped SurahJuzRef value/);
    }
  });
});

describe("Tier 4 — hostile payloads throw, never coerce", () => {
  test("a function in the ref slot throws and is never invoked", () => {
    let calls = 0;
    const sneaky = (): string => {
      calls += 1;
      return "juz_1";
    };
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(sneaky))).toThrow();
    expect(calls).toBe(0);
  });

  test("a lying toString returning a real member cannot smuggle a conversion", () => {
    const lying: { toString: () => string } = { toString: () => "surah_al_fatihah" };
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(lying))).toThrow(/Unmapped SurahJuzRef value/);
  });

  test("null-prototype and __proto__-bearing payloads throw without coercion", () => {
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(Object.create(null)))).toThrow();
    const protoPayload: Record<string, unknown> = { ["__proto__"]: { admin: true }, value: "juz_1" };
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(protoPayload))).toThrow();
    expect(() => toCodegenSubmitInput(payloadWithForgedRef("__proto__"))).toThrow(/Unmapped SurahJuzRef value/);
  });

  test("symbols and arrays in the ref slot throw", () => {
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(Symbol.for("juz_1")))).toThrow();
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(["juz_1"]))).toThrow();
  });

  test("null and undefined in the ref slot throw (never a silent null leg)", () => {
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(null))).toThrow();
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(undefined))).toThrow();
  });

  test("explosive toString/valueOf still fail closed (an error surfaces, never a value)", () => {
    const explosive = {
      toString: (): string => {
        throw new Error("toString must not be trusted");
      },
      valueOf: (): string => {
        throw new Error("valueOf must not be trusted");
      },
    };
    expect(() => toCodegenSubmitInput(payloadWithForgedRef(explosive))).toThrow();
  });
});
