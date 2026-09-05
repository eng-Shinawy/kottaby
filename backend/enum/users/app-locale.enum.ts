/**
 * AppLocale enum — mirrors the `app_locale` pgEnum in
 * `backend/db/schema/enums.ts` and the shared locale list in
 * `shared/locale/AppLocale.ts` (`locales = ["ar","en"]`).
 *
 * Three sources, one value set:
 *  - `shared/locale/AppLocale.ts` stays the i18n runtime source of truth
 *    (the `locales` const array + `isAppLocale` guard drive the frontend +
 *    shared locale system);
 *  - the `app_locale` pgEnum is the database-side closed set on
 *    `users.locale`;
 *  - THIS TS enum is the GraphQL-facing mirror (per
 *    `backend/graphql/pothos/AGENTS.md`, Pothos enums MUST be backed by a
 *    real TS enum) — the parity test in this directory pins all three
 *    byte-identical, so a new locale can never land in one source only.
 */
export enum AppLocale {
  Ar = "ar",
  En = "en",
}

/**
 * Maps a runtime locale string (from a `users.locale` pgEnum row or a
 * transport payload) to the `AppLocale` TS enum. Returns `null` if the value
 * is not a recognized locale — callers should treat this as "unset" rather
 * than crashing.
 *
 * The string values mirror the enum members exactly (`"ar"`, `"en"`), but
 * TypeScript does not allow assigning a `string` to a nominal enum without an
 * explicit conversion. This helper replaces the unsafe `as AppLocale` cast
 * pattern with an exhaustive, type-safe switch (the `toGender` precedent).
 */
export function toAppLocale(locale: string): AppLocale | null {
  switch (locale) {
    case "ar":
      return AppLocale.Ar;
    case "en":
      return AppLocale.En;
    default:
      return null;
  }
}
