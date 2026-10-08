/**
 * Teacher-directory browse presentation tables — the enum→label lookups and
 * the canonical filter choice constants shared by the browse surface's
 * filter bar, cards, and container. The OPTIONAL browse-choice tables
 * (minimum rating + ordering) live in `teacherDirectoryBrowseOptions.ts`.
 * Every browse choice is optional: the recitation and subject filters
 * default to `null` (no constraint — all readings / all subjects).
 *
 * Token-space design (oxlint `no-unsafe-enum-comparison`): every lookup is
 * a `Record` table or a `Set` membership probe — NO `switch` over enum
 * members and NO direct `enum === enum` comparisons. Wire tokens arriving
 * from MUI selects are plain strings narrowed through exported type guards
 * (fail-closed: an unknown token is rejected, never guessed); the `null`
 * "no constraint" options carry the EXPLICIT wire token `any` (never the
 * empty string). The recitation display NAMES resolve through the separate
 * `recitation` namespace; the browse chrome copy resolves through
 * `teacherDirectory`.
 */

import { RecitationReading, SessionIntent, TeacherMatchingSort } from "@/frontend/graphql/generated/gql/graphql";
import type { RecitationLabels } from "@/shared/locale/types/recitation";
import type { TeacherDirectoryLabels } from "@/shared/locale/types/teacherDirectory";

/** The `RecitationLabels` keys holding one display name per Qira'ah reading. */
export type RecitationReadingLabelKey = keyof Pick<
  RecitationLabels,
  | "alBazziAnIbnKathir"
  | "alDuriAnAbiAmr"
  | "alSusiAnAbiAmr"
  | "hafsAnAsim"
  | "khalafAnHamzah"
  | "khalladAnAsim"
  | "qalunAnNafi"
  | "qunbulAnIbnKathir"
  | "shubahAnAsim"
  | "warshAnNafi"
>;

/** The `TeacherDirectoryLabels` slice holding the two subject-intent labels. */
export type BrowseIntentLabelKey = keyof Pick<TeacherDirectoryLabels, "intentHifz" | "intentTajweed">;

/** The `TeacherDirectoryLabels` slice holding the known fluency-profile labels. */
type LanguageLabelKey = keyof Pick<TeacherDirectoryLabels, "languageArabic" | "languageEnglish" | "languageFrench">;

/** The student browse subject vocabulary — the staff-driven evaluation flow is NOT a browse choice. */
export type BrowseIntent = SessionIntent.Hifz | SessionIntent.Tajweed;

/** Recitation-reading enum member → `recitation`-namespace display-name key. */
export const RECITATION_LABEL_KEY_BY_ENUM: Record<RecitationReading, RecitationReadingLabelKey> = {
  [RecitationReading.AlBazziAnIbnKathir]: "alBazziAnIbnKathir",
  [RecitationReading.AlDuriAnAbiAmr]: "alDuriAnAbiAmr",
  [RecitationReading.AlSusiAnAbiAmr]: "alSusiAnAbiAmr",
  [RecitationReading.HafsAnAsim]: "hafsAnAsim",
  [RecitationReading.KhalafAnHamzah]: "khalafAnHamzah",
  [RecitationReading.KhalladAnAsim]: "khalladAnAsim",
  [RecitationReading.QalunAnNafi]: "qalunAnNafi",
  [RecitationReading.QunbulAnIbnKathir]: "qunbulAnIbnKathir",
  [RecitationReading.ShubahAnAsim]: "shubahAnAsim",
  [RecitationReading.WarshAnNafi]: "warshAnNafi",
};

/**
 * Recitation-reading select options — `null` (no constraint — browse across
 * ALL recitations, the default) FIRST, then the canonical catalog order
 * (Hafs `an Asim first among the readings: the most widely practiced).
 */
export const RECITATION_FILTER_OPTIONS: readonly (RecitationReading | null)[] = [
  null,
  RecitationReading.HafsAnAsim,
  RecitationReading.WarshAnNafi,
  RecitationReading.QalunAnNafi,
  RecitationReading.AlDuriAnAbiAmr,
  RecitationReading.AlSusiAnAbiAmr,
  RecitationReading.KhalafAnHamzah,
  RecitationReading.KhalladAnAsim,
  RecitationReading.ShubahAnAsim,
  RecitationReading.AlBazziAnIbnKathir,
  RecitationReading.QunbulAnIbnKathir,
];

/** Browse-intent enum member → `teacherDirectory`-namespace label key. */
export const INTENT_LABEL_KEY_BY_INTENT: Record<BrowseIntent, BrowseIntentLabelKey> = {
  [SessionIntent.Hifz]: "intentHifz",
  [SessionIntent.Tajweed]: "intentTajweed",
};

/** The subject-intent select options — `null` (no constraint — ALL subjects, the default) first, then the browse vocabulary. */
export const BROWSE_INTENT_OPTIONS: readonly (BrowseIntent | null)[] = [
  null,
  SessionIntent.Hifz,
  SessionIntent.Tajweed,
];

/** Wire-value → `BrowseIntent` table backing the intent select's resolver (`any` = no constraint). */
const BROWSE_INTENT_BY_TOKEN: Record<string, BrowseIntent | null> = {
  any: null,
  [SessionIntent.Hifz]: SessionIntent.Hifz,
  [SessionIntent.Tajweed]: SessionIntent.Tajweed,
};

/** Wire-value → `RecitationReading` table backing the recitation select's resolver (`any` = no constraint). */
const RECITATION_READING_BY_TOKEN: Record<string, RecitationReading | null> = {
  any: null,
  [RecitationReading.AlBazziAnIbnKathir]: RecitationReading.AlBazziAnIbnKathir,
  [RecitationReading.AlDuriAnAbiAmr]: RecitationReading.AlDuriAnAbiAmr,
  [RecitationReading.AlSusiAnAbiAmr]: RecitationReading.AlSusiAnAbiAmr,
  [RecitationReading.HafsAnAsim]: RecitationReading.HafsAnAsim,
  [RecitationReading.KhalafAnHamzah]: RecitationReading.KhalafAnHamzah,
  [RecitationReading.KhalladAnAsim]: RecitationReading.KhalladAnAsim,
  [RecitationReading.QalunAnNafi]: RecitationReading.QalunAnNafi,
  [RecitationReading.QunbulAnIbnKathir]: RecitationReading.QunbulAnIbnKathir,
  [RecitationReading.ShubahAnAsim]: RecitationReading.ShubahAnAsim,
  [RecitationReading.WarshAnNafi]: RecitationReading.WarshAnNafi,
};

/**
 * Resolves a MUI select wire value onto its `RecitationReading | null`
 * option — the fail-closed RESOLVER pattern (the narrowed member is the
 * return value, never a bare boolean): an unknown token resolves
 * `undefined` and the caller commits nothing; the explicit `any` token
 * resolves `null` (no recitation constraint). A type predicate alone
 * cannot serve here — it narrows TYPES but returns `true`/`false` at
 * runtime, and committing that boolean would corrupt the draft choice set.
 */
export function resolveRecitationReading(value: string): RecitationReading | null | undefined {
  return RECITATION_READING_BY_TOKEN[value];
}

/**
 * Resolves a MUI select wire value onto its `BrowseIntent | null` option —
 * the same fail-closed resolver pattern (`undefined` for an unknown token;
 * the explicit `any` token resolves `null` = no subject constraint).
 */
export function resolveBrowseIntent(value: string): BrowseIntent | null | undefined {
  return BROWSE_INTENT_BY_TOKEN[value];
}

/**
 * Recitation-reading option → select wire token — MUI select values are
 * strings, so the "all recitations" default (`null`) carries an EXPLICIT
 * token (`any`, never the empty string a browser autofill could inject).
 */
export function recitationTokenOf(option: RecitationReading | null): string {
  return option ?? "any";
}

/**
 * Subject-intent option → select wire token — the same explicit-token
 * convention: the "all subjects" default (`null`) carries `any`, never "".
 */
export function intentTokenOf(option: BrowseIntent | null): string {
  return option ?? "any";
}

/**
 * One browse's filter choices — the five optional browse dimensions: the
 * Qira'ah recitation and subject intent (`null` = no constraint — browse
 * across ALL readings/subjects), a display-name search substring (trimmed
 * on APPLY, empty means "no search"), a minimum-rating floor (`null` = any
 * rating), and the post-tier ordering key.
 */
export interface BrowseFilterChoices {
  readonly recitation: RecitationReading | null;
  readonly intent: BrowseIntent | null;
  readonly search: string;
  readonly minRating: number | null;
  readonly sort: TeacherMatchingSort;
}

/**
 * The reset/default choice set — no recitation or subject constraint (all
 * readings, all subjects), no search, no rating floor, top-rated ordering.
 */
export const DEFAULT_BROWSE_CHOICES: BrowseFilterChoices = {
  recitation: null,
  intent: null,
  search: "",
  minRating: null,
  sort: TeacherMatchingSort.RatingDesc,
};

/** Fixed page size of the student browse (SDL default echo; no size select). */
export const BROWSE_PAGE_SIZE = 25;

/**
 * Known fluency-profile token → `teacherDirectory`-namespace label key. The
 * `languages` profile column is FREE-TEXT (no enum), so the vocabulary is
 * deliberately small and open-ended: a token missing from this table is a
 * VALID profile value, never corruption — it renders as the raw token. The
 * value type carries an explicit `| undefined` so the runtime missing-token
 * probe below is a type-honest comparison.
 */
const LANGUAGE_LABEL_KEY_BY_TOKEN: Record<string, LanguageLabelKey | undefined> = {
  arabic: "languageArabic",
  english: "languageEnglish",
  french: "languageFrench",
};

/**
 * Resolves one fluency token onto its localized label — a KNOWN token
 * renders through the namespace handle, an UNKNOWN token renders verbatim
 * (never guessed, never an `as`-cast).
 */
export function resolveLanguageLabel(token: string, labels: TeacherDirectoryLabels): string {
  const labelKey = LANGUAGE_LABEL_KEY_BY_TOKEN[token];
  return labelKey === undefined ? token : labels[labelKey];
}
