/**
 * Locale-aware timestamp formatting for frontend consumers. This is the
 * FRONTEND half of the project's shared date-format util; `date-fns` stays
 * out of the stack.
 *
 * Current consumer: `ApplicantStatusCard` expands the ICU `{cooldownUntil}`
 * placeholder of `applicant.cooldownExpiryLine` with the stamp produced here.
 *
 * Client/server CONSISTENCY contract: the option set
 * and locale-tag resolution below MIRROR the module-private
 * `COOLDOWN_FORMATTERS` table in
 * `backend/services/teachers/applicant-lifecycle.service.ts` exactly —
 *
 *  - locale tag resolution mirrors `shared/locale/server.ts` / the service's
 *    own `resolveLocaleTag`: ONLY exact `"en"` selects English, every other
 *    input falls back to `"ar"` (the default locale), so a formatted stamp
 *    always lands in the language of the message it is embedded into;
 *  - fixed options `{ timeZone: "UTC", year: "numeric", month: "2-digit",
 *    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }`
 *    are byte-deterministic across environments (host TZ cannot drift into
 *    renders/tests) and match the server-side cooldown stamps field-for-field.
 *
 * For the same instant + locale, `formatApplicantDate` therefore produces a
 * stamp byte-identical to the service-side `formatCooldownExpiry`.
 */
const APPLICANT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

/**
 * Resolves an app locale string to an Intl locale tag using the SAME
 * fallback rule as the backend lifecycle service (`resolveLocaleTag`):
 * only exact `"en"` selects English — anything else renders Arabic.
 */
function resolveLocaleTag(locale: string): "ar" | "en" {
  return locale === "en" ? "en" : "ar";
}

/**
 * Formats an ISO-8601 instant into a deterministic, locale-aware timestamp
 * string (UTC components; 24-hour clock; Arabic-Indic digits under `ar`,
 * Latin digits under `en`).
 *
 * @param iso - ISO-8601 instant (GraphQL exposes applicant timestamps as
 *   nullable ISO-8601 UTC strings — pass only non-null values).
 * @param locale - app locale ("ar" | "en"; other inputs resolve to "ar").
 * @returns The formatted date+time stamp produced by
 *   `Intl.DateTimeFormat` with the fixed option set documented above.
 */
export function formatApplicantDate(iso: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(resolveLocaleTag(locale), APPLICANT_DATE_OPTIONS);
  return formatter.format(new Date(iso));
}

/**
 * Builds the locale's short numeric date mask (e.g. `02/27/2023` for en,
 * `٢٧/٠٢/٢٠٢٣` for ar — day-first with Arabic-Indic digits) from a fixed
 * sample date. Used as the visible placeholder for native `<input
 * type="date">` fields: Chromium renders its internal `mm/dd/yyyy` mask from
 * the BROWSER language and ignores the input's `lang`, so an RTL Arabic UI
 * showed an LTR English mask (QA finding). The mask text is displayed by the
 * field while the input is empty; direction marks that some ICU builds
 * inject around number runs are stripped.
 */
export function shortNumericDateMask(locale: string): string {
  const parts = new Intl.DateTimeFormat(resolveLocaleTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.UTC(2023, 1, 27)));
  return parts
    .filter(part => part.type !== "literal")
    .map(part => part.value)
    .join("/")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "");
}
