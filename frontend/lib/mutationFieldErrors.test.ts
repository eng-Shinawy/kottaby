/**
 * Paired suite — form-bound VALIDATION field-error wiring.
 *
 * WHAT THIS LOCKS
 *   1. `projectMutationFieldErrors`: a mocked `VALIDATION` error authored as
 *      a genuine Apollo Client v4 `CombinedGraphQLErrors` container flows
 *      through the pure mapping table (`hasForm:true` direct-call variant)
 *      and yields exactly the `extensions.fields[]` `{field, message}` pairs —
 *      the same pairs an RHF submit handler feeds to
 *      `setError(field, { message })`.
 *   2. The clear-on-fix contract at LOGIC tier: once inputs are corrected the
 *      next submit produces NO projected pairs (empty projection ⇒ callers
 *      clear/replace stale server errors; rule-level client errors are then
 *      cleared natively by RHF's post-submit `reValidateMode:"onChange"`).
 *      Render-tier component tests stay out of scope (the static/component
 *      UI test tier was removed), nothing faked here.
 *   3. `applyProjectedFieldErrors`: whitelist narrowing into the typed sink —
 *      the mock sink receives exactly the field:message pairs, unknown wire
 *      paths are skipped without unsafe casts, applied-count drives the
 *      "per-field mapping replaces global fallback" branch.
 *   4. No-new-near-duplicates: every fallback translation key the consumers
 *      rely on ALREADY EXISTS in both locale namespaces — asserted against
 *      the real `authTranslations` objects so a future key removal fails
 *      loudly HERE instead of blanking UI copy.
 *
 * i18n ADAPTATION NOTE: expected strings resolve via `getDefaultTranslations()`
 * / AR namespace-object parity probes — same mechanism as the error-link
 * mapping suite; fixture field messages are technical test data,
 * never rendered UI copy.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts frontend/lib/mutationFieldErrors.test.ts
 */

import { describe, expect, test } from "bun:test";
import { CombinedGraphQLErrors } from "@apollo/client";
import {
  applyProjectedFieldErrors,
  type ProjectedFieldError,
  projectMutationFieldErrors,
} from "@/frontend/lib/mutationFieldErrors";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { isRegisterFieldPath } from "@/frontend/views/auth/register/registerFormUtils";
import { getDefaultTranslations, loadAllTranslations } from "@/shared/locale/server";
import type { AuthLabels } from "@/shared/locale/types/auth";

// ---------------------------------------------------------------------------
// Fixtures — genuine Apollo v4 containers, mirroring error-link.map.test.ts

type FixtureItem = { readonly message: string; readonly extensions?: Record<string, unknown> };

function combinedError(items: readonly FixtureItem[]): CombinedGraphQLErrors {
  return new CombinedGraphQLErrors({
    errors: items.map(item => ({
      message: item.message,
      ...(item.extensions === undefined ? {} : { extensions: item.extensions }),
    })),
  });
}

const REGISTRATION_FIELD_PAIRS = [
  { field: "email", code: "EMAIL_INVALID", message: "Enter a valid email address." },
  { field: "password", code: "PASSWORD_TOO_SHORT", message: "Password must be at least 8 characters." },
] as const;

/** Wire-shaped VALIDATION item carrying localized `extensions.fields[]`. */
function validationItem(fields: readonly unknown[]): FixtureItem {
  return {
    message: "Registration failed validation.",
    extensions: { code: "VALIDATION", fields },
  };
}

/** expect-wrapped narrowing helper — assertion first, zero casts. */
function firstPairOrThrow(pairs: readonly ProjectedFieldError[], index = 0): ProjectedFieldError {
  if (index >= pairs.length) {
    // Assertion first (bun prints the diff), then an explicit throw so the
    // success path narrows without any type assertion.
    expect(pairs).not.toHaveLength(0);
    throw new Error("expected a projected field-error pair");
  }
  return pairs[index];
}

// ---------------------------------------------------------------------------
// Projection through the mocked VALIDATION CombinedGraphQLErrors

describe("projectMutationFieldErrors — mocked VALIDATION → RHF setError pairs", () => {
  test("VALIDATION + extensions.fields[] yields exactly the wire field:message pairs", () => {
    const error = combinedError([validationItem(REGISTRATION_FIELD_PAIRS)]);
    const pairs = projectMutationFieldErrors(error);

    expect(pairs).toHaveLength(2);
    expect(firstPairOrThrow(pairs, 0)).toEqual({
      field: "email",
      message: "Enter a valid email address.",
    });
    expect(firstPairOrThrow(pairs, 1)).toEqual({
      field: "password",
      message: "Password must be at least 8 characters.",
    });
  });

  test("ApolloError-style wrapper ({ cause: container }) is traversed too", () => {
    const apolloErrorLike = {
      message: "Registration failed",
      cause: combinedError([validationItem(REGISTRATION_FIELD_PAIRS)]),
    };
    const pairs = projectMutationFieldErrors(apolloErrorLike);
    expect(pairs).toHaveLength(2);
    expect(firstPairOrThrow(pairs).field).toBe("email");
  });

  test("form-bound adoption flips the link-tier toast row into field pairs", () => {
    // Same wire item, both contexts: the ErrorLink sees hasForm:false and can
    // only produce a toast action; THIS module re-runs it with hasForm:true.
    const fields = [{ field: "email", code: "EMAIL_INVALID", message: "Enter a valid email address." }] as const;
    const linkTierAction = mapGraphQLErrorByCode("VALIDATION", {
      contextKind: "mutation",
      hasForm: false,
      fields,
    });
    expect(linkTierAction?.kind).toBe("toast");
    expect(linkTierAction?.messageKey).toBe("validation");

    const formTierPairs = projectMutationFieldErrors(combinedError([validationItem(fields)]));
    expect(formTierPairs).toHaveLength(1);
    expect(linkTierAction?.kind).not.toBe("form-fields");
    expect(
      mapGraphQLErrorByCode("VALIDATION", {
        contextKind: "mutation",
        hasForm: true,
        fields,
      })?.kind
    ).toBe("form-fields");
  });

  test("duplicated field paths collapse first-wins (one helper line per field)", () => {
    const error = combinedError([
      validationItem([
        { field: "email", code: "EMAIL_TAKEN", message: "First message wins." },
        { field: "email", code: "EMAIL_SECOND", message: "Second must never surface." },
      ]),
    ]);
    const pairs = projectMutationFieldErrors(error);
    expect(pairs).toHaveLength(1);
    expect(firstPairOrThrow(pairs).message).toBe("First message wins.");
  });
});

describe("projectMutationFieldErrors — degraded inputs keep prior behavior untouched", () => {
  test.each([
    [
      "CONFLICT notice carries no field pairs",
      combinedError([{ message: "conflict", extensions: { code: "CONFLICT" } }]),
    ],
    [
      "VALIDATION without fields[] falls back empty",
      combinedError([{ message: "invalid", extensions: { code: "VALIDATION" } }]),
    ],
    [
      "masked INTERNAL_SERVER_ERROR leaks nothing",
      combinedError([{ message: "masked", extensions: { code: "INTERNAL_SERVER_ERROR" } }]),
    ],
    ["row-less codes project nothing", combinedError([{ message: "bad", extensions: { code: "BAD_REQUEST" } }])],
    [
      "malformed fields entries are filtered out",
      combinedError([validationItem([42, null, "", { field: "" }, { field: "x" }, { message: "no field" }])]),
    ],
  ])("%s", (_label, error) => {
    expect(projectMutationFieldErrors(error)).toEqual([]);
  });

  test("plain non-GraphQL failures (network Error) project zero pairs", () => {
    expect(projectMutationFieldErrors(new Error("Failed to fetch"))).toEqual([]);
    expect(projectMutationFieldErrors(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyProjectedFieldErrors — typed sink receives the exact pairs

/** Whitelist-style guard standing in for the form's FieldPath predicate. */
function isKnownPath(value: string): value is "email" | "password" {
  return value === "email" || value === "password";
}

describe("applyProjectedFieldErrors — setError receives field:message pairs", () => {
  test("sink calls arrive in wire order with exact messages", () => {
    const received: Array<{ field: string; message: string }> = [];
    const applied = applyProjectedFieldErrors(
      projectMutationFieldErrors(combinedError([validationItem(REGISTRATION_FIELD_PAIRS)])),
      isKnownPath,
      (field, errorOptions) => {
        received.push({ field, message: errorOptions.message });
      }
    );

    expect(applied).toBe(2);
    expect(received[0]?.field).toBe("email");
    expect(received[0]?.message).toBe("Enter a valid email address.");
    expect(received[1]?.field).toBe("password");
    expect(received[1]?.message).toBe("Password must be at least 8 characters.");
  });

  test("wire paths outside the form whitelist are skipped, never force-cast in", () => {
    const error = combinedError([
      validationItem([
        { field: "spoofed.unknown.path", code: "WEIRD", message: "Never rendered." },
        { field: "email", code: "EMAIL_INVALID", message: "Enter a valid email address." },
      ]),
    ]);
    const received: string[] = [];
    const applied = applyProjectedFieldErrors(projectMutationFieldErrors(error), isKnownPath, field => {
      received.push(field);
    });

    expect(applied).toBe(1);
    expect(received).toEqual(["email"]);
  });

  test("error-clears-on-fix: corrected resubmission projects nothing ⇒ sink untouched", () => {
    const beforeFix = projectMutationFieldErrors(combinedError([validationItem(REGISTRATION_FIELD_PAIRS)]));
    expect(beforeFix.length).toBeGreaterThan(0);

    const afterFix = projectMutationFieldErrors(undefined);
    let sinkCalls = 0;
    const applied = applyProjectedFieldErrors(afterFix, isKnownPath, () => {
      sinkCalls += 1;
    });

    expect(applied).toBe(0);
    expect(sinkCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Country field path: the registration service's country-code codes land on
// the unchanged `country` path, so the register form's whitelist projection
// (REGISTER_FIELD_PATHS → isRegisterFieldPath) surfaces them inline.

const COUNTRY_REQUIRED_PAIR = { field: "country", code: "COUNTRY_CODE_REQUIRED", message: "Please select a country." };
const COUNTRY_INVALID_PAIR = {
  field: "country",
  code: "COUNTRY_CODE_INVALID",
  message: "The selected country is not recognized.",
};

describe("country field-path mapping — COUNTRY_CODE_* codes project onto `country`", () => {
  test("the register form's known-path whitelist still accepts `country` (and only that path)", () => {
    expect(isRegisterFieldPath("country")).toBe(true);
    expect(isRegisterFieldPath("countryCode")).toBe(false);
    expect(isRegisterFieldPath("locale")).toBe(false);
  });

  test("COUNTRY_CODE_REQUIRED projects as a single pair on the country path", () => {
    const pairs = projectMutationFieldErrors(combinedError([validationItem([COUNTRY_REQUIRED_PAIR])]));
    expect(pairs).toHaveLength(1);
    expect(firstPairOrThrow(pairs)).toEqual({ field: "country", message: "Please select a country." });
  });

  test("COUNTRY_CODE_INVALID projects as a single pair on the country path", () => {
    const pairs = projectMutationFieldErrors(combinedError([validationItem([COUNTRY_INVALID_PAIR])]));
    expect(pairs).toHaveLength(1);
    expect(firstPairOrThrow(pairs)).toEqual({ field: "country", message: "The selected country is not recognized." });
  });

  test("both country pairs collapse first-wins onto one helper line", () => {
    const pairs = projectMutationFieldErrors(
      combinedError([validationItem([COUNTRY_REQUIRED_PAIR, COUNTRY_INVALID_PAIR])])
    );
    expect(pairs).toHaveLength(1);
    expect(firstPairOrThrow(pairs).message).toBe("Please select a country.");
  });

  test("register-form seam: the whitelisted sink applies the country pair for RHF setError", () => {
    const received: Array<{ field: string; message: string }> = [];
    const applied = applyProjectedFieldErrors(
      projectMutationFieldErrors(combinedError([validationItem([COUNTRY_INVALID_PAIR])])),
      isRegisterFieldPath,
      (field, errorOptions) => {
        received.push({ field, message: errorOptions.message });
      }
    );

    expect(applied).toBe(1);
    expect(received).toEqual([{ field: "country", message: "The selected country is not recognized." }]);
  });

  test("country pairs travel alongside the other registration pairs in wire order", () => {
    const pairs = projectMutationFieldErrors(
      combinedError([validationItem([COUNTRY_REQUIRED_PAIR, ...REGISTRATION_FIELD_PAIRS])])
    );
    expect(pairs).toHaveLength(3);
    expect(pairs.map(pair => pair.field)).toEqual(["country", "email", "password"]);
  });
});

// ---------------------------------------------------------------------------
// EXISTING keys only: reuse set for consumer fallback copy

const REUSE_SET = [
  "nameRequired",
  "emailRequired",
  "emailInvalid",
  "phoneRequired",
  "passwordRequired",
  "passwordTooShort",
  "countryRequired",
  "countryCodeRequired",
  "countryCodeInvalid",
  "roleRequired",
  "emailAlreadyExists",
  "registrationFailed",
] as const satisfies readonly (keyof AuthLabels)[];

describe("reuse audit — auth fallback keys exist in BOTH locales", () => {
  const enLabels = getDefaultTranslations().authTranslations;
  const arLabels = loadAllTranslations("ar").authTranslations;

  test("reuse set resolves non-empty localized copy in en + ar", () => {
    for (const key of REUSE_SET) {
      expect(enLabels[key].length).toBeGreaterThan(0);
      expect(arLabels[key].length).toBeGreaterThan(0);
    }
  });
});
