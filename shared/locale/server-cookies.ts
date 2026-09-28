import { cookies } from "next/headers";
import { type AppLocale, defaultLocale, isAppLocale, LOCALE_COOKIE_NAME } from "@/shared/locale/AppLocale";

/**
 * Re-exported from the canonical client-safe home (`AppLocale.ts`) so server
 * importers keep their import path while client modules import the literal
 * directly from `AppLocale` (avoiding the `next/headers` server-only graph).
 */
export { LOCALE_COOKIE_NAME };

export async function getLocaleFromCookie(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (cookieValue && isAppLocale(cookieValue)) {
    return cookieValue;
  }
  return defaultLocale;
}
