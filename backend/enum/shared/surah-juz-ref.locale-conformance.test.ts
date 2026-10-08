/**
 * SurahJuzRef locale-conformance — every enum member MUST carry a localized
 * display label in BOTH locale leaves.
 *
 * Backend-side by design: the shared layer must not import backend modules,
 * but backend tests may import the shared locale leaves (the legal import
 * direction). THIS suite closes the enum ↔ labels drift direction: the
 * `shared/locale` parity belt lists the vocabulary literally, while this
 * suite re-derives the same list from `Object.values(SurahJuzRef)` — so a
 * member added to the enum without a label pair fails here at CI time,
 * never in a rendered screen.
 *
 * Per member, BOTH locales must resolve:
 *   EN — non-empty, Latin script, "Surah "/"Juz " prefix,
 *   AR — non-empty, Arabic script, "سورة "/"الجزء " prefix.
 * A label that equals the raw ref means the lookup missed and the
 * fail-closed fallback absorbed a missing entry — treated as a failure
 * (completeness is machine-enforced, not review-enforced).
 *
 * Pure unit tier — the locale leaves are plain literal modules (no server
 * boot, no i18n loader, no DB). Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/enum/shared/surah-juz-ref.locale-conformance.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { sessionsAr } from "@/shared/locale/ar/sessions";
import { sessionsEn } from "@/shared/locale/en/sessions";

/** The live enum vocabulary — auto-grows with the `SurahJuzRef` enum. */
const SURAH_JUZ_REFS = Object.values(SurahJuzRef);

describe("SurahJuzRef locale conformance — labels exist for EVERY member in BOTH locales", () => {
  test("the loop is non-vacuous — both vocabulary families are exercised", () => {
    expect(SURAH_JUZ_REFS.length).toBeGreaterThan(0);
    expect(SURAH_JUZ_REFS.some(ref => ref.startsWith("surah_"))).toBe(true);
    expect(SURAH_JUZ_REFS.some(ref => ref.startsWith("juz_"))).toBe(true);
  });

  test("every member resolves a non-empty EN label with Latin script and the 'Surah '/'Juz ' prefix", () => {
    const latinScript = /[A-Za-z]/;
    for (const ref of SURAH_JUZ_REFS) {
      const label = sessionsEn.surahJuzLabel(ref);
      expect(label.length).toBeGreaterThan(0);
      expect(label).toMatch(latinScript);
      const expectedPrefix = ref.startsWith("surah_") ? "Surah " : "Juz ";
      expect(label.startsWith(expectedPrefix)).toBe(true);
    }
  });

  test("every member resolves a non-empty AR label with Arabic script and the 'سورة '/'الجزء ' prefix", () => {
    // Arabic-letters block (U+0600..U+06FF) — also covers the Arabic-Indic
    // digits (U+0660..U+0669) the ar leaf uses for juz numbering.
    const arabicScript = /[\u0600-\u06FF]/;
    for (const ref of SURAH_JUZ_REFS) {
      const label = sessionsAr.surahJuzLabel(ref);
      expect(label.length).toBeGreaterThan(0);
      expect(label).toMatch(arabicScript);
      const expectedPrefix = ref.startsWith("surah_") ? "سورة " : "الجزء ";
      expect(label.startsWith(expectedPrefix)).toBe(true);
    }
  });

  test("labels are total — the raw-ref fallback is never hit for a real member", () => {
    for (const ref of SURAH_JUZ_REFS) {
      // A label equal to the raw ref means the lookup missed and the
      // fail-closed fallback silently absorbed a missing entry.
      expect(sessionsEn.surahJuzLabel(ref)).not.toBe(ref);
      expect(sessionsAr.surahJuzLabel(ref)).not.toBe(ref);
    }
  });
});
