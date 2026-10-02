/**
 * Country dataset label resolution — the ONE place that turns a wire country
 * code + server-composed label into the LIVE-locale display label through the
 * shared dataset (`COUNTRIES`).
 *
 * Why this exists as its own module: the Apollo cache SURVIVES the
 * LocaleSwitcher's refresh, so a server-localized label reads STALE after a
 * locale toggle (the stale-مصر-after-EN-toggle class of bug). The dataset is
 * already in the client bundle and is the SAME source the server composes
 * from, so resolving client-side under the live locale renders both locales
 * correctly with zero extra round-trips. The server label is the FALLBACK for
 * an out-of-vocabulary code — it is never silently dropped.
 *
 * Consumers: the directory's country facet chips (`CountryBreakdownRow`) and
 * the admin dashboard's country distribution panel — one resolution point so
 * both surfaces can never disagree about a label.
 */

import { COUNTRIES, type CountryCode } from "@/shared/constants/countries";
import type { AppLocale } from "@/shared/locale/AppLocale";

/** Type guard: whether a wire code is in the shared dataset's vocabulary (module-private — the dataset helpers are the public surface). */
function isCountryCode(code: string): code is CountryCode {
  return code in COUNTRIES;
}

/** The live-locale label for a dataset code; `fallback` for out-of-vocabulary codes. */
export function countryDatasetLabel(code: string, fallback: string, locale: AppLocale): string {
  return isCountryCode(code) ? COUNTRIES[code][locale] : fallback;
}
