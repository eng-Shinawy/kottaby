/**
 * Pure presentation math for the student homework page — consumed by
 * `HomeworkContainer.tsx` and unit-tested in `homework.helpers.test.ts`.
 *
 * The summary strip's honest partition: a row is GRADED when EITHER track
 * records a grade, PENDING otherwise (no grade on either track yet). The
 * two buckets are disjoint and exhaustive — `graded + pending === total`
 * by construction, and every bucket renders even when zero (an honest
 * "0" card, never a hidden one).
 *
 * The same partition doubles as the status filter: the strip's stat cards
 * toggle the list between ALL / GRADED / PENDING, so the filter can never
 * disagree with the cards — one predicate, two views.
 */
import type { MyHomeworkQuery_myHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatSurahJuzRef } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";
import { homeworkRowMatchesQuery } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import type { PrintableRow } from "@/frontend/views/shared/print-export/PrintExportDialog";

/** The summary-strip partition over the student's whole homework history. */
export interface HomeworkSummary {
  readonly total: number;
  readonly graded: number;
  readonly pending: number;
}

/** True when the row records a grade on at least one of its two tracks. */
function isGradedRow(row: MyHomeworkQuery_myHomework_items): boolean {
  return (row.jadid?.grade ?? null) !== null || (row.madi?.grade ?? null) !== null;
}

/**
 * Partitions the fetched rows into graded / pending. A row with both
 * tracks null ("none assigned" on the wire) still counts toward the
 * total — the row exists in the history — and lands in PENDING (nothing
 * graded on it yet).
 */
export function computeHomeworkSummary(rows: readonly MyHomeworkQuery_myHomework_items[]): HomeworkSummary {
  const graded = rows.filter(isGradedRow).length;
  return {
    total: rows.length,
    graded,
    pending: rows.length - graded,
  };
}

/**
 * Projects homework rows into the shared print/CSV-export table shape:
 * date · Jadid passage · Madi passage · grades (jadid/madi, only recorded
 * ones, slash-joined). Passages render in the same human form the track
 * blocks use (`formatSurahJuzRef`), never raw wire codes.
 */
export function toPrintableRows(
  rows: readonly MyHomeworkQuery_myHomework_items[],
  formatDate: (iso: string) => string
): readonly PrintableRow[] {
  return rows.map(row => ({
    date: formatDate(row.createdAt),
    col2: row.jadid?.surahJuz == null ? "" : formatSurahJuzRef(row.jadid.surahJuz),
    col3: row.madi?.surahJuz == null ? "" : formatSurahJuzRef(row.madi.surahJuz),
    col4: [row.jadid?.grade, row.madi?.grade]
      .filter(g => g !== null && g !== undefined)
      .map(g => String(g))
      .join("/"),
  }));
}

/** The summary strip's filter states — each card toggles its bucket. */
export type HomeworkStatusFilter = "all" | "graded" | "pending";

/**
 * Filters the list rows to the active summary-strip bucket. The `all`
 * arm returns the input as-is (same array, no copy) and the bucket arms
 * reuse the EXACT partition predicate `computeHomeworkSummary` uses —
 * the cards and the list can never disagree.
 */
export function filterHomeworkByStatus(
  rows: readonly MyHomeworkQuery_myHomework_items[],
  filter: HomeworkStatusFilter
): readonly MyHomeworkQuery_myHomework_items[] {
  if (filter === "all") {
    return rows;
  }
  if (filter === "graded") {
    return rows.filter(isGradedRow);
  }
  return rows.filter(row => !isGradedRow(row));
}

/**
 * Toggles a stat-card click: clicking the active bucket returns to the
 * unfiltered view; clicking another bucket selects it.
 */
export function toggleHomeworkFilter(
  current: HomeworkStatusFilter,
  clicked: HomeworkStatusFilter
): HomeworkStatusFilter {
  if (clicked === "all") {
    return "all";
  }
  return current === clicked ? "all" : clicked;
}

/**
 * The formatted-text match path: the rows render passage refs through
 * `formatSurahJuzRef` (`Juz30` → `Juz 30`, `SurahAlMaidah` →
 * `Surah Al Maidah`), so a query typed against the VISIBLE text must be
 * probed against that rendering too — the raw wire enum carries no space
 * and can never match it. Case-insensitive substring over BOTH tracks.
 */
function rowMatchesFormattedSurahJuz(row: MyHomeworkQuery_myHomework_items, query: string): boolean {
  const q = query.toLowerCase().trim();
  const jadidRef = row.jadid?.surahJuz == null ? "" : formatSurahJuzRef(row.jadid.surahJuz).toLowerCase();
  const madiRef = row.madi?.surahJuz == null ? "" : formatSurahJuzRef(row.madi.surahJuz).toLowerCase();
  return jadidRef.includes(q) || madiRef.includes(q);
}

/**
 * The free-text search over the history: matches the Jadid/Madi passage
 * refs and the locale-rendered assignment date, case-insensitively. A
 * blank (or whitespace-only) query returns the input array UNCHANGED —
 * same reference, no copy, no re-ordering — so the list keeps the API's
 * order whenever no search is active. The matcher vocabulary is the
 * shared `homeworkRowMatchesQuery` (the exact predicate the parent
 * portal's homework tab runs) PLUS one student-surface extension: the
 * rows render passage refs through `formatSurahJuzRef`, so the query is
 * ALSO probed against that formatted rendering of both tracks —
 * searching the exact visible text (`"Juz 30"`, `"Surah Al Maidah"`)
 * matches even though the raw wire enum carries no space. The shared
 * matcher's raw-enum behavior is unchanged; the formatted probe is
 * purely additive before a row is declared a non-match.
 */
export function filterHomeworkByQuery(
  rows: readonly MyHomeworkQuery_myHomework_items[],
  query: string,
  dateMatcher: (row: MyHomeworkQuery_myHomework_items, query: string) => boolean
): readonly MyHomeworkQuery_myHomework_items[] {
  if (query.trim() === "") {
    return rows;
  }
  return rows.filter(
    row => homeworkRowMatchesQuery(row, query, dateMatcher) || rowMatchesFormattedSurahJuz(row, query)
  );
}
