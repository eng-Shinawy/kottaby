/**
 * Canonical ISO 3166-1 alpha-2 country-code validation shared by the
 * frontend register form and the backend registration/admin services —
 * one normalization, type guard, and schema pair so both tiers accept and
 * reject identically.
 *
 * The canonical identifier is exactly two uppercase ASCII letters
 * (`^[A-Z]{2}$`) whose value is also a member of the generated country
 * dataset (`COUNTRY_CODES`). Two validation tiers exist on purpose:
 *
 *  - `countryCodeSchema` is the full gate. It normalizes (trims surrounding
 *    whitespace, then uppercases) BEFORE the dataset membership check, so
 *    `" eg "` parses to `"EG"` while `"EGY"`, `"Egypt"`, `"XX"`, and codes the
 *    dataset curates out all fail with `{ success: false }`. Wire-level
 *    resolvers that validate against a wider ISO list (case-insensitively,
 *    without normalizing) cannot bypass it: this schema is the single
 *    membership + normalization authority for any persisted value.
 *
 *  - `countryCodeShapeSchema` validates only the two-letter shape,
 *    case-insensitively, without consulting the dataset and without
 *    normalizing — for callers that legitimately handle non-member shapes
 *    (the wire's own scalar enforces its full-country list separately).
 *
 * `isValidCountryCode` is the strict, normalization-free counterpart of the
 * schema: it inspects the RAW value, so a `true` answer guarantees the value
 * is byte-identical to a dataset member and the `value is CountryCode`
 * narrowing stays sound. Values that merely normalize into a member
 * (`" eg "`, `"eg"`) must go through `countryCodeSchema`.
 */

import { z } from "zod";
import { COUNTRIES, COUNTRY_CODES, type CountryCode } from "@/shared/constants/countries";
import type { AppLocale } from "@/shared/locale/AppLocale";

/** Anchored canonical shape: exactly two uppercase ASCII letters. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * Any-case two-letter shape for the shape-only schema: the wire-level
 * country contract (two ASCII letters) without dataset membership. Kept
 * separate from {@link COUNTRY_CODE_PATTERN}, which is the strict uppercase
 * canonical form the type guard enforces.
 */
const ISO_SHAPE_ANY_CASE = /^[A-Za-z]{2}$/;

/**
 * Dataset membership as a flat set. A `Set` keeps the lookup off the
 * object prototype chain, so hostile keys like `"__proto__"` can never
 * resolve as members, and it avoids an O(dataset) array scan per check.
 */
const COUNTRY_CODE_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

/**
 * Raw country seeds may carry only ASCII letters plus the whitespace flavors
 * `String.prototype.trim` removes (space, tab, NBSP, …). The gate exists
 * because `.toUpperCase()` maps certain non-ASCII letters onto ASCII
 * targets — "ſ" (U+017F) → "S", "ı" (U+0131) → "I", the fi/fl/st ligatures
 * → "FI"/"FL"/"ST", "ß" (U+00DF) → "SS" — so a homoglyph seed like "ſg"
 * would otherwise silently canonicalize onto the dataset member "SG" and
 * slip past the membership gate (deferred item D-IP-2).
 *
 * Scope is deliberately narrow: legitimate CODE vocabulary (codes themselves
 * plus their trimmable padding) is pure ASCII, so this never rejects a
 * canonicalizable code, while non-ASCII legacy display names ("Curaçao",
 * "Türkiye") are seeds only through the exact-match English-name index,
 * which never case-maps and therefore has no homoglyph bypass to close.
 */
const ASCII_COUNTRY_SEED_PATTERN = /^[A-Za-z\s]*$/;

/**
 * Whether a raw seed is pure ASCII letters + trimmable whitespace — the
 * precondition for trusting the uppercase normalization's output as a
 * code candidate. \s matches exactly the whitespace set trim removes, so
 * every value the schema previously normalized still passes.
 */
function isAsciiCountrySeed(raw: string): boolean {
  return ASCII_COUNTRY_SEED_PATTERN.test(raw);
}

/**
 * Trims surrounding whitespace and uppercases the result: `" eg "` becomes
 * `"EG"`. Pure and locale-independent — the ASCII letters `A`–`Z` are
 * unaffected by locale-specific casing rules.
 */
export function normalizeCountryCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Strict validity check on the RAW value: it must already be an uppercase
 * two-letter code AND a member of the generated dataset. Lowercase or
 * whitespace-padded values fail by design (use `countryCodeSchema` when
 * normalization is wanted — normalizing here would make the
 * `value is CountryCode` narrowing unsound). Returns `false` for every
 * non-string, including `null` and `undefined`, without throwing.
 */
export function isValidCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && COUNTRY_CODE_PATTERN.test(value) && COUNTRY_CODE_SET.has(value);
}

/**
 * Full validation gate: reject non-ASCII (homoglyph) seeds on the RAW shape
 * first — uppercase normalization must never be fed characters it can map
 * onto ASCII letters — then normalize (trim + uppercase), then require
 * membership in the generated dataset. Non-string input fails at the string
 * check — parsing reports `{ success: false }` and never throws.
 *
 * The raw-shape refine (not a post-transform pattern) is what closes the
 * D-IP-2 hole: "ſg" normalizes to "SG", which BOTH the `^[A-Z]{2}$` pattern
 * and the enum accept — only inspecting the raw seed sees the homoglyph.
 */
export const countryCodeSchema: z.ZodType<CountryCode> = z
  .string()
  .refine(isAsciiCountrySeed, {
    message: "Country code must contain only ASCII letters and surrounding whitespace",
  })
  .transform(normalizeCountryCode)
  .pipe(z.enum(COUNTRY_CODES));

/**
 * Shape-only schema: two ASCII letters in any case, no normalization, no
 * dataset membership (the wire scalar enforces its own full-country list
 * separately). Anything else reports `{ success: false }`; parsing never
 * throws.
 */
export const countryCodeShapeSchema: z.ZodType<string> = z.string().regex(ISO_SHAPE_ANY_CASE);

/**
 * Case-insensitive index over the dataset's English display names, used to
 * bridge legacy spellings onto canonical codes: shared `/users` links saved
 * before the directory country filter became a code-bearing selector carry
 * values like `country=Egypt` (the stored display text), which must keep
 * resolving instead of silently dropping the filter.
 */
const COUNTRY_EN_NAME_INDEX: ReadonlyMap<string, CountryCode> = new Map(
  COUNTRY_CODES.map(code => [COUNTRIES[code].en.toLowerCase(), code])
);

/**
 * Resolves a persisted filter seed (URL `country` param) onto a canonical
 * dataset code, accepting every historical spelling the surface has ever
 * written:
 *  - canonical codes — `"EG"`, padded/lowercase variants via normalization
 *    (`" eg "` → `"EG"`) — attempted only for pure-ASCII seeds so a
 *    homoglyph like `"ſg"` cannot uppercase-map onto the member `"SG"`
 *    (D-IP-2),
 *  - legacy display text — `"Egypt"` / `"egypt"` resolve through the
 *    case-insensitive English-name index, which stays open to non-ASCII
 *    dataset names ("Curaçao", "Türkiye") because exact matching cannot be
 *    spoofed by uppercase-mapping homoglyphs,
 * and falls back to `""` (no filter) for anything unresolvable — the same
 * fail-closed default the directory URL contract gives every unknown value.
 */
export function countrySeedToCode(raw: string): CountryCode | "" {
  const normalized = normalizeCountryCode(raw);
  if (normalized === "") {
    return "";
  }
  if (isAsciiCountrySeed(raw) && isValidCountryCode(normalized)) {
    return normalized;
  }
  return COUNTRY_EN_NAME_INDEX.get(normalized.toLowerCase()) ?? "";
}

/**
 * Display label for a persisted country value: a resolvable seed (canonical
 * code, padded/lowercase variant, or legacy English display text) renders as
 * the flag emoji + the ACTIVE LOCALE's dataset name — a single logical
 * string, RTL-safe by construction, matching the directory filter chip and
 * the broadcast history audience column's grammar. Unresolvable free text
 * renders verbatim (fail-open DISPLAY — the read side never rewrites what a
 * legacy row stored; only the write paths canonicalize).
 *
 * Note the asymmetry with {@link countrySeedToCode}: seeds resolve through
 * the English-name index only (Arabic names were never persisted as seeds),
 * but the RESOLVED entry renders in whichever locale the caller passes.
 */
export function countryDisplayLabel(raw: string, locale: AppLocale): string {
  const code = countrySeedToCode(raw);
  return code === "" ? raw : `${COUNTRIES[code].flag} ${COUNTRIES[code][locale]}`;
}
