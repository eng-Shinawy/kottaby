/**
 * Unit tier — the admin applicant-override helpers. Locks:
 *
 *  1. `isValidOverrideDays` mirrors the server-side reject bounds gate
 *     exactly — whole numbers 1..3650 only (the server rejects anything
 *     else with `APPLICANT_OVERRIDE_COOLDOWN_INVALID`, so an invalid value
 *     must never cross the wire);
 *  2. `overrideUsesDays` — the cooldown-days field is the REJECT direction's
 *     requirement alone; certify / grant_re_evaluation ignore the argument
 *     server-side (the `adminSetUserSuspended` `periodDays` precedent);
 *  3. the per-action eligibility gates mirror the server's denial arms —
 *     certify blocked once `status === passed`, grant requires an Active or
 *     Expired cooldown, reject requires `status === passed`;
 *  4. `metaForOverride` + `successToastOf` resolve COMPLETE per-action copy
 *     (title / body / confirm label / confirm tone / toast) for all three
 *     wire enum members — a missing member falls into the reject arm, so
 *     every member must be pinned explicitly;
 *  5. `buildOverrideRouteError` routes the override mutation's typed
 *     rejections: FORBIDDEN is suppressed inline (global toast path),
 *     `APPLICANT_OVERRIDE_COOLDOWN_INVALID` + the generic VALIDATION class
 *     land on the field helperText lane, and every typed domain rejection
 *     (`APPLICANT_ALREADY_CERTIFIED`, `APPLICANT_OVERRIDE_NOT_PASSED`,
 *     `APPLICANT_NO_ACTIVE_COOLDOWN`, `APPLICANT_ALREADY_FINALIZED`,
 *     `APPLICANT_NOT_FOUND`) surfaces as an inline info alert carrying the
 *     SERVER-localized message.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/views/admin/users/hooks/applicant-override-helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  AdminApplicantOverrideAction,
  ApplicantCooldownState,
  ApplicantStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  buildOverrideRouteError,
  isCertifyEligible,
  isGrantEligible,
  isRejectEligible,
  isValidOverrideDays,
  metaForOverride,
  OVERRIDE_MAX_DAYS,
  OVERRIDE_MIN_DAYS,
  overrideUsesDays,
  successToastOf,
} from "@/frontend/views/admin/users/hooks/applicant-override-helpers";
import { adminUsersEn } from "@/shared/locale/en/adminUsers";

/**
 * Copy fixture — the REAL localized `applicantOverride` block (the sibling
 * `applicant-cooldown-state.helpers.test.ts` discipline): mapping assertions
 * reference the actual wired copy via property access, so a key dropped from
 * the locale maps fails here too.
 */
const copy = adminUsersEn.applicantOverride;

/** Minimal Apollo-shaped error carrying a typed domain code. */
function wireError(
  code: string,
  message: string
): { errors: Array<{ message: string; extensions: { code: string } }> } {
  return { errors: [{ message, extensions: { code } }] };
}

/** The three wire enum members — the copy-mapping completeness sweep. */
const ALL_ACTIONS = [
  AdminApplicantOverrideAction.Certify,
  AdminApplicantOverrideAction.GrantReEvaluation,
  AdminApplicantOverrideAction.Reject,
] as const;

describe("isValidOverrideDays", () => {
  test("accepts the inclusive server bounds (1..3650)", () => {
    expect(OVERRIDE_MIN_DAYS).toBe(1);
    expect(OVERRIDE_MAX_DAYS).toBe(3650);
    expect(isValidOverrideDays("1")).toBe(true);
    expect(isValidOverrideDays("30")).toBe(true);
    expect(isValidOverrideDays("3650")).toBe(true);
  });

  test("rejects out-of-bounds, non-integer, and non-numeric input", () => {
    expect(isValidOverrideDays("0")).toBe(false);
    expect(isValidOverrideDays("3651")).toBe(false);
    expect(isValidOverrideDays("-5")).toBe(false);
    expect(isValidOverrideDays("3.5")).toBe(false);
    expect(isValidOverrideDays("")).toBe(false);
    expect(isValidOverrideDays("   ")).toBe(false);
    expect(isValidOverrideDays("abc")).toBe(false);
    expect(isValidOverrideDays("12abc")).toBe(false);
  });
});

describe("overrideUsesDays — reject-only days field visibility", () => {
  test("the REJECT direction requires the cooldown-days field", () => {
    expect(overrideUsesDays(AdminApplicantOverrideAction.Reject)).toBe(true);
  });

  test("certify / grant_re_evaluation ignore the days field", () => {
    expect(overrideUsesDays(AdminApplicantOverrideAction.Certify)).toBe(false);
    expect(overrideUsesDays(AdminApplicantOverrideAction.GrantReEvaluation)).toBe(false);
  });
});

describe("client-mirrored eligibility gates", () => {
  test("certify is blocked once the applicant is passed (terminal)", () => {
    expect(isCertifyEligible(ApplicantStatus.Pending)).toBe(true);
    expect(isCertifyEligible(ApplicantStatus.InEvaluation)).toBe(true);
    expect(isCertifyEligible(ApplicantStatus.Failed)).toBe(true);
    expect(isCertifyEligible(ApplicantStatus.Passed)).toBe(false);
  });

  test("grant requires an Active or Expired cooldown (nothing recorded blocks it)", () => {
    expect(isGrantEligible(ApplicantCooldownState.Active)).toBe(true);
    expect(isGrantEligible(ApplicantCooldownState.Expired)).toBe(true);
    expect(isGrantEligible(ApplicantCooldownState.None)).toBe(false);
  });

  test("reject targets passed applicants only", () => {
    expect(isRejectEligible(ApplicantStatus.Passed)).toBe(true);
    expect(isRejectEligible(ApplicantStatus.Pending)).toBe(false);
    expect(isRejectEligible(ApplicantStatus.InEvaluation)).toBe(false);
    expect(isRejectEligible(ApplicantStatus.Failed)).toBe(false);
  });
});

describe("metaForOverride — per-action dialog copy completeness", () => {
  test("certify resolves its title/body/confirm on the success tone", () => {
    const meta = metaForOverride(copy, AdminApplicantOverrideAction.Certify);
    expect(meta.title).toBe(copy.dialogTitleCertify);
    expect(meta.message).toBe(copy.certifyDesc);
    expect(meta.confirm).toBe(copy.certifyConfirm);
    expect(meta.confirmColor).toBe("success");
  });

  test("grant resolves its title/body/confirm on the secondary tone", () => {
    const meta = metaForOverride(copy, AdminApplicantOverrideAction.GrantReEvaluation);
    expect(meta.title).toBe(copy.dialogTitleGrant);
    expect(meta.message).toBe(copy.grantDesc);
    expect(meta.confirm).toBe(copy.grantConfirm);
    expect(meta.confirmColor).toBe("secondary");
  });

  test("reject resolves its title/body/confirm on the error tone", () => {
    const meta = metaForOverride(copy, AdminApplicantOverrideAction.Reject);
    expect(meta.title).toBe(copy.dialogTitleReject);
    expect(meta.message).toBe(copy.rejectDesc);
    expect(meta.confirm).toBe(copy.rejectConfirm);
    expect(meta.confirmColor).toBe("error");
  });

  test("the three dialog titles are pairwise distinct (no merged copy)", () => {
    const titles = ALL_ACTIONS.map(action => metaForOverride(copy, action).title);
    expect(new Set(titles).size).toBe(ALL_ACTIONS.length);
  });
});

describe("successToastOf — per-direction snackbar copy", () => {
  test("each wire enum member resolves its own toast", () => {
    expect(successToastOf(copy, AdminApplicantOverrideAction.Certify)).toBe(copy.successToastCertify);
    expect(successToastOf(copy, AdminApplicantOverrideAction.GrantReEvaluation)).toBe(copy.successToastGrant);
    expect(successToastOf(copy, AdminApplicantOverrideAction.Reject)).toBe(copy.successToastReject);
  });

  test("the three toasts are pairwise distinct (no merged copy)", () => {
    const toasts = ALL_ACTIONS.map(action => successToastOf(copy, action));
    expect(new Set(toasts).size).toBe(ALL_ACTIONS.length);
  });
});

describe("buildOverrideRouteError — routing matrix", () => {
  test("FORBIDDEN is suppressed inline (rides the global toast path)", () => {
    // `null as T` initializer — keeps the DECLARED type at read sites (a bare
    // `null` initializer narrows reads to `null` and closure writes back are
    // invisible to control-flow analysis).
    let daysErr = null as string | null;
    let alert = null as { severity: string; message: string } | null;
    buildOverrideRouteError(
      v => (daysErr = v),
      a => (alert = a)
    )(wireError("FORBIDDEN", "denied"));
    expect(daysErr).toBeNull();
    expect(alert).toBeNull();
  });

  test("APPLICANT_OVERRIDE_COOLDOWN_INVALID lands on the field helperText lane", () => {
    // `null as T` initializer — keeps the DECLARED type at read sites (a bare
    // `null` initializer narrows reads to `null` and closure writes back are
    // invisible to control-flow analysis).
    let daysErr = null as string | null;
    let alert = null as { severity: string; message: string } | null;
    buildOverrideRouteError(
      v => (daysErr = v),
      a => (alert = a)
    )(wireError("APPLICANT_OVERRIDE_COOLDOWN_INVALID", "Cooldown days must be a whole number between 1 and 3650."));
    expect(daysErr).toBe("Cooldown days must be a whole number between 1 and 3650.");
    expect(alert).toBeNull();
  });

  test("the generic VALIDATION class lands on the field helperText lane", () => {
    // `null as T` initializer — keeps the DECLARED type at read sites (a bare
    // `null` initializer narrows reads to `null` and closure writes back are
    // invisible to control-flow analysis).
    let daysErr = null as string | null;
    let alert = null as { severity: string; message: string } | null;
    buildOverrideRouteError(
      v => (daysErr = v),
      a => (alert = a)
    )(wireError("VALIDATION", "cooldownDays must be positive"));
    expect(daysErr).toBe("cooldownDays must be positive");
    expect(alert).toBeNull();
  });

  test.each([
    "APPLICANT_ALREADY_CERTIFIED",
    "APPLICANT_OVERRIDE_NOT_PASSED",
    "APPLICANT_NO_ACTIVE_COOLDOWN",
    "APPLICANT_ALREADY_FINALIZED",
    "APPLICANT_NOT_FOUND",
  ])("typed domain rejection %s surfaces as an info alert with the server message", code => {
    // `null as T` initializer — keeps the DECLARED type at read sites (a bare
    // `null` initializer narrows reads to `null` and closure writes back are
    // invisible to control-flow analysis).
    let daysErr = null as string | null;
    let alert = null as { severity: string; message: string } | null;
    buildOverrideRouteError(
      v => (daysErr = v),
      a => (alert = a)
    )(wireError(code, "الرسالة المحلية من الخادم"));
    expect(daysErr).toBeNull();
    expect(alert?.severity).toBe("info");
    expect(alert?.message).toBe("الرسالة المحلية من الخادم");
  });
});
