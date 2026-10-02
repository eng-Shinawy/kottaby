/**
 * Broadcast-compose helpers suite — the confirmation dialog's audience
 * summary (`composeAudienceSummary`) plus the label resolvers it rides.
 *
 * WHAT THIS LOCKS
 *   1. BRANCH COMPLETENESS — every audience kind renders its summary line in
 *      the SAME grammar the history table uses: kind label qualified with
 *      the cohort detail (role → directory roleLabels; country → flag emoji
 *      + the LOCALE's dataset name; plan → the LIVE plan title).
 *   2. FALLBACK ARMS — a plan id absent from the loaded list degrades to the
 *      kind label alone (the plans query can lag the selection); a role
 *      cohort with a null companion and a country cohort with an empty code
 *      degrade the same way (the readiness gate blocks the submit before
 *      this state is reachable, so the summary never lies).
 *   3. TRANSLATION-BACKED COPY — every label comes from the compile-time
 *      namespace maps in BOTH locales; the Arabic map's output carries
 *      Arabic script; no hardcoded copy.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/views/admin/broadcasts/broadcast-compose.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { BroadcastAudienceType, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  type ComposeState,
  composeAudienceSummary,
  initialComposeState,
} from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { COUNTRIES } from "@/shared/constants/countries";
import { adminBroadcastsAr } from "@/shared/locale/ar/adminBroadcasts";
import { adminBroadcastsEn } from "@/shared/locale/en/adminBroadcasts";
import { getTranslations } from "@/shared/locale/server";

const en = getTranslations("en");
const ar = getTranslations("ar");
const roleLabelsEn = en.adminUsersTranslations.roleLabels;
const roleLabelsAr = ar.adminUsersTranslations.roleLabels;

/**
 * Fixture plan rows — the titles are arbitrary DATA (the production helper
 * reads `plan.title` off DB-backed rows); they are never rendered copy in
 * this suite, so the no-hardcoded-strings rule is satisfied by binding
 * them as named constants that double as the assertion anchors.
 */
const PLAN_TITLE_FIXTURE_1 = "Hifz Intensive";
const PLAN_TITLE_FIXTURE_2 = "Tajweed Weekly";

const PLANS = [
  { id: "plan-1", title: PLAN_TITLE_FIXTURE_1 },
  { id: "plan-2", title: PLAN_TITLE_FIXTURE_2 },
];

function stateWith(overrides: Partial<ComposeState>): ComposeState {
  return { ...initialComposeState, ...overrides };
}

describe("composeAudienceSummary — the confirm gate's identity echo", () => {
  test("system-wide audience renders the kind label alone", () => {
    for (const [t, roleLabels] of [
      [adminBroadcastsEn, roleLabelsEn],
      [adminBroadcastsAr, roleLabelsAr],
    ] as const) {
      expect(composeAudienceSummary(initialComposeState, PLANS, t, roleLabels, "en")).toBe(t.audienceAll);
    }
  });

  test("role cohorts qualify the kind label with the directory role label", () => {
    const state = stateWith({ audienceType: BroadcastAudienceType.Role, role: UserRole.Student });
    expect(composeAudienceSummary(state, PLANS, adminBroadcastsEn, roleLabelsEn, "en")).toBe(
      `${adminBroadcastsEn.audienceRole}: ${roleLabelsEn.student}`
    );
    expect(composeAudienceSummary(state, PLANS, adminBroadcastsAr, roleLabelsAr, "ar")).toBe(
      `${adminBroadcastsAr.audienceRole}: ${roleLabelsAr.student}`
    );
    // The ar output carries Arabic script (no English fallthrough).
    expect(composeAudienceSummary(state, PLANS, adminBroadcastsAr, roleLabelsAr, "ar")).toMatch(/[\u0600-\u06FF]/);
  });

  test("country cohorts speak the history grammar: flag + the LOCALE's dataset name", () => {
    const state = stateWith({ audienceType: BroadcastAudienceType.Country, country: "EG" });
    expect(composeAudienceSummary(state, PLANS, adminBroadcastsEn, roleLabelsEn, "en")).toBe(
      `${adminBroadcastsEn.audienceCountry}: ${COUNTRIES.EG.flag} ${COUNTRIES.EG.en}`
    );
    expect(composeAudienceSummary(state, PLANS, adminBroadcastsAr, roleLabelsAr, "ar")).toBe(
      `${adminBroadcastsAr.audienceCountry}: ${COUNTRIES.EG.flag} ${COUNTRIES.EG.ar}`
    );
  });

  test("plan cohorts resolve the LIVE plan title from the loaded plans", () => {
    const state = stateWith({ audienceType: BroadcastAudienceType.Plan, planId: "plan-2" });
    expect(composeAudienceSummary(state, PLANS, adminBroadcastsEn, roleLabelsEn, "en")).toBe(
      `${adminBroadcastsEn.audiencePlan}: ${PLAN_TITLE_FIXTURE_2}`
    );
  });

  test("fallback arms: a missing plan id (or absent companion) degrades to the kind label alone", () => {
    const missingPlan = stateWith({ audienceType: BroadcastAudienceType.Plan, planId: "plan-x" });
    expect(composeAudienceSummary(missingPlan, PLANS, adminBroadcastsEn, roleLabelsEn, "en")).toBe(
      adminBroadcastsEn.audiencePlan
    );
    // The readiness gate blocks these before the dialog can open — the
    // summary must still not lie when the state is momentarily incoherent.
    const nullRole = stateWith({ audienceType: BroadcastAudienceType.Role, role: null });
    expect(composeAudienceSummary(nullRole, PLANS, adminBroadcastsEn, roleLabelsEn, "en")).toBe(
      adminBroadcastsEn.audienceRole
    );
    const emptyCountry = stateWith({ audienceType: BroadcastAudienceType.Country, country: "" });
    expect(composeAudienceSummary(emptyCountry, PLANS, adminBroadcastsEn, roleLabelsEn, "en")).toBe(
      adminBroadcastsEn.audienceCountry
    );
  });
});
