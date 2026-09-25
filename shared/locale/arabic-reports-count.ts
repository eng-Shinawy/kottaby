/**
 * Arabic session-report count pluralizer — the shared count vocabulary of
 * the report-history surfaces that pluralize the same "تقرير" noun: the
 * parent-monitoring portal tab and the admin academic-tracking drill-down.
 *
 * Arabic count grammar has five written classes (0 / 1 / 2 / 3–10 / 11+)
 * and the numerals render through `toLocaleString("ar")` so every class
 * keeps the app's Arabic-Indic digit posture. Both consuming namespaces
 * declare `reportsCount: (count: number) => string`; this helper is the
 * single implementation referenced by both `ar` leaves, so the plural
 * classes can never drift apart between the two surfaces (the en leaves
 * keep their own inline pluralizers — English plural grammar is a different
 * token shape).
 */
export function formatArabicReportsCount(count: number): string {
  if (count === 0) return "لا توجد تقارير";
  if (count === 1) return "تقرير واحد";
  if (count === 2) return "تقريران";
  if (count <= 10) return `${count.toLocaleString("ar")} تقارير`;
  return `${count.toLocaleString("ar")} تقريراً`;
}
