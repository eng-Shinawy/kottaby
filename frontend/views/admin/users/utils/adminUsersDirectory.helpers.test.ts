/**
 * Unit tier — the directory cooldown-chip mapping of the admin user
 * directory. Locks the semantics of `directoryCooldownChipOf`:
 *
 *  1. `Active` → warning lane (re-purchase blocked), `Expired` → neutral
 *     lane (informational), `None`/null/undefined → `null` (the cell keeps
 *     its existing content — quiet rows stay quiet);
 *  2. the label always comes from the localized `directoryChips` block
 *     (both locales, never the wire string) and mirrors the detail page's
 *     `applicantCooldownState` vocabulary verbatim;
 *  3. the tooltip is the FULL absolute localized instant when a cooldown
 *     date exists, `null` otherwise — never the raw ISO string;
 *  4. the mapping is total over the closed wire enum.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/views/admin/users/utils/adminUsersDirectory.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { ApplicantCooldownState } from "@/frontend/graphql/generated/gql/graphql";
import {
  type DirectoryCooldownChipLabels,
  directoryCooldownChipOf,
} from "@/frontend/views/admin/users/utils/adminUsersDirectory.helpers";
import { adminUsersAr } from "@/shared/locale/ar/adminUsers";
import { adminUsersEn } from "@/shared/locale/en/adminUsers";

const enLabels: DirectoryCooldownChipLabels = adminUsersEn.directoryChips;
const arLabels: DirectoryCooldownChipLabels = adminUsersAr.directoryChips;

// Cross-surface vocabulary lock — the directory chip MUST read exactly like
// the detail page's cooldown-state chip (one concept, identical copy).
const detailVocabularyEn = adminUsersEn.detail.applicantCooldownState;
const detailVocabularyAr = adminUsersAr.detail.applicantCooldownState;

const FUTURE_INSTANT = "2026-10-27T23:28:16.137Z";

describe("directoryCooldownChipOf — state → chip mapping", () => {
  test("Active → warning chip", () => {
    const chip = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Active, cooldownUntil: FUTURE_INSTANT },
      enLabels,
      "en"
    );
    expect(chip).not.toBeNull();
    expect(chip?.tone).toBe("warning");
    expect(chip?.label).toBe(enLabels.cooldownActive);
  });

  test("Expired → neutral chip", () => {
    const chip = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Expired, cooldownUntil: FUTURE_INSTANT },
      enLabels,
      "en"
    );
    expect(chip).not.toBeNull();
    expect(chip?.tone).toBe("neutral");
    expect(chip?.label).toBe(enLabels.cooldownExpired);
  });

  test("None / null / undefined → null (quiet rows stay quiet)", () => {
    expect(directoryCooldownChipOf({ cooldownState: ApplicantCooldownState.None }, enLabels, "en")).toBeNull();
    expect(directoryCooldownChipOf({ cooldownState: null }, enLabels, "en")).toBeNull();
    expect(directoryCooldownChipOf({ cooldownState: undefined }, enLabels, "en")).toBeNull();
    expect(directoryCooldownChipOf({}, enLabels, "en")).toBeNull();
  });

  test("mapping is total over the closed wire enum (no fallback arm)", () => {
    for (const state of Object.values(ApplicantCooldownState)) {
      const chip = directoryCooldownChipOf({ cooldownState: state }, enLabels, "en");
      if (state === ApplicantCooldownState.None) {
        expect(chip).toBeNull();
      } else {
        if (!chip) {
          throw new Error(`expected a chip for state ${state}`);
        }
        expect(["warning", "neutral"]).toContain(chip.tone);
      }
    }
  });
});

describe("directoryCooldownChipOf — localized labels", () => {
  test("labels resolve from the localized block (en) and mirror the detail vocabulary", () => {
    const active = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Active, cooldownUntil: FUTURE_INSTANT },
      enLabels,
      "en"
    );
    const expired = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Expired, cooldownUntil: FUTURE_INSTANT },
      enLabels,
      "en"
    );
    expect(active?.label).toBe(detailVocabularyEn.active);
    expect(expired?.label).toBe(detailVocabularyEn.expired);
  });

  test("labels resolve from the localized block (ar — no wire-string fallthrough)", () => {
    const active = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Active, cooldownUntil: FUTURE_INSTANT },
      arLabels,
      "ar"
    );
    const expired = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Expired, cooldownUntil: FUTURE_INSTANT },
      arLabels,
      "ar"
    );
    expect(active?.label).toBe(detailVocabularyAr.active);
    expect(active?.label).not.toBe(ApplicantCooldownState.Active);
    expect(active?.label.length).toBeGreaterThan(0);
    expect(expired?.label).toBe(detailVocabularyAr.expired);
    expect(expired?.label).not.toBe(ApplicantCooldownState.Expired);
    expect(expired?.label.length).toBeGreaterThan(0);
    // Arabic script sanity — the labels are the established Arabic strings.
    expect(active?.label).toContain("انتظار");
    expect(expired?.label).toContain("انتظار");
  });

  test("Active and Expired labels are distinct in both locales", () => {
    expect(enLabels.cooldownActive).not.toBe(enLabels.cooldownExpired);
    expect(arLabels.cooldownActive).not.toBe(arLabels.cooldownExpired);
  });
});

describe("directoryCooldownChipOf — tooltip", () => {
  test("tooltip is the localized absolute instant when a cooldown date exists", () => {
    const chip = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Active, cooldownUntil: FUTURE_INSTANT },
      enLabels,
      "en"
    );
    const tooltip = chip?.tooltip;
    if (!tooltip) {
      throw new Error("expected a tooltip for an Active chip with a cooldown instant");
    }
    // Localized rendering — digits and separators, NOT the raw ISO payload.
    expect(tooltip).not.toBe(FUTURE_INSTANT);
    expect(tooltip).toMatch(/\d/);
  });

  test("tooltip is null when no cooldown date is set", () => {
    const withoutDate = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Active, cooldownUntil: null },
      enLabels,
      "en"
    );
    expect(withoutDate?.tooltip).toBeNull();
  });

  test("ar locale renders Arabic-Indic digits in the tooltip", () => {
    const chip = directoryCooldownChipOf(
      { cooldownState: ApplicantCooldownState.Active, cooldownUntil: FUTURE_INSTANT },
      arLabels,
      "ar"
    );
    const tooltip = chip?.tooltip;
    if (!tooltip) {
      throw new Error("expected a tooltip for an Active chip with a cooldown instant");
    }
    expect(tooltip).toMatch(/[٠-٩]/);
  });
});
