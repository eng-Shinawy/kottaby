import { getPhoneCountry, type PhoneCountry } from "@/shared/lib/phone/countries";
import { buildE164FromParts } from "@/shared/lib/phone/parse";

export function resolveCountry(region: string | null | undefined): PhoneCountry | undefined {
  if (!region) {
    return undefined;
  }
  return getPhoneCountry(region);
}

export function buildEmittedValue(prefixDigits: string, nationalDigits: string): string | null {
  if (!prefixDigits && !nationalDigits) {
    return null;
  }
  const built = buildE164FromParts(prefixDigits, nationalDigits);
  if (built) {
    return built;
  }
  if (prefixDigits) {
    return `+${prefixDigits}${nationalDigits}`;
  }
  return null;
}

/** Count digits in a formatted display string before a display index (maps selections to digit ranges). */
export function countDigitsUpTo(display: string, displayIndex: number): number {
  return display.slice(0, displayIndex).replace(/\D/g, "").length;
}
