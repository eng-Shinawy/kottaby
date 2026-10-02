import { readFileSync } from "node:fs";
import { CLDR_AR_TERRITORIES_PATH, CLDR_EN_TERRITORIES_PATH } from "@/scripts/country-data-generator/paths";

/** ISO 3166-1 alpha-2 code with its localized display names and flag emoji. */
export type CountryEntry = {
  readonly code: string;
  readonly en: string;
  readonly ar: string;
  readonly flag: string;
};

/** CLDR locales whose territory names feed the dataset. */
type CldrTerritoryLocale = "ar" | "en";

type CldrTerritoriesData = {
  readonly main: {
    readonly [locale: string]: { readonly localeDisplayNames: { readonly territories: Record<string, string> } };
  };
};

const CLDR_TERRITORIES_PATHS: Record<CldrTerritoryLocale, string> = {
  ar: CLDR_AR_TERRITORIES_PATH,
  en: CLDR_EN_TERRITORIES_PATH,
};

/** Codepoints of the flag emoji source: regional indicator A (U+1F1E6) .. Z (U+1F1FF). */
const REGIONAL_INDICATOR_A = 0x1f1e6;
const LATIN_CAPITAL_A = 0x41;

/**
 * Territories curated out of the dataset, applied as an explicit set (the
 * iana-timezone-generator EXCLUDED_TERRITORY_CODES precedent) instead of
 * ad-hoc filtering:
 * - `EU`, `EZ`, `QO`, `UN`, `ZZ` — CLDR exceptional-reservation region and
 *   grouping codes, not ISO 3166-1 countries.
 * - `XA`, `XB`, `XK` — user-assigned codepoints (CLDR test codes and Kosovo)
 *   with no official ISO 3166-1 alpha-2 assignment.
 * - `IL` — excluded by the repository-wide territory-curation precedent
 *   (the timezone dataset remaps it to `PS`, which stays in this dataset).
 */
const EXCLUDED_COUNTRY_CODES: ReadonlySet<string> = new Set(["EU", "EZ", "QO", "UN", "XA", "XB", "XK", "ZZ", "IL"]);

/** ISO 3166-1 alpha-2 shape — rejects CLDR's numeric M.49 region keys and `-alt-*` variant keys. */
const ISO_ALPHA2_CODE_PATTERN = /^[A-Z]{2}$/;

function isRecordNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Walks a parsed JSON tree down `path`, returning the deepest node when every
 * step lands on a record, or `null` as soon as one does not — the single
 * shape-check workhorse for the CLDR territories payload (replaces the
 * per-level guard-ladder style with a declarative key path).
 */
function recordAtPath(root: unknown, path: readonly string[]): Record<string, unknown> | null {
  let node: unknown = root;
  for (const key of path) {
    if (!isRecordNode(node)) return null;
    node = node[key];
  }
  return isRecordNode(node) ? node : null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecordNode(value) && Object.values(value).every((v): v is string => typeof v === "string");
}

function isCldrTerritoriesData(data: unknown, locale: CldrTerritoryLocale): data is CldrTerritoriesData {
  const territories = recordAtPath(data, ["main", locale, "localeDisplayNames", "territories"]);
  return territories !== null && isStringRecord(territories);
}

function loadCldrTerritories(locale: CldrTerritoryLocale): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(CLDR_TERRITORIES_PATHS[locale], "utf8"));
  if (!isCldrTerritoriesData(parsed, locale)) {
    throw new Error(`Invalid CLDR territories data structure for locale ${locale}`);
  }
  return parsed.main[locale].localeDisplayNames.territories;
}

export function loadCldrArTerritories(): Record<string, string> {
  return loadCldrTerritories("ar");
}

export function loadCldrEnTerritories(): Record<string, string> {
  return loadCldrTerritories("en");
}

/**
 * Derives the flag emoji for an ISO 3166-1 alpha-2 code from codepoint math:
 * each letter maps to its paired regional-indicator symbol (A → U+1F1E6).
 */
export function codeToFlag(code: string): string {
  return code
    .split("")
    .map(letter => String.fromCodePoint(REGIONAL_INDICATOR_A + letter.charCodeAt(0) - LATIN_CAPITAL_A))
    .join("");
}

/**
 * Curates the CLDR English territory table into the committed dataset:
 * keeps only ISO-alpha-2-shaped, non-excluded codes present in BOTH locales,
 * sorted deterministically, with the flag derived from each code.
 */
export function buildCountryDataset(en: Record<string, string>, ar: Record<string, string>): CountryEntry[] {
  return Object.keys(en)
    .filter(code => ISO_ALPHA2_CODE_PATTERN.test(code) && !EXCLUDED_COUNTRY_CODES.has(code))
    .toSorted((a, b) => a.localeCompare(b))
    .map(code => {
      if (!Object.hasOwn(en, code) || !Object.hasOwn(ar, code)) {
        throw new Error(`Missing CLDR territory name for ${code}`);
      }
      return { code, en: en[code], ar: ar[code], flag: codeToFlag(code) };
    });
}
