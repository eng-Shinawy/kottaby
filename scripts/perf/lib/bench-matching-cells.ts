/**
 * The benchmark matrix: the deterministic cross-product of teacher-pool
 * volumes, browse sorts, and filter variants, plus the per-cell browse
 * input each cell submits to the real matching service.
 *
 * Cell identity is stable and self-describing:
 * `matching-<volume>-<sortToken>-<variantToken>` (e.g.
 * `matching-100-rating-desc-plain`). The gate-volume cells are exactly the
 * cells whose volume equals `GATE_VOLUME`.
 *
 * Caller discipline: every variant that must stay filter-free runs as the
 * no-filter caller (an Arabic-baseline or language-absent student, so the
 * service applies NO language hard filter); the subject+language variant
 * runs as the language caller (a non-Arabic-baseline student, so the
 * service applies the caller's own fluency filter). The orchestration
 * resolves both callers from the seeded identities before the matrix runs.
 */

import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import type { TeacherMatchingSubmitInput } from "@/backend/types";

/** The launch-regime volume: gate cells are exactly the cells at this volume. */
export const GATE_VOLUME = 100;

/** Default browse page (the GraphQL wire defaults for the student browse). */
export const BENCH_PAGE = 1;
export const BENCH_PAGE_SIZE = 25;

/** Locale every bench browse resolves its denial copy through. */
export const BENCH_LOCALE = "en";

/**
 * The name-search substring. Seeded teacher display names are
 * `<prefix>Teacher <six-digit-index>`, so this matches exactly the first
 * hundred seeded indexes — a deterministic, run-id-independent subset at
 * every volume.
 */
export const NAME_SEARCH_TOKEN = "Teacher 000";

/** The honest rating floor: an SQL `>=` that excludes the unrated (~10%). */
export const MIN_RATING_FLOOR = 4;

/** Which seeded caller identity a cell browses as. */
export type BenchCallerKind = "no-filter" | "language";

/** One matrix cell: its identity, its volume window, and its browse input. */
export interface BenchCellSpec {
  readonly id: string;
  readonly volume: number;
  readonly sort: TeacherMatchingSort;
  readonly sortToken: string;
  readonly variantToken: string;
  readonly caller: BenchCallerKind;
  readonly input: TeacherMatchingSubmitInput;
}

/** Sort vocabulary in canonical (enum-declaration) order with stable id tokens. */
const SORT_TOKENS: readonly { readonly sort: TeacherMatchingSort; readonly token: string }[] = [
  { sort: TeacherMatchingSort.RatingDesc, token: "rating-desc" },
  { sort: TeacherMatchingSort.NameAsc, token: "name-asc" },
  { sort: TeacherMatchingSort.Newest, token: "newest" },
];

/** The default sort (first canonical member) used by the self-check mini-run. */
const DEFAULT_SORT: { readonly sort: TeacherMatchingSort; readonly token: string } = {
  sort: TeacherMatchingSort.RatingDesc,
  token: "rating-desc",
};

/** Filter-variant vocabulary in canonical order with stable id tokens. */
const VARIANT_SPECS: readonly {
  readonly token: string;
  readonly caller: BenchCallerKind;
  readonly input: Omit<TeacherMatchingSubmitInput, "sort">;
}[] = [
  {
    token: "plain",
    caller: "no-filter",
    input: {
      recitation: null,
      intent: null,
      page: BENCH_PAGE,
      pageSize: BENCH_PAGE_SIZE,
      search: null,
      minRating: null,
    },
  },
  {
    token: "subject-language",
    caller: "language",
    input: {
      recitation: null,
      intent: SessionIntent.Hifz,
      page: BENCH_PAGE,
      pageSize: BENCH_PAGE_SIZE,
      search: null,
      minRating: null,
    },
  },
  {
    token: "name-search",
    caller: "no-filter",
    input: {
      recitation: null,
      intent: null,
      page: BENCH_PAGE,
      pageSize: BENCH_PAGE_SIZE,
      search: NAME_SEARCH_TOKEN,
      minRating: null,
    },
  },
  {
    token: "min-rating",
    caller: "no-filter",
    input: {
      recitation: null,
      intent: null,
      page: BENCH_PAGE,
      pageSize: BENCH_PAGE_SIZE,
      search: null,
      minRating: MIN_RATING_FLOOR,
    },
  },
];

/** Builds the stable cell id for one volume/sort/variant triple. */
export function buildCellId(volume: number, sortToken: string, variantToken: string): string {
  return `matching-${volume}-${sortToken}-${variantToken}`;
}

function buildCell(
  volume: number,
  sort: { sort: TeacherMatchingSort; token: string },
  variant: (typeof VARIANT_SPECS)[number]
): BenchCellSpec {
  return {
    id: buildCellId(volume, sort.token, variant.token),
    volume,
    sort: sort.sort,
    sortToken: sort.token,
    variantToken: variant.token,
    caller: variant.caller,
    input: { ...variant.input, sort: sort.sort },
  };
}

/**
 * Enumerates the full matrix for the given volumes (descending execution
 * order): every volume × every sort × every variant, deterministically.
 */
export function enumerateCells(volumes: readonly number[]): BenchCellSpec[] {
  const cells: BenchCellSpec[] = [];
  for (const volume of volumes) {
    for (const sort of SORT_TOKENS) {
      for (const variant of VARIANT_SPECS) {
        cells.push(buildCell(volume, sort, variant));
      }
    }
  }
  return cells;
}

/** Number of cells one volume contributes (sorts × variants). */
export function cellsPerVolume(): number {
  return SORT_TOKENS.length * VARIANT_SPECS.length;
}

/**
 * The `--self-check` mini-run cell: one volume (the live eligible census is
 * used verbatim — no window narrowing), the default sort, the plain
 * variant. The runner overrides the sample counts for the mini-run.
 */
export function buildSelfCheckCell(volume: number): BenchCellSpec {
  return buildCell(volume, DEFAULT_SORT, VARIANT_SPECS[0]);
}
