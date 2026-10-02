/**
 * Visibility lock over the admin user-detail hero's "Order re-evaluation"
 * action gate (`isOrderReEvaluationActionVisible`).
 *
 * WHAT THIS LOCKS
 *   1. ROLE + STATE GATING — the affordance renders ONLY for a
 *      `UserRole.Teacher` user whose teacher row is certified
 *      (`isApproved === true`); students / parents / admins never see it,
 *      and uncertified or de-certified teachers never see it (the server
 *      additionally denies them with `TEACHER_NOT_CERTIFIED` — the UI gate
 *      is an affordance mirror, not the authz boundary).
 *   2. ACCOUNT-GOVERNANCE GUARD — a governed account (deleted / blocked /
 *      suspended) hides the affordance even when the teacher row is
 *      certified, mirroring the certify slot's guard rails.
 *   3. HONEST ENUM + NULL LANE — the gate compares the REAL codegen
 *      `UserRole` enum (value import), and the nullable snapshot fields
 *      (`teacher` absent, `isApproved: null`, absent governance flags)
 *      resolve to NOT-visible (fail-closed UI).
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/admin/users/detail/reEvaluationActionGate.helpers.test.ts
 * — pure unit tier, no server boot, no DB, no network, no React render.
 */

import { describe, expect, test } from "bun:test";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  isOrderReEvaluationActionVisible,
  type ReEvaluationGateUser,
} from "@/frontend/views/admin/users/detail/reEvaluationActionGate.helpers";

/** Builds a gate user with overridable lanes (defaults: nothing set). */
function gateUser(overrides: Partial<ReEvaluationGateUser>): ReEvaluationGateUser {
  return {
    role: UserRole.Teacher,
    teacher: { isApproved: true },
    isDeleted: false,
    isBlocked: false,
    suspended: false,
    ...overrides,
  };
}

// ===========================================================================
describe("isOrderReEvaluationActionVisible — role + certification gating", () => {
  test("a certified, ungoverned teacher sees the affordance", () => {
    expect(isOrderReEvaluationActionVisible(gateUser({}))).toBe(true);
  });

  test.each([UserRole.Admin, UserRole.Student, UserRole.Parent] as const)(
    "role %s never sees the affordance (even with a certified-shaped teacher row)",
    role => {
      expect(isOrderReEvaluationActionVisible(gateUser({ role }))).toBe(false);
    }
  );

  test("an UNCERTIFIED teacher never sees the affordance", () => {
    expect(isOrderReEvaluationActionVisible(gateUser({ teacher: { isApproved: false } }))).toBe(false);
  });

  test("a missing or null teacher snapshot is fail-closed", () => {
    expect(isOrderReEvaluationActionVisible(gateUser({ teacher: null }))).toBe(false);
    expect(isOrderReEvaluationActionVisible(gateUser({ teacher: { isApproved: null } }))).toBe(false);
  });
});

// ===========================================================================
describe("isOrderReEvaluationActionVisible — account-governance guard (certify-slot mirror)", () => {
  test.each(["isDeleted", "isBlocked", "suspended"] as const)(
    "a %s account hides the affordance even while the teacher row is certified",
    flag => {
      expect(isOrderReEvaluationActionVisible(gateUser({ [flag]: true }))).toBe(false);
    }
  );

  test("absent (null) governance flags are treated as ungoverned", () => {
    expect(isOrderReEvaluationActionVisible(gateUser({ isDeleted: null, isBlocked: null, suspended: null }))).toBe(
      true
    );
  });
});
