/**
 * Shared teacher-profile mappers — the canonical home for the fail-safe
 * parsers that turn raw `teacher`-row payload columns into typed values.
 * Consumed by both the admin directory projection and the student-facing
 * matching projection, so a single parser shape governs every read path.
 *
 * Fail-closed discipline: a stored payload that is null, empty,
 * unparseable, or shaped wrong degrades ITS OWN field (empty array /
 * null) — it never throws, never fails the enclosing read, and never
 * leaks non-conforming members past the parser.
 */
import { isRecitationReading, type RecitationReading } from "@/shared/constants/recitation-reading.enum";

/**
 * Parses the `teacher.subjects` varchar JSON payload into a string array.
 * Every non-conforming shape (null/empty, unparseable JSON, non-array
 * root, non-string members) is filtered out — a corrupt payload degrades
 * to an empty list instead of failing the directory read.
 */
export function parseSubjectsJson(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * Parses the `teacher.average_rating` decimal(3,2) read-back into a float.
 * Drizzle's default numeric mode returns the decimal as a string; `null`
 * (unrated teacher) passes through, and an unparseable payload degrades to
 * `null` rather than `NaN`.
 */
export function parseAverageRating(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses the `teacher.recitations` varchar JSON payload into the catalog
 * readings the teacher is certified to teach. Array members are kept only
 * when they pass the `isRecitationReading` catalog guard — non-string,
 * unknown, or out-of-catalog members are dropped, and every non-conforming
 * payload (null/empty, unparseable, non-array root) degrades to an empty
 * list: an unreadable certification payload asserts no certification, it
 * never throws.
 */
export function parseTeacherRecitations(raw: string | null): RecitationReading[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isRecitationReading);
  } catch {
    return [];
  }
}

/**
 * Parses the `teacher.languages` varchar JSON payload into the language
 * tokens the teacher is fluent in beyond Arabic. Shares the exact fail-safe
 * shape of `parseSubjectsJson` (string members only; null/empty,
 * unparseable, non-array root, non-string members all degrade to an empty
 * list instead of failing the read), so it delegates to that one
 * implementation rather than duplicating it.
 */
export function parseTeacherLanguages(raw: string | null): string[] {
  return parseSubjectsJson(raw);
}
