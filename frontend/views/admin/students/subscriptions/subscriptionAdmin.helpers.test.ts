/**
 * Paired suite — the pure view helpers of the admin student drawer's
 * subscription-management section (`subscriptionAdmin.helpers.ts`).
 *
 * WHAT THIS LOCKS
 *   1. The per-status ACTION MATRIX — active → extend/cancel/change plan;
 *      expired → renew; pending/cancelled (and the governance-owned
 *      `suspended`) → none. Every wire `SubscriptionStatus` member has a
 *      matrix row (the exhaustive `Record` lookup degrades to `undefined`
 *      for a missing member, which would silently kill a row's actions).
 *   2. The extend-days GATE — only a strictly positive, whole, safe
 *      integer at or below the protocol's int4 wire limit parses
 *      (`parseExtendDays`); zero, negatives, decimals, non-numeric
 *      garbage, integer-overflow strings, and anything past the int4
 *      transport bound (2147483647) all resolve to `null` so the dialog
 *      never submits a client-garbage or unwireable day count (the
 *      server keeps the window-ceiling authority).
 *   3. The cancel-reason SEAM — blank/whitespace-only reasons collapse to
 *      `null` (nothing is minted into the audit trail) and a longer submit
 *      is clamped to the backend's 200-character boundary.
 *   4. The change-plan ELIGIBILITY filter — only ACTIVE plans crediting
 *      the SAME balance lane as the source row, excluding the source plan
 *      itself (cross-lane migration is out of scope server-side; the
 *      selector simply never offers an ineligible plan).
 *   5. The newest-first ordering — the drawer's rows sort by the creation
 *      stamp DESCENDING without mutating the input array (cache
 *      generations merge out of order).
 *
 * FIXTURES: literal objects shaped exactly as the generated query types
 * (`AdminStudentSubscriptionsQuery` / `AdminPlansQuery`) — technical test
 * data, never rendered UI copy. Pure logic tier, mirroring the
 * `rateTeacherMutationError.test.ts` precedent: no server boot, no DB, no
 * React render.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  ProrationDirection,
  SubscriptionCreditLane,
  SubscriptionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  type AdminPlanItem,
  actionsForStatus,
  buildSubscriptionDigest,
  eligibleChangePlanTargets,
  MAX_CANCEL_REASON_LENGTH,
  nextExpiryBound,
  normalizeCancelReason,
  parseExtendDays,
  planPriceDisplay,
  prorationCopyKind,
  type SubscriptionRow,
  sortNewestFirst,
  subscriptionDigestRowLine,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";

// ---------------------------------------------------------------------------
// Fixtures — wire-shaped literals of the two query row types

/** Technical fixture plan titles — never rendered UI copy. */
const FIXTURE_PLAN_A_TITLE = "Plan A";
const FIXTURE_PLAN_B_TITLE = "Plan B";

function planRow(overrides: Partial<AdminPlanItem> = {}): AdminPlanItem {
  return {
    id: "2",
    title: FIXTURE_PLAN_B_TITLE,
    sessionCount: 20,
    price: "200.00",
    currency: "EGP",
    intervalDays: 30,
    isActive: true,
    deactivatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    balanceLane: SubscriptionCreditLane.Hifz,
    ...overrides,
  };
}

function subscriptionRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "501",
    planId: 1,
    status: SubscriptionStatus.Active,
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-31T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    auditEntriesCount: 0,
    auditTrailPeek: null,
    plan: {
      id: "1",
      title: FIXTURE_PLAN_A_TITLE,
      sessionCount: 10,
      intervalDays: 30,
      price: "100.00",
      currency: "EGP",
      balanceLane: SubscriptionCreditLane.Hifz,
    },
    ...overrides,
  };
}

// ===========================================================================
describe("actionsForStatus — the exhaustive per-status action matrix", () => {
  test("active rows afford extend + cancel + change plan (never renew)", () => {
    expect(actionsForStatus(SubscriptionStatus.Active)).toEqual({
      extend: true,
      renew: false,
      cancel: true,
      changePlan: true,
    });
  });

  test("expired rows afford renew ONLY (the expiry sweep owns active → expired)", () => {
    expect(actionsForStatus(SubscriptionStatus.Expired)).toEqual({
      extend: false,
      renew: true,
      cancel: false,
      changePlan: false,
    });
  });

  test("pending, cancelled, and the governance-owned suspended afford NOTHING", () => {
    for (const status of [SubscriptionStatus.Pending, SubscriptionStatus.Cancelled, SubscriptionStatus.Suspended]) {
      expect(actionsForStatus(status)).toEqual({ extend: false, renew: false, cancel: false, changePlan: false });
    }
  });
});

// ===========================================================================
describe("parseExtendDays — whole days > 0, client-side gate", () => {
  test("canonical decimal digits parse (surrounding whitespace tolerated)", () => {
    expect(parseExtendDays("7")).toBe(7);
    expect(parseExtendDays(" 30 ")).toBe(30);
    expect(parseExtendDays("000000000000005")).toBe(5);
  });

  test("zero, negatives, decimals, and non-numeric garbage all fail", () => {
    for (const garbage of ["0", "-3", "1.5", "1,5", "abc", "", "   ", "7 days", "٧", "+7", "0x10", "1e2"]) {
      expect(parseExtendDays(garbage)).toBeNull();
    }
  });

  test("integer-overflow strings fail the safe-integer bound", () => {
    expect(parseExtendDays("99999999999999999999")).toBeNull();
    expect(parseExtendDays("10000000000000000000")).toBeNull();
  });

  test("values past the protocol's int4 wire limit fail the transport gate", () => {
    // A count above the wire limit can never reach the server — the
    // request would die with a protocol-layer English error surfaced
    // inside the dialog. Transport constraint, not business authority.
    expect(parseExtendDays("2147483648")).toBeNull();
    expect(parseExtendDays("2147483649")).toBeNull();
    expect(parseExtendDays("9999999999")).toBeNull();
  });

  test("the int4 wire limit itself passes the transport gate (the server owns the business ceiling)", () => {
    expect(parseExtendDays("2147483647")).toBe(2_147_483_647);
  });
});

// ===========================================================================
describe("normalizeCancelReason — optional bounded audit reason", () => {
  test("blank or whitespace-only resolves to null (nothing minted into the trail)", () => {
    expect(normalizeCancelReason("")).toBeNull();
    expect(normalizeCancelReason("   ")).toBeNull();
  });

  test("a real reason is trimmed verbatim", () => {
    expect(normalizeCancelReason("  duplicate order  ")).toBe("duplicate order");
  });

  test("a longer submit is clamped to the 200-character backend boundary", () => {
    expect(MAX_CANCEL_REASON_LENGTH).toBe(200);
    const overlong = "ب".repeat(250);
    const clamped = normalizeCancelReason(overlong);
    expect(clamped).toHaveLength(200);
    expect(clamped).toBe(overlong.slice(0, 200));
    expect(normalizeCancelReason("ب".repeat(200))).toHaveLength(200);
  });
});

// ===========================================================================
describe("eligibleChangePlanTargets — same-lane active candidates", () => {
  test("keeps only ACTIVE plans on the SOURCE lane, excluding the source plan itself", () => {
    const plans = [
      planRow({ id: "1", balanceLane: SubscriptionCreditLane.Hifz }), // the source plan itself
      planRow({ id: "2", balanceLane: SubscriptionCreditLane.Hifz }), // eligible
      planRow({ id: "3", balanceLane: SubscriptionCreditLane.Hifz, isActive: false }), // inactive
      planRow({ id: "4", balanceLane: SubscriptionCreditLane.Tajweed }), // different lane
      planRow({ id: "5", balanceLane: null }), // lane-less
    ];
    const targets = eligibleChangePlanTargets(plans, 1, SubscriptionCreditLane.Hifz);
    expect(targets.map(plan => plan.id)).toEqual(["2"]);
  });

  test("the source-plan exclusion keys on the wire's string id (numeric sourcePlanId coerced)", () => {
    const plans = [planRow({ id: "1", balanceLane: SubscriptionCreditLane.Tajweed })];
    expect(eligibleChangePlanTargets(plans, 1, SubscriptionCreditLane.Tajweed)).toEqual([]);
    expect(eligibleChangePlanTargets(plans, 999, SubscriptionCreditLane.Tajweed)).toHaveLength(1);
  });
});

// ===========================================================================
describe("sortNewestFirst — newest-first ordering without input mutation", () => {
  test("rows sort by creation stamp descending; the input array is untouched", () => {
    const oldest = subscriptionRow({ id: "1", createdAt: "2026-01-01T00:00:00.000Z" });
    const newest = subscriptionRow({ id: "3", createdAt: "2026-03-01T00:00:00.000Z" });
    const middle = subscriptionRow({ id: "2", createdAt: "2026-02-01T00:00:00.000Z" });
    const rows = [newest, oldest, middle];

    const sorted = sortNewestFirst(rows);

    expect(sorted.map(row => row.id)).toEqual(["3", "2", "1"]);
    expect(rows.map(row => row.id)).toEqual(["3", "1", "2"]);
  });
});

// ===========================================================================
describe("nextExpiryBound — the summary strip's soonest active bound", () => {
  test("returns the soonest bound among ACTIVE rows only (pending/expired/cancelled never count)", () => {
    const rows = [
      subscriptionRow({ id: "1", status: SubscriptionStatus.Active, endDate: "2026-03-20T00:00:00.000Z" }),
      subscriptionRow({ id: "2", status: SubscriptionStatus.Active, endDate: "2026-03-05T00:00:00.000Z" }),
      subscriptionRow({ id: "3", status: SubscriptionStatus.Expired, endDate: "2026-02-01T00:00:00.000Z" }),
      subscriptionRow({ id: "4", status: SubscriptionStatus.Cancelled, endDate: "2026-01-15T00:00:00.000Z" }),
      subscriptionRow({ id: "5", status: SubscriptionStatus.Pending, endDate: null }),
    ];
    expect(nextExpiryBound(rows)).toBe("2026-03-05T00:00:00.000Z");
  });

  test("active rows without a bound are skipped; an all-empty scan resolves null", () => {
    expect(nextExpiryBound([subscriptionRow({ id: "1", endDate: null })])).toBeNull();
    expect(nextExpiryBound([subscriptionRow({ id: "2", status: SubscriptionStatus.Expired })])).toBeNull();
    expect(nextExpiryBound([])).toBeNull();
  });

  test("the wire format flows through verbatim (no re-serialization)", () => {
    const rows = [subscriptionRow({ id: "1", endDate: "2026-11-13T14:27:00" })];
    expect(nextExpiryBound(rows)).toBe("2026-11-13T14:27:00");
  });
});

// ===========================================================================
describe("prorationCopyKind — direction → copy slot", () => {
  test("upgrades read the carried slot; downgrades read the forfeited slot", () => {
    expect(prorationCopyKind(ProrationDirection.Upgrade)).toBe("carried");
    expect(prorationCopyKind(ProrationDirection.Downgrade)).toBe("forfeited");
  });
});

// ===========================================================================
describe("planPriceDisplay — the plan-facts caption's money fragment", () => {
  test("groups the integer digits and appends the wire currency verbatim", () => {
    expect(planPriceDisplay("250", "EGP")).toBe("250 EGP");
    expect(planPriceDisplay("2500", "EGP")).toBe("2,500 EGP");
    expect(planPriceDisplay("1234567.89", "SAR")).toBe("1,234,567.89 SAR");
  });

  test("preserves the wire value byte-exact — sign and fraction digits verbatim, never a number", () => {
    expect(planPriceDisplay("0.10", "EGP")).toBe("0.10 EGP");
    expect(planPriceDisplay("-25.50", "EGP")).toBe("-25.50 EGP");
  });
});

// ===========================================================================
describe("subscriptionDigestRowLine — one row's digest line", () => {
  test("joins the seam id, plan title, status label, and pre-formatted end display", () => {
    expect(
      subscriptionDigestRowLine({
        id: "3821",
        planTitle: FIXTURE_PLAN_A_TITLE,
        statusLabel: "Active",
        endLabel: "End",
        endDisplay: "10/04/2026, 16:41",
      })
    ).toBe("#3821 Plan A — Active — End: 10/04/2026, 16:41");
  });

  test("a pending row (no bound) rides the honest em-dash display", () => {
    expect(
      subscriptionDigestRowLine({
        id: "7",
        planTitle: FIXTURE_PLAN_B_TITLE,
        statusLabel: "Pending",
        endLabel: "End",
        endDisplay: "—",
      })
    ).toBe("#7 Plan B — Pending — End: —");
  });
});

// ===========================================================================
describe("buildSubscriptionDigest — the header quick action's digest text", () => {
  const STATUS_LABELS: Record<SubscriptionStatus, string> = {
    [SubscriptionStatus.Active]: "Active",
    [SubscriptionStatus.Expired]: "Expired",
    [SubscriptionStatus.Pending]: "Pending",
    [SubscriptionStatus.Cancelled]: "Cancelled",
    [SubscriptionStatus.Suspended]: "Suspended",
  };

  test("header + non-zero counts in canonical order + next expiry + blank separator + row lines", () => {
    const digest = buildSubscriptionDigest({
      title: "Subscriptions",
      studentId: 3591,
      counts: {
        [SubscriptionStatus.Active]: 2,
        [SubscriptionStatus.Expired]: 1,
        [SubscriptionStatus.Pending]: 0,
        [SubscriptionStatus.Cancelled]: 1,
        [SubscriptionStatus.Suspended]: 0,
      },
      statusLabels: STATUS_LABELS,
      nextExpiryLine: "Next expiry: 10/04/2026, 16:41",
      rowLines: ["#3821 Plan A — Active — End: 10/04/2026"],
    });
    expect(digest).toBe(
      [
        "Subscriptions — #3591",
        "Active: 2 · Expired: 1 · Cancelled: 1",
        "Next expiry: 10/04/2026, 16:41",
        "",
        "#3821 Plan A — Active — End: 10/04/2026",
      ].join("\n")
    );
  });

  test("a null next-expiry line drops the line entirely (never an empty placeholder)", () => {
    const digest = buildSubscriptionDigest({
      title: "Subscriptions",
      studentId: 3591,
      counts: {
        [SubscriptionStatus.Active]: 0,
        [SubscriptionStatus.Expired]: 1,
        [SubscriptionStatus.Pending]: 0,
        [SubscriptionStatus.Cancelled]: 0,
        [SubscriptionStatus.Suspended]: 0,
      },
      statusLabels: STATUS_LABELS,
      nextExpiryLine: null,
      rowLines: ["#1 Plan B — Expired — End: 09/09/2026"],
    });
    expect(digest).toBe(
      ["Subscriptions — #3591", "Expired: 1", "", "#1 Plan B — Expired — End: 09/09/2026"].join("\n")
    );
  });
});
