/**
 * Arabic cooldown-day count pluralizer — the shared count vocabulary of
 * the recent-activity timeline captions that render a cooldown length
 * (extension captions and the rejecting-override suffix).
 *
 * Arabic count grammar has five written classes (0 / 1 / 2 / 3–10 / 11+)
 * and the numerals render through `toLocaleString("ar")` so every class
 * keeps the app's Arabic-Indic digit posture. Both consuming leaves declare
 * their caption leaves as `(days: number) => string`; this helper is the
 * single counted-noun implementation referenced by the `ar` leaves, so the
 * plural classes can never drift apart between the two captions (the `en`
 * leaves keep their own inline pluralizer — English plural grammar is a
 * different token shape).
 */
export function formatArabicCooldownDays(count: number): string {
  if (count === 0) return "صفر يوم";
  if (count === 1) return "يوم واحد";
  if (count === 2) return "يومين";
  if (count <= 10) return `${count.toLocaleString("ar")} أيام`;
  return `${count.toLocaleString("ar")} يومًا`;
}
