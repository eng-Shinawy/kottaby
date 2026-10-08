import { PhoneNumberUtil } from "google-libphonenumber";
import { COUNTRIES, COUNTRY_CODES, type CountryCode } from "@/shared/constants/countries";

/** Phone-enabled country entry: ISO code, dial code, and localized display metadata. */
export type PhoneCountry = {
  readonly code: CountryCode;
  readonly callingCode: string;
  readonly flag: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly suggested: boolean;
};

const util = PhoneNumberUtil.getInstance();

/** Suggested regions surfaced first in the phone-country picker, in display order. */
const SUGGESTED_REGION_ORDER: readonly CountryCode[] = ["EG", "SA", "AE", "US", "GB"];

function isCountryCode(value: string): value is CountryCode {
  return (COUNTRY_CODES as readonly string[]).includes(value);
}

let phoneCountryList: readonly PhoneCountry[] | null = null;
let phoneCountryByCodeIndex: Map<string, PhoneCountry> | null = null;
let phoneCountryByCallingCodeIndex: Map<string, PhoneCountry> | null = null;

function ensurePhoneCountryIndex(): void {
  if (phoneCountryList) {
    return;
  }

  const suggestedSet = new Set<string>(SUGGESTED_REGION_ORDER);
  const entries: PhoneCountry[] = [];
  for (const region of util.getSupportedRegions()) {
    if (!isCountryCode(region)) {
      continue;
    }
    const meta = COUNTRIES[region];
    entries.push({
      code: region,
      callingCode: String(util.getCountryCodeForRegion(region)),
      flag: meta.flag,
      nameEn: meta.en,
      nameAr: meta.ar,
      suggested: suggestedSet.has(region),
    });
  }

  const suggested = SUGGESTED_REGION_ORDER.map(code => entries.find(entry => entry.code === code)).filter(
    (entry): entry is PhoneCountry => entry !== undefined
  );
  const rest = entries
    .filter(entry => !entry.suggested)
    .toSorted((left, right) => left.nameEn.localeCompare(right.nameEn));

  const byCode = new Map<string, PhoneCountry>();
  const byCallingCode = new Map<string, PhoneCountry>();
  for (const entry of entries) {
    byCode.set(entry.code.toUpperCase(), entry);
    const existing = byCallingCode.get(entry.callingCode);
    if (!existing) {
      byCallingCode.set(entry.callingCode, entry);
      continue;
    }
    const canonicalRegion = util.getRegionCodeForCountryCode(Number(entry.callingCode)) ?? undefined;
    if (canonicalRegion && entry.code === canonicalRegion) {
      byCallingCode.set(entry.callingCode, entry);
    }
  }

  phoneCountryList = [...suggested, ...rest];
  phoneCountryByCodeIndex = byCode;
  phoneCountryByCallingCodeIndex = byCallingCode;
}

ensurePhoneCountryIndex();

/** All phone-enabled countries: suggested first, then the rest sorted by English name. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = phoneCountryList ?? [];

/** Lookup a phone country by ISO alpha-2 code (case-insensitive). */
export function getPhoneCountry(code: string): PhoneCountry | undefined {
  ensurePhoneCountryIndex();
  return phoneCountryByCodeIndex?.get(code.toUpperCase());
}

/**
 * Resolve a phone country by exact calling-code match. Shared dial codes (e.g. `1`,
 * `7`, `44`) resolve to libphonenumber's canonical region for that code; otherwise
 * the first-listed region wins.
 */
export function resolvePhoneCountryByCallingCode(callingCode: string): PhoneCountry | undefined {
  ensurePhoneCountryIndex();
  return phoneCountryByCallingCodeIndex?.get(callingCode);
}
