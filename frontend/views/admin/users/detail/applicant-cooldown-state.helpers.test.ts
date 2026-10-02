/**
 * Unit tier — the cooldown-state display mapping of the admin user-detail
 * applicant snapshot card. Locks:
 *
 *  1. every `ApplicantCooldownState` member resolves to its tone lane
 *     (Active → warning, Expired → info, None → neutral) — the re-purchase
 *     gate's liveness must be readable from the chip color alone;
 *  2. the label always comes from the localized display values, never from
 *     the wire string (Arabic-locale probe included);
 *  3. the mapping is total over the closed wire enum — no fallback arm, no
 *     `undefined` return.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/views/admin/users/detail/applicant-cooldown-state.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { ApplicantCooldownState } from "@/frontend/graphql/generated/gql/graphql";
import {
  cooldownStateChipOf,
  cooldownValueToneOf,
} from "@/frontend/views/admin/users/detail/applicant-cooldown-state.helpers";
import { adminUsersAr } from "@/shared/locale/ar/adminUsers";
import { adminUsersEn } from "@/shared/locale/en/adminUsers";

const enLabels = adminUsersEn.detail.applicantCooldownState;
const arLabels = adminUsersAr.detail.applicantCooldownState;

describe("cooldownStateChipOf", () => {
  test("maps every enum member to its tone lane", () => {
    expect(cooldownStateChipOf(ApplicantCooldownState.Active, enLabels).tone).toBe("warning");
    expect(cooldownStateChipOf(ApplicantCooldownState.Expired, enLabels).tone).toBe("info");
    expect(cooldownStateChipOf(ApplicantCooldownState.None, enLabels).tone).toBe("neutral");
  });

  test("labels resolve from the localized display values (en)", () => {
    expect(cooldownStateChipOf(ApplicantCooldownState.Active, enLabels).label).toBe(enLabels.active);
    expect(cooldownStateChipOf(ApplicantCooldownState.Expired, enLabels).label).toBe(enLabels.expired);
    expect(cooldownStateChipOf(ApplicantCooldownState.None, enLabels).label).toBe(enLabels.none);
  });

  test("labels resolve from the localized display values (ar — no wire-string fallthrough)", () => {
    const expectedByState = new Map([
      [ApplicantCooldownState.Active, arLabels.active],
      [ApplicantCooldownState.Expired, arLabels.expired],
      [ApplicantCooldownState.None, arLabels.none],
    ]);
    for (const [state, expected] of expectedByState) {
      const chip = cooldownStateChipOf(state, arLabels);
      expect(chip.label).toBe(expected);
      expect(chip.label).not.toBe(state);
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  test("every returned label is a non-empty localized string in both locales", () => {
    for (const labels of [enLabels, arLabels]) {
      for (const state of [
        ApplicantCooldownState.Active,
        ApplicantCooldownState.Expired,
        ApplicantCooldownState.None,
      ]) {
        const chip = cooldownStateChipOf(state, labels);
        expect(chip.label.length).toBeGreaterThan(0);
        expect(["warning", "info", "neutral"]).toContain(chip.tone);
      }
    }
  });
});

describe("cooldownValueToneOf", () => {
  test("mirrors the chip's liveness lanes for the expiry-instant value", () => {
    expect(cooldownValueToneOf(ApplicantCooldownState.Active)).toBe("warning");
    expect(cooldownValueToneOf(ApplicantCooldownState.Expired)).toBe("info");
    expect(cooldownValueToneOf(ApplicantCooldownState.None)).toBe("default");
  });
});
