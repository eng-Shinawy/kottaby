/**
 * TeacherMatchingSort enum — the wire sort vocabulary for the student
 * teacher-directory browse (`browseAvailableTeachers`' `sort` argument).
 *
 * Ordering contract (see `docs/teachers/on-demand-matching.md` §2.3): the
 * country tier is ALWAYS the first ORDER BY key — the chosen sort selects
 * only the POST-tier ordering key — and the deterministic `teacher.id DESC`
 * tiebreak is ALWAYS last:
 *  - `RATING_DESC` — the current default: `average_rating DESC NULLS LAST`
 *    (rated before unrated inside a tier; the honest null never becomes a
 *    fabricated zero).
 *  - `NAME_ASC` — `users.full_name ASC` (alphabetical within a tier).
 *  - `NEWEST` — `teacher.id DESC` as the KEY itself (newest row first).
 *
 * There is NO pgEnum backing this vocabulary — it is a pure per-browse
 * transport selector, never a stored column value. Per the Pothos
 * enum-object convention the enum KEYS (`RatingDesc`, `NameAsc`, `Newest`)
 * are the GraphQL value names on the wire while the SCREAMING_CASE string
 * values remain the runtime representation.
 */
export enum TeacherMatchingSort {
  RatingDesc = "RATING_DESC",
  NameAsc = "NAME_ASC",
  Newest = "NEWEST",
}
