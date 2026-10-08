import { PhoneNumberFormat, PhoneNumberUtil } from "google-libphonenumber";
import { isCallingCodeComplete, matchCallingCodeFromDigits } from "@/shared/lib/phone/calling-code";
import type { ParsePhoneResult } from "@/shared/lib/phone/types";

const util = PhoneNumberUtil.getInstance();

export function buildE164FromParts(prefixDigits: string, nationalDigits: string): string | null {
  if (!prefixDigits || !nationalDigits) {
    return null;
  }
  return parsePhoneToE164(`+${prefixDigits}${nationalDigits}`).e164;
}

export function parsePhoneToE164(input: string, defaultRegion?: string): ParsePhoneResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { e164: null, valid: false };
  }

  try {
    const parsed = util.parse(trimmed, defaultRegion ?? "US");
    const valid = util.isValidNumber(parsed);
    if (!valid) {
      return { e164: null, valid: false, error: "invalid" };
    }
    return {
      e164: util.format(parsed, PhoneNumberFormat.E164),
      valid: true,
    };
  } catch {
    return { e164: null, valid: false, error: "invalid" };
  }
}

export function isPhoneValidForRegion(e164: string, region: string): boolean {
  try {
    const parsed = util.parse(e164, region);
    return util.isValidNumberForRegion(parsed, region);
  } catch {
    return false;
  }
}

/** True when prefix and national digits form a complete, valid number for the resolved region. */
export function isCompletePhoneValid(
  prefixDigits: string,
  nationalDigits: string,
  region?: string | null,
  defaultRegion?: string
): boolean {
  if (!prefixDigits || !nationalDigits) {
    return false;
  }

  const resolvedRegion = region ?? defaultRegion ?? "US";
  try {
    const parsed = util.parse(`+${prefixDigits}${nationalDigits}`, resolvedRegion);
    if (!util.isValidNumber(parsed)) {
      return false;
    }
    if (region) {
      return util.isValidNumberForRegion(parsed, region);
    }
    return true;
  } catch {
    return false;
  }
}

function splitPartialDigits(
  allDigits: string,
  preferredRegion?: string
): { prefixDigits: string; nationalDigits: string; region: string | null } {
  for (let length = Math.min(allDigits.length, 4); length >= 1; length -= 1) {
    const prefixCandidate = allDigits.slice(0, length);
    if (isCallingCodeComplete(prefixCandidate)) {
      const match = matchCallingCodeFromDigits(prefixCandidate, preferredRegion);
      if (match) {
        return {
          prefixDigits: prefixCandidate,
          nationalDigits: allDigits.slice(length),
          region: match.region,
        };
      }
    }
  }

  const partialMatch = matchCallingCodeFromDigits(allDigits, preferredRegion);
  return {
    prefixDigits: allDigits,
    nationalDigits: "",
    region: partialMatch?.region ?? preferredRegion ?? null,
  };
}

/** Split a stored phone value into prefix/national parts, including partial in-progress input. */
export function splitPhoneValueToParts(
  value: string | null | undefined,
  defaultRegion?: string
): { prefixDigits: string; nationalDigits: string; region: string | null } {
  if (!value?.trim()) {
    return { prefixDigits: "", nationalDigits: "", region: defaultRegion ?? null };
  }

  const normalized = value.trim().startsWith("+") ? value.trim() : `+${value.trim()}`;

  try {
    const parsed = util.parse(normalized);
    const prefixDigits = String(parsed.getCountryCode() ?? "");
    const rawNational = parsed.getNationalNumber();
    const nationalDigits = rawNational !== undefined && rawNational !== 0 ? String(rawNational) : "";
    const region = util.getRegionCodeForNumber(parsed) ?? defaultRegion ?? null;
    return { prefixDigits, nationalDigits, region };
  } catch {
    const allDigits = normalized.replace(/^\++/, "").replace(/\D/g, "");
    if (!allDigits) {
      return { prefixDigits: "", nationalDigits: "", region: defaultRegion ?? null };
    }
    return splitPartialDigits(allDigits, defaultRegion);
  }
}
