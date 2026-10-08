import { PhoneNumberUtil } from "google-libphonenumber";
import type { CallingCodeMatch } from "@/shared/lib/phone/types";

type CallingCodeEntry = {
  readonly region: string;
  readonly callingCode: string;
};

const util = PhoneNumberUtil.getInstance();

let callingCodeIndex: CallingCodeEntry[] | null = null;
let exactCallingCodeMap: Map<string, CallingCodeEntry[]> | null = null;
let prefixCallingCodeMap: Map<string, CallingCodeEntry[]> | null = null;
let maxCallingCodeLength = 0;

function ensureCallingCodeIndex(): void {
  if (callingCodeIndex) {
    return;
  }

  const entries: CallingCodeEntry[] = util.getSupportedRegions().map(region => ({
    region,
    callingCode: String(util.getCountryCodeForRegion(region)),
  }));

  entries.sort((left, right) => right.callingCode.length - left.callingCode.length);

  const exactMap = new Map<string, CallingCodeEntry[]>();
  const prefixMap = new Map<string, CallingCodeEntry[]>();
  let maxLen = 0;

  for (const entry of entries) {
    const code = entry.callingCode;
    if (code.length > maxLen) {
      maxLen = code.length;
    }

    let exactList = exactMap.get(code);
    if (!exactList) {
      exactList = [];
      exactMap.set(code, exactList);
    }
    exactList.push(entry);

    for (let len = 1; len <= code.length; len++) {
      const prefix = code.slice(0, len);
      let prefixList = prefixMap.get(prefix);
      if (!prefixList) {
        prefixList = [];
        prefixMap.set(prefix, prefixList);
      }
      prefixList.push(entry);
    }
  }

  callingCodeIndex = entries;
  exactCallingCodeMap = exactMap;
  prefixCallingCodeMap = prefixMap;
  maxCallingCodeLength = maxLen;
}

function getExactCallingCodeMatches(digits: string): readonly CallingCodeEntry[] {
  ensureCallingCodeIndex();
  return exactCallingCodeMap?.get(digits) ?? [];
}

function getPrefixCallingCodeMatches(digits: string): readonly CallingCodeEntry[] {
  ensureCallingCodeIndex();
  return prefixCallingCodeMap?.get(digits) ?? [];
}

/** ISO region → calling code digits (no plus). */
export function getCallingCodeForRegion(region: string): string {
  return String(util.getCountryCodeForRegion(region));
}

function pickPreferredRegionMatch(
  matches: readonly CallingCodeEntry[],
  preferredRegion?: string
): CallingCodeEntry | undefined {
  if (!preferredRegion) {
    return undefined;
  }
  return matches.find(entry => entry.region === preferredRegion);
}

function pickDigitsDefaultMatch(
  matches: readonly CallingCodeEntry[],
  callingCodeDigits?: string
): CallingCodeEntry | undefined {
  if (!callingCodeDigits) {
    return undefined;
  }
  const callingCode = Number(callingCodeDigits);
  if (Number.isNaN(callingCode)) {
    return undefined;
  }
  const defaultRegion = util.getRegionCodeForCountryCode(callingCode) ?? undefined;
  if (!defaultRegion) {
    return undefined;
  }
  return matches.find(entry => entry.region === defaultRegion);
}

function pickPreferredMatch(
  matches: readonly CallingCodeEntry[],
  preferredRegion?: string,
  callingCodeDigits?: string
): CallingCodeEntry | undefined {
  if (matches.length === 0) {
    return undefined;
  }

  const preferred = pickPreferredRegionMatch(matches, preferredRegion);
  if (preferred) {
    return preferred;
  }

  const defaultMatch = pickDigitsDefaultMatch(matches, callingCodeDigits);
  if (defaultMatch) {
    return defaultMatch;
  }

  return matches[0];
}

/** Resolve region from partial or complete calling-code digits. */
export function matchCallingCodeFromDigits(digits: string, preferredRegion?: string): CallingCodeMatch | null {
  if (!digits) {
    return null;
  }

  const exactMatches = getExactCallingCodeMatches(digits);
  if (exactMatches.length > 0) {
    const match = pickPreferredMatch(exactMatches, preferredRegion, digits);
    if (!match) {
      return null;
    }
    return { region: match.region, callingCode: match.callingCode, isComplete: true };
  }

  const prefixMatches = getPrefixCallingCodeMatches(digits);
  if (prefixMatches.length > 0) {
    const match = pickPreferredMatch(prefixMatches, preferredRegion, digits);
    if (!match) {
      return null;
    }
    return { region: match.region, callingCode: match.callingCode, isComplete: false };
  }

  return null;
}

/** True while digits are empty or still a prefix of a known calling code. */
export function isCallingCodePrefixValid(digits: string): boolean {
  if (!digits) {
    return true;
  }
  return getPrefixCallingCodeMatches(digits).length > 0;
}

/** True when digits exactly match a known calling code. */
export function isCallingCodeComplete(digits: string): boolean {
  if (!digits) {
    return false;
  }
  return getExactCallingCodeMatches(digits).length > 0;
}

/** Longest calling-code digit length across all supported regions. */
export function getMaxCallingCodeLength(): number {
  ensureCallingCodeIndex();
  return maxCallingCodeLength;
}

/** Whether another digit can be appended to the current calling-code prefix. */
export function canAppendCallingCodeDigit(currentDigits: string, digit: string): boolean {
  if (!/^\d$/.test(digit) || isCallingCodeComplete(currentDigits)) {
    return false;
  }
  const nextDigits = `${currentDigits}${digit}`;
  return nextDigits.length <= getMaxCallingCodeLength() && isCallingCodePrefixValid(nextDigits);
}
