/**
 * Teacher-directory browse OPTION tables — the minimum-rating and ordering
 * choices of the student browse (`/student/teachers`), rendered by the
 * filter bar's selects and echoed by the applied-filter chips.
 *
 * Token-space design (oxlint `no-unsafe-enum-comparison`): the sort lookup
 * is a `Record` table plus a `Set`-backed type guard — NO `switch` over
 * enum members and NO `enum === enum` comparisons; a MUI select wire value
 * narrows fail-closed (an unknown token is rejected, never guessed).
 *
 * The rating chips deliberately carry WESTERN digits in both locales: the
 * card's rating pill renders the numeric average verbatim
 * (`{teacher.averageRating}`), so the filter chips must not introduce a
 * diverging digit convention.
 */

import { TeacherMatchingSort } from "@/frontend/graphql/generated/gql/graphql";
import type { TeacherDirectoryLabels } from "@/shared/locale/types/teacherDirectory";

/** The `TeacherDirectoryLabels` slice holding the minimum-rating choice labels. */
export type RatingLabelKey = keyof Pick<
  TeacherDirectoryLabels,
  "ratingAny" | "ratingFourFivePlus" | "ratingFourPlus" | "ratingThreePlus"
>;

/** The `TeacherDirectoryLabels` slice holding the ordering-choice labels. */
export type SortLabelKey = keyof Pick<TeacherDirectoryLabels, "sortNameAZ" | "sortNewest" | "sortTopRated">;

/**
 * Minimum-rating select options — `null` is the honest "any rating"
 * default (an explicit floor excludes the unrated: NULL never satisfies a
 * SQL `>=` comparison).
 */
export const RATING_FILTER_OPTIONS: readonly (number | null)[] = [null, 3, 4, 4.5];

/**
 * Rating-floor option → `teacherDirectory`-namespace label key and select
 * wire token. `Record` keys must be `string | number | symbol` — a `null`
 * key is illegal — so the "any rating" default (the `null` option) resolves
 * through the LOOKUP FUNCTIONS below instead of a bare element access; the
 * numeric floors keep their plain `Record` tables.
 */
const RATING_LABEL_KEY_BY_FLOOR: Record<number, RatingLabelKey> = {
  3: "ratingThreePlus",
  4: "ratingFourPlus",
  4.5: "ratingFourFivePlus",
};

const RATING_TOKEN_BY_FLOOR: Record<number, string> = {
  3: "3",
  4: "4",
  4.5: "4.5",
};

/** Rating-floor option → label key (`null` = the honest "any rating" default). */
export function ratingLabelKeyOf(option: number | null): RatingLabelKey {
  if (option === null) {
    return "ratingAny";
  }
  return RATING_LABEL_KEY_BY_FLOOR[option] ?? "ratingAny";
}

/**
 * Rating-floor option → select wire token — MUI select values are strings,
 * so the "any rating" default carries an EXPLICIT token (`any`, never the
 * empty string a browser autofill could inject).
 */
export function ratingTokenOf(option: number | null): string {
  if (option === null) {
    return "any";
  }
  return RATING_TOKEN_BY_FLOOR[option] ?? "any";
}

/** Wire token → rating-floor option — the select's fail-closed narrowing (no casts). */
export const RATING_OPTION_BY_TOKEN: Record<string, number | null> = {
  "3": 3,
  "4": 4,
  "4.5": 4.5,
  any: null,
};

/** The ordering (sort) select options, in browse-vocabulary order. */
export const SORT_OPTIONS: readonly TeacherMatchingSort[] = [
  TeacherMatchingSort.RatingDesc,
  TeacherMatchingSort.NameAsc,
  TeacherMatchingSort.Newest,
];

/** Sort member → `teacherDirectory`-namespace label key. */
export const SORT_LABEL_KEY_BY_OPTION: Record<TeacherMatchingSort, SortLabelKey> = {
  [TeacherMatchingSort.RatingDesc]: "sortTopRated",
  [TeacherMatchingSort.NameAsc]: "sortNameAZ",
  [TeacherMatchingSort.Newest]: "sortNewest",
};

/** Wire-value → `TeacherMatchingSort` table backing the sort select's resolver. */
const SORT_BY_TOKEN: Record<string, TeacherMatchingSort> = {
  [TeacherMatchingSort.RatingDesc]: TeacherMatchingSort.RatingDesc,
  [TeacherMatchingSort.NameAsc]: TeacherMatchingSort.NameAsc,
  [TeacherMatchingSort.Newest]: TeacherMatchingSort.Newest,
};

/**
 * Resolves a MUI select wire value onto its `TeacherMatchingSort` member —
 * the fail-closed RESOLVER pattern (the narrowed member is the return
 * value, never a bare boolean): an unknown token resolves `undefined` and
 * the caller commits nothing. A type predicate alone cannot serve here —
 * it narrows TYPES but returns `true`/`false` at runtime, and committing
 * that boolean would corrupt the draft choice set.
 */
export function resolveTeacherMatchingSort(value: string): TeacherMatchingSort | undefined {
  return SORT_BY_TOKEN[value];
}
