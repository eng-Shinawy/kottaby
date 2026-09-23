/**
 * Paired suite — `frontend/lib/parent-link-denials.ts`.
 *
 * WHAT THIS LOCKS
 *   1. Wire code mapping: all 5 backend domain error codes map to their
 *      corresponding localized `ErrorsLabels` string properties via
 *      `resolveParentLinkDenialCopy` and `resolveParentLinkDenialCopyOrNull`.
 *   2. `resolveParentLinkDenialCopy` fallback: returns `internalServerError`
 *      when code is `null` or unmapped wire code.
 *   3. `resolveParentLinkDenialCopyOrNull` fallback: returns `null` when code
 *      is `null` or unmapped wire code.
 *   4. Prototype pollution safety: prototype properties like `"toString"`,
 *      `"__proto__"`, `"constructor"` return `null` / `internalServerError`.
 *   5. Real locale dictionary parity: verifies keys exist and return non-empty
 *      strings in both `en` and `ar` locale translation bundles.
 *
 * RUNS VIA: bun run test/scripts/run-test.ts frontend/lib/parent-link-denials.test.ts
 */

import { describe, expect, test } from "bun:test";
import { resolveParentLinkDenialCopy, resolveParentLinkDenialCopyOrNull } from "@/frontend/lib/parent-link-denials";
import { getDefaultTranslations, loadAllTranslations } from "@/shared/locale/server";

// ---------------------------------------------------------------------------
// Mock translations fixture

const mockErrorsLabels = {
  ...getDefaultTranslations().errorsTranslations,
  internalServerError: "Internal Server Error Fallback",
  parentLinkTargetAlreadyLinked: "Target Already Linked Copy",
  parentLinkAlreadyPending: "Already Pending Copy",
  parentLinkRequestExpired: "Request Expired Copy",
  parentLinkRequestAlreadyResolved: "Request Already Resolved Copy",
  parentLinkRequestNotFound: "Request Not Found Copy",
};

const CODE_MAPPINGS = [
  {
    code: "PARENT_LINK_TARGET_ALREADY_LINKED",
    expected: "Target Already Linked Copy",
  },
  {
    code: "PARENT_LINK_ALREADY_PENDING",
    expected: "Already Pending Copy",
  },
  {
    code: "PARENT_LINK_REQUEST_EXPIRED",
    expected: "Request Expired Copy",
  },
  {
    code: "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
    expected: "Request Already Resolved Copy",
  },
  {
    code: "PARENT_LINK_REQUEST_NOT_FOUND",
    expected: "Request Not Found Copy",
  },
] as const;

// ---------------------------------------------------------------------------
// Unit tests

describe("resolveParentLinkDenialCopy — mapped codes and fallbacks", () => {
  test("maps all 5 known parent link denial codes to expected localized string", () => {
    for (const { code, expected } of CODE_MAPPINGS) {
      expect(resolveParentLinkDenialCopy(code, mockErrorsLabels)).toBe(expected);
    }
  });

  test("null code falls back to internalServerError copy", () => {
    expect(resolveParentLinkDenialCopy(null, mockErrorsLabels)).toBe("Internal Server Error Fallback");
  });

  test("unmapped wire code falls back to internalServerError copy", () => {
    expect(resolveParentLinkDenialCopy("UNKNOWN_PARENT_LINK_ERROR", mockErrorsLabels)).toBe(
      "Internal Server Error Fallback"
    );
  });

  test("inherited prototype property string falls back to internalServerError", () => {
    for (const inheritedKey of ["toString", "valueOf", "__proto__", "constructor"]) {
      expect(resolveParentLinkDenialCopy(inheritedKey, mockErrorsLabels)).toBe("Internal Server Error Fallback");
    }
  });
});

describe("resolveParentLinkDenialCopyOrNull — mapped codes and null fallbacks", () => {
  test("maps all 5 known parent link denial codes to expected localized string", () => {
    for (const { code, expected } of CODE_MAPPINGS) {
      expect(resolveParentLinkDenialCopyOrNull(code, mockErrorsLabels)).toBe(expected);
    }
  });

  test("null code returns null", () => {
    expect(resolveParentLinkDenialCopyOrNull(null, mockErrorsLabels)).toBeNull();
  });

  test("unmapped wire code returns null", () => {
    expect(resolveParentLinkDenialCopyOrNull("UNKNOWN_PARENT_LINK_ERROR", mockErrorsLabels)).toBeNull();
  });

  test("inherited prototype property string returns null", () => {
    for (const inheritedKey of ["toString", "valueOf", "__proto__", "constructor"]) {
      expect(resolveParentLinkDenialCopyOrNull(inheritedKey, mockErrorsLabels)).toBeNull();
    }
  });
});

describe("Real locale dictionary parity — parent link error keys exist in en and ar", () => {
  const enErrors = getDefaultTranslations().errorsTranslations;
  const arErrors = loadAllTranslations("ar").errorsTranslations;

  const REAL_KEYS = [
    "parentLinkTargetAlreadyLinked",
    "parentLinkAlreadyPending",
    "parentLinkRequestExpired",
    "parentLinkRequestAlreadyResolved",
    "parentLinkRequestNotFound",
  ] as const;

  test("all mapped keys resolve non-empty localized copy in en and ar", () => {
    for (const key of REAL_KEYS) {
      expect(enErrors[key].length).toBeGreaterThan(0);
      expect(arErrors[key].length).toBeGreaterThan(0);
    }
  });

  test("resolveParentLinkDenialCopy returns genuine non-empty localized string for all 5 codes in en and ar", () => {
    for (const item of CODE_MAPPINGS) {
      const enCopy = resolveParentLinkDenialCopy(item.code, enErrors);
      const arCopy = resolveParentLinkDenialCopy(item.code, arErrors);

      expect(enCopy).not.toBe(enErrors.internalServerError);
      expect(enCopy.length).toBeGreaterThan(0);

      expect(arCopy).not.toBe(arErrors.internalServerError);
      expect(arCopy.length).toBeGreaterThan(0);
    }
  });
});
