import { describe, expect, test } from "bun:test";
import {
  canAppendCallingCodeDigit,
  getCallingCodeForRegion,
  getMaxCallingCodeLength,
  isCallingCodeComplete,
  isCallingCodePrefixValid,
  matchCallingCodeFromDigits,
} from "@/shared/lib/phone/calling-code";
import { getPhoneCountry, PHONE_COUNTRIES, resolvePhoneCountryByCallingCode } from "@/shared/lib/phone/countries";
import { clampSelectionToDigits, formatNationalDigits, getNextFormatChar } from "@/shared/lib/phone/national-format";
import {
  buildE164FromParts,
  isCompletePhoneValid,
  isPhoneValidForRegion,
  parsePhoneToE164,
  splitPhoneValueToParts,
} from "@/shared/lib/phone/parse";

describe("phone utilities", () => {
  describe("parsePhoneToE164", () => {
    test("parses Egypt number to E.164", () => {
      const result = parsePhoneToE164("+201012345678");
      expect(result.valid).toBe(true);
      expect(result.e164).toBe("+201012345678");
    });

    test("uses default region for local numbers", () => {
      const result = parsePhoneToE164("01012345678", "EG");
      expect(result.valid).toBe(true);
      expect(result.e164).toBe("+201012345678");
    });

    test("returns invalid for empty input", () => {
      expect(parsePhoneToE164("")).toEqual({ e164: null, valid: false });
    });

    test("returns invalid for malformed number", () => {
      const result = parsePhoneToE164("+201");
      expect(result.valid).toBe(false);
      expect(result.e164).toBeNull();
    });
  });

  describe("calling code helpers", () => {
    test("resolves Egypt calling code", () => {
      expect(getCallingCodeForRegion("EG")).toBe("20");
    });

    test("matches partial prefix while typing", () => {
      const match = matchCallingCodeFromDigits("96", "SA");
      expect(match?.isComplete).toBe(false);
      expect(match?.callingCode).toBe("966");
    });

    test("marks complete calling code", () => {
      expect(isCallingCodeComplete("966")).toBe(true);
      expect(isCallingCodePrefixValid("96")).toBe(true);
      expect(isCallingCodePrefixValid("999")).toBe(false);
    });

    test("resolves +1 to US when default region is unrelated", () => {
      const match = matchCallingCodeFromDigits("1", "EG");
      expect(match).toEqual({ region: "US", callingCode: "1", isComplete: true });
    });

    test("reports max calling code length", () => {
      expect(getMaxCallingCodeLength()).toBeGreaterThanOrEqual(3);
    });

    test("blocks digits once calling code is complete", () => {
      expect(canAppendCallingCodeDigit("966", "5")).toBe(false);
    });

    test("blocks digits that exceed max calling code length", () => {
      const maxLength = getMaxCallingCodeLength();
      const tooLong = "1".repeat(maxLength + 1);
      expect(isCallingCodePrefixValid(tooLong)).toBe(false);
      expect(canAppendCallingCodeDigit("1".repeat(maxLength), "2")).toBe(false);
    });

    test("allows valid partial calling code digits", () => {
      expect(canAppendCallingCodeDigit("9", "6")).toBe(true);
      expect(canAppendCallingCodeDigit("96", "6")).toBe(true);
    });
  });

  describe("buildE164FromParts", () => {
    test("builds E.164 from prefix and national digits", () => {
      expect(buildE164FromParts("966", "501234567")).toBe("+966501234567");
    });

    test("returns null when either part is empty", () => {
      expect(buildE164FromParts("20", "")).toBeNull();
      expect(buildE164FromParts("", "1012345678")).toBeNull();
    });
  });

  describe("splitPhoneValueToParts", () => {
    test("splits complete E.164", () => {
      expect(splitPhoneValueToParts("+201012345678")).toEqual({
        prefixDigits: "20",
        nationalDigits: "1012345678",
        region: "EG",
      });
    });

    test("splits partial prefix while typing", () => {
      const result = splitPhoneValueToParts("+9");
      expect(result.prefixDigits).toBe("9");
      expect(result.nationalDigits).toBe("");
      expect(result.region).toBeTruthy();
    });

    test("splits prefix-only value from country selection", () => {
      expect(splitPhoneValueToParts("+20", "EG")).toEqual({
        prefixDigits: "20",
        nationalDigits: "",
        region: "EG",
      });
    });

    test("splits +1 prefix to US", () => {
      expect(splitPhoneValueToParts("+1", "EG")).toEqual({
        prefixDigits: "1",
        nationalDigits: "",
        region: "US",
      });
    });

    test("splits prefix with partial national digits", () => {
      expect(splitPhoneValueToParts("+966501", "SA")).toEqual({
        prefixDigits: "966",
        nationalDigits: "501",
        region: "SA",
      });
    });

    test("returns empty parts for empty or missing values", () => {
      expect(splitPhoneValueToParts("")).toEqual({ prefixDigits: "", nationalDigits: "", region: null });
      expect(splitPhoneValueToParts(null)).toEqual({ prefixDigits: "", nationalDigits: "", region: null });
      expect(splitPhoneValueToParts(undefined, "EG")).toEqual({
        prefixDigits: "",
        nationalDigits: "",
        region: "EG",
      });
    });
  });

  describe("formatNationalDigits", () => {
    test("applies regional formatting template", () => {
      const formatted = formatNationalDigits("1012345678", "EG");
      expect(formatted.replace(/\D/g, "")).toBe("1012345678");
    });

    test("formats US number with punctuation", () => {
      expect(formatNationalDigits("4155552666", "US")).toBe("(415) 555-2666");
    });
  });

  describe("getNextFormatChar", () => {
    test("returns the upcoming template punctuation", () => {
      expect(getNextFormatChar("415", "4155", "US")).toBe("-");
      expect(getNextFormatChar("(415) 555", "4155552666", "US")).toBe("-");
    });

    test("returns null when display is already complete", () => {
      expect(getNextFormatChar("(415) 555-2666", "4155552666", "US")).toBeNull();
    });

    test("returns null when the next template char is a digit", () => {
      expect(getNextFormatChar("415-55", "415555", "US")).toBeNull();
    });
  });

  describe("clampSelectionToDigits", () => {
    test("expands a punctuation-adjacent selection onto digit boundaries", () => {
      expect(clampSelectionToDigits("(415) 555-2666", 4, 6)).toEqual({ start: 6, end: 7 });
      expect(clampSelectionToDigits("(415) 555-2666", 9, 9)).toEqual({ start: 10, end: 11 });
    });

    test("keeps a full selection spanning every digit", () => {
      expect(clampSelectionToDigits("(415) 555-2666", 0, 14)).toEqual({ start: 1, end: 14 });
    });
  });

  describe("isCompletePhoneValid", () => {
    test("returns false for prefix only", () => {
      expect(isCompletePhoneValid("20", "", "EG", "EG")).toBe(false);
    });

    test("returns false for incomplete national number", () => {
      expect(isCompletePhoneValid("20", "10123", "EG", "EG")).toBe(false);
    });

    test("returns true for complete valid Egypt number", () => {
      expect(isCompletePhoneValid("20", "1012345678", "EG", "EG")).toBe(true);
    });

    test("returns false for wrong region", () => {
      expect(isCompletePhoneValid("966", "501234567", "EG", "EG")).toBe(false);
    });
  });

  describe("isPhoneValidForRegion", () => {
    test("validates number for region", () => {
      expect(isPhoneValidForRegion("+201012345678", "EG")).toBe(true);
      expect(isPhoneValidForRegion("+966501234567", "EG")).toBe(false);
    });
  });

  describe("PHONE_COUNTRIES", () => {
    test("lists suggested countries first in display order", () => {
      expect(PHONE_COUNTRIES.slice(0, 5).map(country => country.code)).toEqual(["EG", "SA", "AE", "US", "GB"]);
      expect(PHONE_COUNTRIES.slice(0, 5).every(country => country.suggested)).toBe(true);
    });

    test("sorts the remaining countries by English name", () => {
      const rest = PHONE_COUNTRIES.slice(5);
      expect(rest.every(country => !country.suggested)).toBe(true);
      const names = rest.map(country => country.nameEn);
      const sorted = names.toSorted((left, right) => left.localeCompare(right));
      expect(names).toEqual(sorted);
    });

    test("carries one entry per region with merged metadata", () => {
      const codes = PHONE_COUNTRIES.map(country => country.code);
      expect(new Set(codes).size).toBe(codes.length);
      const egypt = getPhoneCountry("EG");
      expect(egypt).toEqual({
        code: "EG",
        callingCode: "20",
        flag: "🇪🇬",
        nameEn: "Egypt",
        nameAr: "مصر",
        suggested: true,
      });
    });
  });

  describe("getPhoneCountry", () => {
    test("matches ISO alpha-2 codes case-insensitively", () => {
      expect(getPhoneCountry("eg")?.code).toBe("EG");
      expect(getPhoneCountry("Eg")?.code).toBe("EG");
      expect(getPhoneCountry("SA")?.callingCode).toBe("966");
    });

    test("returns undefined for unknown codes", () => {
      expect(getPhoneCountry("XX")).toBeUndefined();
      expect(getPhoneCountry("")).toBeUndefined();
    });
  });

  describe("resolvePhoneCountryByCallingCode", () => {
    test("resolves unique dial codes to their region", () => {
      expect(resolvePhoneCountryByCallingCode("20")?.code).toBe("EG");
      expect(resolvePhoneCountryByCallingCode("966")?.code).toBe("SA");
      expect(resolvePhoneCountryByCallingCode("971")?.code).toBe("AE");
    });

    test("resolves shared dial codes to libphonenumber's canonical region", () => {
      expect(resolvePhoneCountryByCallingCode("1")?.code).toBe("US");
      expect(resolvePhoneCountryByCallingCode("7")?.code).toBe("RU");
      expect(resolvePhoneCountryByCallingCode("44")?.code).toBe("GB");
    });

    test("returns undefined for unknown dial codes", () => {
      expect(resolvePhoneCountryByCallingCode("999")).toBeUndefined();
      expect(resolvePhoneCountryByCallingCode("")).toBeUndefined();
    });
  });
});
