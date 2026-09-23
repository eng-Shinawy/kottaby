/**
 * Finances console URL state — the pure (parse) half of the shareable
 * tab/teacher deep-link contract for `/admin/finances`.
 *
 * The container owns the URL write side (the `router.replace` mirror
 * effect); this module is the fail-safe parser half:
 *  - `parseFinancesUrlTab` reads the `tab` param — ANY unknown/absent
 *    value resolves to the default payments tab;
 *  - `parseTeacherIdParam` reads the `teacherId` deep-link param — a
 *    junk/negative/non-safe token falls back to `null` (the unpicked
 *    picker state), so a hand-edited link can never poison the surface.
 *
 * Non-component module on purpose: the container stays within
 * `react-refresh/only-export-components` by sourcing the parsers from
 * here.
 */

/** The three tabs of the finances console (values double as MUI `Tab` values). */
export type FinancesTab = "payments" | "withdrawals" | "wallet";

/** Parses the `tab` param — ANY unknown/absent value resolves to payments. */
export function parseFinancesUrlTab(searchParams: { get(name: string): string | null }): FinancesTab {
  const raw = searchParams.get("tab");
  if (raw === "withdrawals" || raw === "wallet") {
    return raw;
  }
  return "payments";
}

/** Parses the `teacherId` deep-link param — junk/negative → `null`. */
export function parseTeacherIdParam(searchParams: { get(name: string): string | null }): number | null {
  const raw = searchParams.get("teacherId");
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}
