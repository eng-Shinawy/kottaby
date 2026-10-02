/**
 * Paired suite — the pure logic of the admin `OrderReEvaluationDialog`
 * (`orderReEvaluationErrorCopy` + `isOrderReEvaluationReasonValid`).
 *
 * WHAT THIS LOCKS
 *   1. ERROR-COPY MATRIX — every closed denial code the
 *      re-evaluation order can raise maps to its OWN `Errors`-namespace
 *      leaf: `WALLET_INSUFFICIENT_FUNDS` → the REUSED `insufficientBalance`
 *      funds-denial leaf (the shared key, no new key minted),
 *      `TEACHER_NOT_CERTIFIED`,
 *      `APPLICANT_NOT_AWAITING_RE_EVALUATION`, `VALIDATION` → the wire-pinned
 *      `reEvaluationReasonRequired` leaf, the admin-gate `FORBIDDEN` /
 *      `UNAUTHORIZED` rows, and the generic `internalServerError` fallback
 *      for unknown/absent codes. The dispatch is keyed by `extensions.code`
 *      ONLY — the inputs are produced through the REAL `extractErrorCode`
 *      traversal over genuine Apollo v4 `CombinedGraphQLErrors` containers
 *      (the `rateTeacherMutationError` fixture discipline); no HTTP-status
 *      shape exists anywhere in the path.
 *   2. LOCALE CHANNEL — the SAME code keys resolve the AR copy too
 *      (non-empty + Arabic-scripted), proving the caller-locale transport.
 *   3. REASON GATE — the client mirror of the server's mandatory-reason
 *      validation: blank/whitespace-only reasons are blocked BEFORE the
 *      wire; a valid reason (including unicode/RTL and long values) passes
 *      — length bounds stay server-owned.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/admin/users/dialogs/order-re-evaluation-dialog.helpers.test.ts
 * — pure unit tier, no server boot, no DB, no React render.
 */

import { describe, expect, test } from "bun:test";
import { CombinedGraphQLErrors } from "@apollo/client";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import {
  isOrderReEvaluationReasonValid,
  orderReEvaluationErrorCopy,
} from "@/frontend/views/admin/users/dialogs/order-re-evaluation-dialog.helpers";
import { getDefaultTranslations, loadAllTranslations } from "@/shared/locale/server";

// ---------------------------------------------------------------------------
// Translation-backed expectations (never hardcoded copy)

const enErrorsTranslations = getDefaultTranslations().errorsTranslations;
const arErrorsTranslations = loadAllTranslations("ar").errorsTranslations;

/** code → the en leaf its row must resolve to. */
const EN_COPY_BY_CODE: Readonly<Record<string, string>> = {
  WALLET_INSUFFICIENT_FUNDS: enErrorsTranslations.insufficientBalance,
  TEACHER_NOT_CERTIFIED: enErrorsTranslations.teacherNotCertified,
  APPLICANT_NOT_AWAITING_RE_EVALUATION: enErrorsTranslations.applicantNotAwaitingReEvaluation,
  VALIDATION: enErrorsTranslations.reEvaluationReasonRequired,
  FORBIDDEN: enErrorsTranslations.forbidden,
  UNAUTHORIZED: enErrorsTranslations.unauthorized,
};

/** code → the ar leaf its row must resolve to (locale-channel probe). */
const AR_COPY_BY_CODE: Readonly<Record<string, string>> = {
  WALLET_INSUFFICIENT_FUNDS: arErrorsTranslations.insufficientBalance,
  TEACHER_NOT_CERTIFIED: arErrorsTranslations.teacherNotCertified,
  APPLICANT_NOT_AWAITING_RE_EVALUATION: arErrorsTranslations.applicantNotAwaitingReEvaluation,
  VALIDATION: arErrorsTranslations.reEvaluationReasonRequired,
  FORBIDDEN: arErrorsTranslations.forbidden,
  UNAUTHORIZED: arErrorsTranslations.unauthorized,
};

// ---------------------------------------------------------------------------
// Fixtures — genuine Apollo v4 containers, mirroring error-link.map.test.ts

type FixtureItem = { readonly message: string; readonly extensions?: Record<string, unknown> };

/** Builds the genuine Apollo v4 container from wire-shaped error items. */
function combinedError(items: readonly FixtureItem[]): CombinedGraphQLErrors {
  return new CombinedGraphQLErrors({
    errors: items.map(item => ({
      message: item.message,
      ...(item.extensions === undefined ? {} : { extensions: item.extensions }),
    })),
  });
}

/** Wire code item with only `extensions.code` set (masked transport surface). */
function codedError(code: string): CombinedGraphQLErrors {
  return combinedError([{ message: `${code} (masked transport surface)`, extensions: { code } }]);
}

// ===========================================================================
describe("orderReEvaluationErrorCopy — extensions.code → localized copy", () => {
  test.each(Object.keys(EN_COPY_BY_CODE))("%s maps to its own Errors leaf through the REAL code extraction", code => {
    const resolved = orderReEvaluationErrorCopy(extractErrorCode(codedError(code)), enErrorsTranslations);
    expect(resolved).toBe(EN_COPY_BY_CODE[code]);
    expect(resolved.length).toBeGreaterThan(0);
  });

  test("every mapped row resolves DISTINCT copy (no two codes share a leaf)", () => {
    const resolved = Object.keys(EN_COPY_BY_CODE).map(code => orderReEvaluationErrorCopy(code, enErrorsTranslations));
    expect(new Set(resolved).size).toBe(resolved.length);
  });

  test("a VALIDATION denial prefers the server's localized message (distinguishes blank vs over-limit)", () => {
    const overLimitCopy = "The re-evaluation reason must be 229 characters or fewer.";
    const resolved = orderReEvaluationErrorCopy("VALIDATION", enErrorsTranslations, overLimitCopy);
    expect(resolved).toBe(overLimitCopy);
  });

  test("a VALIDATION denial with no usable server message falls back to the required-reason leaf", () => {
    expect(orderReEvaluationErrorCopy("VALIDATION", enErrorsTranslations, null)).toBe(
      enErrorsTranslations.reEvaluationReasonRequired
    );
    expect(orderReEvaluationErrorCopy("VALIDATION", enErrorsTranslations, "   ")).toBe(
      enErrorsTranslations.reEvaluationReasonRequired
    );
    expect(orderReEvaluationErrorCopy("VALIDATION", enErrorsTranslations)).toBe(
      enErrorsTranslations.reEvaluationReasonRequired
    );
  });

  test("non-VALIDATION codes ignore the server message and keep their mapped leaf", () => {
    const resolved = orderReEvaluationErrorCopy("TEACHER_NOT_CERTIFIED", enErrorsTranslations, "some server text");
    expect(resolved).toBe(enErrorsTranslations.teacherNotCertified);
  });

  test("unknown codes and code-less failures fall back to the generic internalServerError copy", () => {
    expect(orderReEvaluationErrorCopy("SOMETHING_ELSE", enErrorsTranslations)).toBe(
      enErrorsTranslations.internalServerError
    );
    expect(orderReEvaluationErrorCopy(null, enErrorsTranslations)).toBe(enErrorsTranslations.internalServerError);
  });

  test("the SAME code keys resolve the AR copy — the caller-locale channel (RTL script)", () => {
    const arabicScript = /[\u0600-\u06FF]/;
    for (const [code, expected] of Object.entries(AR_COPY_BY_CODE)) {
      const resolved = orderReEvaluationErrorCopy(code, arErrorsTranslations);
      expect(resolved).toBe(expected);
      expect(arabicScript.test(resolved)).toBe(true);
    }
  });

  test("the funds denial REUSES the existing insufficientBalance leaf (no new key minted)", () => {
    expect(EN_COPY_BY_CODE.WALLET_INSUFFICIENT_FUNDS).toBe(enErrorsTranslations.insufficientBalance);
    expect(AR_COPY_BY_CODE.WALLET_INSUFFICIENT_FUNDS).toBe(arErrorsTranslations.insufficientBalance);
  });
});

// ===========================================================================
describe("isOrderReEvaluationReasonValid — client mirror of the mandatory-reason gate", () => {
  test("blank and whitespace-only reasons are blocked BEFORE the wire", () => {
    expect(isOrderReEvaluationReasonValid("")).toBe(false);
    expect(isOrderReEvaluationReasonValid("   ")).toBe(false);
    expect(isOrderReEvaluationReasonValid("\n\t ")).toBe(false);
  });

  test("a populated reason passes — including unicode/RTL and long values (length stays server-owned)", () => {
    expect(isOrderReEvaluationReasonValid("r")).toBe(true);
    expect(isOrderReEvaluationReasonValid("  padded-but-populated  ")).toBe(true);
    expect(isOrderReEvaluationReasonValid("سبب مشروع لإعادة التقييم")).toBe(true);
    expect(isOrderReEvaluationReasonValid("r".repeat(500))).toBe(true);
  });
});
