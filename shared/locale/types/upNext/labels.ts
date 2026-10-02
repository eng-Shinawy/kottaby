/**
 * UpNext namespace labels — the role dashboards' "What's next" glance
 * cards: the student card (`/student/dashboard`, upcoming sessions +
 * pending homework), the teacher card (`/teacher/dashboard`, upcoming
 * sessions + the scheduled tail), and the parent card
 * (`/parent/dashboard`, one per-child group of upcoming sessions), each
 * surfacing a small discoverability window with direct links into the
 * owning surfaces.
 *
 * Used by:
 *  - `frontend/views/students/dashboard/StudentUpNextCard.tsx`
 *  - `frontend/views/teachers/dashboard/TeacherUpNextCard.tsx`
 *  - `frontend/views/parent/dashboard/ParentUpNextCard.tsx`
 *    (all via `useAppTranslation(UpNext)` with property access).
 *
 * The cards are DISCOVERABILITY affordances — they render at most a small
 * window of upcoming sessions and never own lifecycle actions; every row
 * deep-links into the surface that owns the data (`/student/sessions`,
 * `/teacher/sessions`, `/homework`, `/parent/children/:id`).
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `upNext-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface UpNextLabels {
  /** Card heading. */
  readonly upNextTitle: string;
  /** Upcoming-sessions block heading. */
  readonly upcomingHeading: string;
  /** Honest empty line — the student has no scheduled sessions. */
  readonly upcomingEmpty: string;
  /** Honest empty line — the teacher has no scheduled sessions. */
  readonly upcomingEmptyTeacher: string;
  /** Honest empty line — a linked child has no scheduled sessions (parent card, per-child group). */
  readonly upcomingEmptyChild: string;
  /** Honest empty line — the parent has no linked children yet (parent card, whole-card arm). */
  readonly upcomingEmptyParentNoChildren: string;
  /** Inline affordance from the parent card's empty arm into the link-my-child surface. */
  readonly linkChildCta: string;
  /** Mini-row session reference — `{id}` session number. */
  readonly sessionLine: (id: number) => string;
  /** Mini-row meta prefix before the locale-formatted booking date. */
  readonly bookedPrefix: string;
  /** Inline affordance from the empty line into the sessions surface. */
  readonly sessionsCta: string;
  /** Homework block heading. */
  readonly homeworkHeading: string;
  /** Homework row line — localized plural, `{count}` awaiting grade. */
  readonly homeworkPendingLine: (count: number) => string;
  /** Homework row line — nothing awaiting grade (honest zero). */
  readonly homeworkAllGraded: string;
  /** Truncated-window footer line — localized plural, `{count}` rows beyond the glance window. */
  readonly scheduledMoreLine: (count: number) => string;
  /** Loading region aria-label (skeleton state). */
  readonly loadingLabel: string;
  /** Error-state body (query failure; retry copy comes from `Common`). */
  readonly errorBody: string;
}
