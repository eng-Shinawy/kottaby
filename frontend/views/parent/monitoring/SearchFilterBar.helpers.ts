export interface SearchFilterState {
  readonly query: string;
  readonly ratingFilter: number | null;
  readonly sort: SortMode;
}

export type SortMode = "dateDesc" | "dateAsc" | "ratingDesc" | "ratingAsc";

export const DEFAULT_SORT: SortMode = "dateDesc";

interface FilterableReportRow {
  readonly teacherNotes: string | null;
  readonly studentRatingByTeacher: number | null;
  readonly sessionStartedAt: string | null;
  readonly createdAt: string;
}

export function filterReportRows<T extends FilterableReportRow>(
  rows: readonly T[],
  state: SearchFilterState,
  dateMatcher: (row: T, query: string) => boolean
): readonly T[] {
  const q = state.query.toLowerCase().trim();
  const filtered: T[] = [];
  for (const row of rows) {
    if (state.ratingFilter !== null && row.studentRatingByTeacher !== state.ratingFilter) {
      continue;
    }
    if (q !== "") {
      const notesMatch = row.teacherNotes?.toLowerCase().includes(q);
      const dateMatch = dateMatcher(row, q);
      if (!notesMatch && !dateMatch) {
        continue;
      }
    }
    filtered.push(row);
  }
  return sortRows(filtered, state.sort);
}

interface FilterableHomeworkRow {
  readonly createdAt: string;
  readonly jadid: {
    readonly surahJuz: string | null;
    readonly fromAyah: number | null;
    readonly toAyah: number | null;
    readonly grade: number | null;
  } | null;
  readonly madi: {
    readonly surahJuz: string | null;
    readonly fromAyah: number | null;
    readonly toAyah: number | null;
    readonly grade: number | null;
  } | null;
}

export type { FilterableHomeworkRow };

/**
 * Does ONE homework row match the free-text query? A blank query matches
 * everything (pure passthrough); otherwise the Jadid/Madi passage refs and
 * the caller-owned date rendering are probed case-insensitively. Extracted
 * so consumers that keep a fixed list order (the student homework history)
 * can reuse the EXACT matching vocabulary without inheriting this module's
 * sort modes.
 */
export function homeworkRowMatchesQuery<T extends FilterableHomeworkRow>(
  row: T,
  query: string,
  dateMatcher: (row: T, query: string) => boolean
): boolean {
  const q = query.toLowerCase().trim();
  if (q === "") {
    return true;
  }
  const jadiz = row.jadid?.surahJuz?.toLowerCase() ?? "";
  const madiz = row.madi?.surahJuz?.toLowerCase() ?? "";
  const dateMatch = dateMatcher(row, q);
  return jadiz.includes(q) || madiz.includes(q) || dateMatch;
}

export function filterHomeworkRows<T extends FilterableHomeworkRow>(
  rows: readonly T[],
  state: SearchFilterState,
  dateMatcher: (row: T, query: string) => boolean
): readonly T[] {
  const filtered: T[] = [];
  for (const row of rows) {
    if (homeworkRowMatchesQuery(row, state.query, dateMatcher)) {
      filtered.push(row);
    }
  }
  return sortRows(filtered, state.sort);
}

function sortRows<
  T extends {
    readonly sessionStartedAt?: string | null;
    readonly createdAt: string;
    readonly studentRatingByTeacher?: number | null;
    readonly jadid?: { readonly grade: number | null } | null;
    readonly madi?: { readonly grade: number | null } | null;
  },
>(rows: readonly T[], mode: SortMode): readonly T[] {
  const sorted = [...rows];
  if (mode === "dateDesc") {
    sorted.sort((a, b) => compareDates(b, a));
  } else if (mode === "dateAsc") {
    sorted.sort((a, b) => compareDates(a, b));
  } else if (mode === "ratingDesc") {
    sorted.sort((a, b) => ratingValue(b) - ratingValue(a));
  } else {
    sorted.sort((a, b) => ratingValue(a) - ratingValue(b));
  }
  return sorted;
}

function compareDates(
  a: { readonly sessionStartedAt?: string | null; readonly createdAt: string },
  b: { readonly sessionStartedAt?: string | null; readonly createdAt: string }
): number {
  const aDate = a.sessionStartedAt ?? a.createdAt;
  const bDate = b.sessionStartedAt ?? b.createdAt;
  if (aDate < bDate) {
    return -1;
  }
  if (aDate > bDate) {
    return 1;
  }
  return 0;
}

function ratingValue(row: {
  readonly studentRatingByTeacher?: number | null;
  readonly jadid?: { readonly grade: number | null } | null;
  readonly madi?: { readonly grade: number | null } | null;
}): number {
  if (row.studentRatingByTeacher !== null && row.studentRatingByTeacher !== undefined) {
    return row.studentRatingByTeacher;
  }
  const jadidGrade = row.jadid?.grade;
  const madiGrade = row.madi?.grade;
  if (jadidGrade !== null && jadidGrade !== undefined) {
    return jadidGrade;
  }
  if (madiGrade !== null && madiGrade !== undefined) {
    return madiGrade;
  }
  return 0;
}
