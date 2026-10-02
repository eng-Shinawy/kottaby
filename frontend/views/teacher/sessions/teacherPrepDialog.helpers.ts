/**
 * Pure helpers for the teacher preparation dialog — the read-only
 * pre-session glance a teacher opens from a scheduled session row before
 * starting it (curriculum-position card + previous-homework list). Six
 * responsibilities, all client-side and pure (NO DB, NO network, NO
 * React, NO translations):
 *  1. `resolvePrepSection(progress)` — folds the student-progress payload
 *     into the dialog's two-state view model: the diagnostic first-session
 *     banner or the positioned curriculum card.
 *  2. `resolvePrepHomeworkRows(items)` — shapes the homework-history rows
 *     into the newest-first jadid/madi display model.
 *  3. `resolveHiddenHomeworkCount(totalCount, shown)` — the "+N more"
 *     arithmetic against the envelope's honest total.
 *  4. `shouldOfferPrep(session)` — the Prepare-affordance gate for the
 *     session row's action matrix (scheduled tajweed rows only).
 *  5. `secondaryTextSx(theme)` — the quiet secondary-copy tone the prep
 *     sections' meta lines share (one tone across the progress card and
 *     the homework list).
 *  6. `formatPrepAyahRun(fromAyah, toAyah)` — the ayah-run shaping for a
 *     track's bidi-isolated range (one-sided hostile legs degrade to the
 *     lone leg, never a dangling dash).
 *
 * Honesty rules the helpers enforce: `hasProgress` is the ONLY signal for
 * the first-session state — a positioned card is impossible without it,
 * and a payload whose lesson fields are populated while the flag is false
 * (or whose positioned fields arrive broken) folds to the honest
 * presentation, never a fabricated lesson. Null grades ride as null (the
 * rendering decides the not-yet-graded presentation); a row with no
 * assignment span at all is still kept (it renders the no-assignment
 * state). The server is the authority on every value — these helpers only
 * shape and fold, never invent.
 */

import type { Theme } from "@mui/material/styles";
import {
  type MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionIntent,
  SessionStatus,
  type StudentHomeworkHistoryQuery_studentHomeworkHistory_items,
  type StudentProgressQuery_studentProgress,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * The preparation dialog's progress view model. `firstSession` renders
 * the localized diagnostic banner (and suppresses the curriculum card
 * entirely); `positioned` renders the current-lesson card. The
 * discriminator is deliberately single-sourced: only
 * {@link resolvePrepSection} constructs these.
 */
export type PrepProgressSection =
  | { readonly kind: "firstSession" }
  | {
      readonly kind: "positioned";
      readonly lessonTitle: string;
      readonly position: number;
      readonly totalLessons: number;
      readonly completionPercent: number;
      readonly planTitle: string | null;
      readonly isOnFinalLesson: boolean;
    };

/** One previous-homework display row (id + owning session + the two
 *  track spans; the tracks' field order mirrors the history payload). */
export interface PrepHomeworkRow {
  readonly id: string;
  readonly sessionId: string;
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

/**
 * Intent gate for the Prepare affordance — a `Record` lookup over the
 * row's own `intent` value (never a string-literal enum comparison):
 * preparation is a tajweed-curriculum glance, so only tajweed sessions
 * admit the affordance.
 */
export const PREP_SESSION_INTENTS: Readonly<Record<SessionIntent, boolean>> = {
  [SessionIntent.Tajweed]: true,
  [SessionIntent.Hifz]: false,
  [SessionIntent.Evaluation]: false,
};

/** Hostile-payload guard: a positive safe integer (1-based positions and
 *  non-empty lesson totals share the shape). */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Hostile-payload guard: an integer percentage inside the honest 0–100
 *  band — anything outside the band would render a fabricated ratio. */
function isPercentInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

/** Hostile-payload guard: a real boolean flag. */
function isBooleanFlag(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Folds the student-progress payload into the dialog's two-state view
 * model. The honesty rule is absolute: `hasProgress: false` yields the
 * first-session state — even when plan/lesson fields ride along (an
 * active plan without a settled pointer row is a real server state, and
 * a broken payload must never upgrade into a curriculum position either).
 * With the flag true, the positioned card carries the payload verbatim;
 * if any positioned-critical field is broken (a missing or blank title,
 * a position outside the 1-based band, a zero lesson total, a percent
 * outside 0–100, a missing final-lesson flag — including the
 * position-less re-anchor shape), the fold lands on the first-session
 * state too: no number is ever invented to fill a gap. A blank title
 * counts as broken — an empty lesson name is a curriculum pointer that
 * names nothing, and the honest presentation for a pointer with no name
 * is the diagnostic first-session state.
 */
export function resolvePrepSection(progress: StudentProgressQuery_studentProgress): PrepProgressSection {
  if (!progress.hasProgress) {
    return { kind: "firstSession" };
  }
  if (
    typeof progress.currentLessonTitle !== "string" ||
    progress.currentLessonTitle.trim() === "" ||
    !isPositiveInteger(progress.currentLessonPosition) ||
    !isPositiveInteger(progress.totalLessons) ||
    !isPercentInteger(progress.completionPercent) ||
    !isBooleanFlag(progress.isOnFinalLesson)
  ) {
    return { kind: "firstSession" };
  }
  return {
    kind: "positioned",
    lessonTitle: progress.currentLessonTitle,
    position: progress.currentLessonPosition,
    totalLessons: progress.totalLessons,
    completionPercent: progress.completionPercent,
    planTitle: typeof progress.planTitle === "string" ? progress.planTitle : null,
    isOnFinalLesson: progress.isOnFinalLesson,
  };
}

/**
 * Shapes the homework-history page's items (newest-first per the server —
 * the order rides untouched) into the display rows: the current track
 * becomes the jadid span, the revision track the madi span. A track with
 * no assignment at all folds to a null span; a track assigned but not yet
 * graded keeps its span with the grade still null (the rendering decides
 * the not-yet-graded presentation — never a fabricated zero). A row with
 * BOTH spans null is kept so it can render the no-assignment state.
 */
export function resolvePrepHomeworkRows(
  items: readonly StudentHomeworkHistoryQuery_studentHomeworkHistory_items[]
): PrepHomeworkRow[] {
  return items.map(item => ({
    id: item.id,
    sessionId: String(item.sessionId),
    jadid: toPrepSpan(item.currentSurahJuz, item.currentFromAyah, item.currentToAyah, item.currentGrade),
    madi: toPrepSpan(item.revisionSurahJuz, item.revisionFromAyah, item.revisionToAyah, item.revisionGrade),
  }));
}

/** Folds one track's four nullable legs into its display span — null only
 *  when the whole track is absent (the no-assignment state for that
 *  track); any present leg keeps the span with the remaining legs null. */
function toPrepSpan(
  surahJuz: string | null,
  fromAyah: number | null,
  toAyah: number | null,
  grade: number | null
): PrepHomeworkRow["jadid"] {
  if (surahJuz === null && fromAyah === null && toAyah === null && grade === null) {
    return null;
  }
  return { surahJuz, fromAyah, toAyah, grade };
}

/**
 * Shapes one track's ayah legs into the display run the homework list
 * renders inside its `dir="ltr"` isolate. The full `from–to` range
 * renders only when BOTH legs are finite numbers — a hostile/legacy
 * payload with exactly one leg present degrades to that leg alone (a
 * dangling dash would announce a bound the payload never carried), and a
 * leg-less span (e.g. a grade-only track) keeps the per-track "—"
 * placeholder. The both-legs shape is byte-identical to the interpolation
 * it replaces.
 */
export function formatPrepAyahRun(fromAyah: number | null, toAyah: number | null): string {
  const from = fromAyah !== null && Number.isFinite(fromAyah) ? fromAyah : null;
  const to = toAyah !== null && Number.isFinite(toAyah) ? toAyah : null;
  if (from !== null && to !== null) {
    return `${from}–${to}`;
  }
  if (from !== null) {
    return String(from);
  }
  if (to !== null) {
    return String(to);
  }
  return "—";
}

/**
 * The "+N more" arithmetic for the homework glance: how many graded
 * history rows exist beyond the first page (`totalCount` is the
 * envelope's honest total, `shown` the rows rendered). Anything
 * non-finite folds to zero — a broken envelope must never render a
 * "NaN more" line — and the floor at zero absorbs a shown count that
 * exceeds the total.
 */
export function resolveHiddenHomeworkCount(totalCount: number, shown: number): number {
  if (!Number.isFinite(totalCount) || !Number.isFinite(shown)) {
    return 0;
  }
  return Math.max(0, totalCount - shown);
}

/**
 * The Prepare-affordance gate for a session row: the affordance exists
 * only for rows still awaiting their first start (`Scheduled`) whose
 * intent the gate record admits (tajweed). The null-guard precedes the
 * record index — an intent-less row is a real server state, and indexing
 * the record with a missing key would be a lookup lie, so it folds to
 * `false` with the rest of the non-scheduled rows.
 */
export function shouldOfferPrep(session: MyTeacherSessionsQuery_myTeacherSessions_items): boolean {
  if (session.status !== SessionStatus.Scheduled) {
    return false;
  }
  if (session.intent === null) {
    return false;
  }
  return PREP_SESSION_INTENTS[session.intent];
}

/** Quiet secondary-copy tone shared by the prep sections' meta lines —
 *  one tone across the progress card and the homework list. */
export const secondaryTextSx = (theme: Theme) => ({ color: theme.palette.text.secondary });
