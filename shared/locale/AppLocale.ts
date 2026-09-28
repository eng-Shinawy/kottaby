export const locales = ["ar", "en"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "ar";

export function isAppLocale(value: string): value is AppLocale {
  return (locales as readonly string[]).includes(value);
}

/**
 * Canonical name of the locale-preference cookie. Lives in THIS module (not
 * `server-cookies.ts`) so client modules (e.g. the Apollo locale link, which
 * reads `document.cookie` at init) can reference the literal without pulling
 * `next/headers` server-only code into the client bundle. The server module
 * re-exports this constant — one canonical definition, two import surfaces.
 */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
